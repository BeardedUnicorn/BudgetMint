//! The changes the user makes, as the documents they write. Each checks the
//! rules first (the messages say what to fix), takes effect in core's copy
//! at once, and comes with the writes that undo it. The client sends the
//! writes; their echo from Firestore changes nothing more.

use crate::docs::{valid_id, DocKey, DocWrite, Snapshot};
use crate::error::{invalid, CoreError};
use crate::model::{
    Balance, Cents, FutureEarnings, Item, ItemKind, ItemReminder, OccStatus, Override, Repeat,
    Segment, Settings, WithdrawPolicy, MAX_CENTS, MAX_HORIZON_DAYS, MIN_HORIZON_DAYS,
};
use crate::occur::MOVE_DAYS;
use crate::recur::is_item_date;
use crate::time::Ctx;
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

pub const MAX_NAME: usize = 80;
pub const MAX_CATEGORY: usize = 40;
pub const MAX_NOTE: usize = 500;
pub const MAX_SEGMENTS: usize = 24;
pub const MAX_LEADS: usize = 3;
pub const MAX_LEAD_DAYS: u8 = 30;
/// How far back a balance may be dated.
pub const MAX_BALANCE_AGE_DAYS: i64 = 366;
/// The longest a withdrawal may be taken to reach the bank: two weeks.
pub const MAX_ARRIVAL_HOURS: u16 = 336;

/// What a change writes, and what writing undoes it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub writes: Vec<DocWrite>,
    pub undo: Vec<DocWrite>,
}

impl Planned {
    fn add(&mut self, write: Option<(DocWrite, DocWrite)>) {
        if let Some((write, undo)) = write {
            self.writes.push(write);
            self.undo.insert(0, undo);
        }
    }
}

/// What an undo that came too late is refused with.
pub const CHANGED_SINCE: &str = "It was changed again since, so it can't be undone.";

/// The writes that undo `planned`, while every document it wrote is still as
/// it wrote it. Changed again since (here or on another device), undoing
/// would take that later change back too: refused instead.
pub fn undo(snapshot: &Snapshot, planned: Planned) -> Result<Vec<DocWrite>, CoreError> {
    if planned.writes.iter().all(|write| snapshot.holds(write)) {
        Ok(planned.undo)
    } else {
        Err(invalid(CHANGED_SINCE))
    }
}

/// An item as the user edits it (core keeps its times).
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    pub schedule: Vec<Segment>,
    #[serde(default)]
    pub autopay: bool,
    #[serde(default)]
    pub reminder: Option<ItemReminder>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub note: Option<String>,
}

/// `text` trimmed, None when empty; refused when longer than `max`.
fn text(value: Option<String>, max: usize, what: &str) -> Result<Option<String>, CoreError> {
    let value = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match value {
        Some(value) if value.chars().count() > max => {
            Err(invalid(format!("Keep the {} to {} characters", what, max)))
        }
        value => Ok(value),
    }
}

fn cents(value: Cents, what: &str) -> Result<Cents, CoreError> {
    if (0..=MAX_CENTS).contains(&value) {
        Ok(value)
    } else {
        Err(invalid(format!(
            "The {} must be between $0 and $10,000,000,000",
            what
        )))
    }
}

fn check_repeat(repeat: Repeat) -> Result<(), CoreError> {
    let ok = match repeat {
        Repeat::Once => true,
        Repeat::Days { n } => (1..=365).contains(&n),
        Repeat::Weeks { n } => (1..=52).contains(&n),
        Repeat::Months { n, day } => (1..=12).contains(&n) && (1..=31).contains(&day),
        Repeat::Years { n } => (1..=10).contains(&n),
    };
    if ok {
        Ok(())
    } else {
        Err(invalid(
            "Choose how often it repeats: every 1–365 days, 1–52 weeks, 1–12 months or 1–10 years",
        ))
    }
}

fn check_schedule(schedule: &[Segment]) -> Result<(), CoreError> {
    if schedule.is_empty() || schedule.len() > MAX_SEGMENTS {
        return Err(invalid(format!(
            "A schedule has 1 to {} parts",
            MAX_SEGMENTS
        )));
    }
    for (index, segment) in schedule.iter().enumerate() {
        check_repeat(segment.repeat)?;
        cents(segment.amount_cents, "amount")?;
        if segment.until.is_some_and(|until| until < segment.from) {
            return Err(invalid("It can't end before it starts"));
        }
        if index > 0 && segment.from <= schedule[index - 1].from {
            return Err(invalid(
                "Each change to the schedule starts after the one before",
            ));
        }
    }
    Ok(())
}

fn check_reminder(reminder: Option<ItemReminder>) -> Result<Option<ItemReminder>, CoreError> {
    let Some(mut reminder) = reminder else {
        return Ok(None);
    };
    reminder.lead_days.sort_unstable();
    reminder.lead_days.dedup();
    if reminder.lead_days.is_empty() {
        return Ok(None);
    }
    if reminder.lead_days.len() > MAX_LEADS
        || reminder.lead_days.iter().any(|lead| *lead > MAX_LEAD_DAYS)
    {
        return Err(invalid(format!(
            "Remind up to {} times, each up to {} days before",
            MAX_LEADS, MAX_LEAD_DAYS
        )));
    }
    Ok(Some(reminder))
}

/// What a change to a document a newer BudgetMint wrote is refused with.
pub const NEWER: &str =
    "A newer BudgetMint changed this. Update BudgetMint on this device to change it here.";

/// A document a newer BudgetMint wrote isn't this version's to change: it
/// would write back what it last read, without what the newer one added.
fn ours(snapshot: &Snapshot, key: &DocKey) -> Result<(), CoreError> {
    if snapshot.is_held(key) {
        return Err(invalid(NEWER));
    }
    Ok(())
}

fn item<'a>(snapshot: &'a Snapshot, id: &str) -> Result<&'a Item, CoreError> {
    ours(snapshot, &DocKey::Item(id.to_string()))?;
    snapshot.items.get(id).ok_or_else(|| {
        CoreError::NotFound("That bill isn't there any more (deleted on another device?)".into())
    })
}

fn write_item(snapshot: &mut Snapshot, item: &Item) -> Planned {
    let mut planned = Planned::default();
    planned.add(snapshot.write(DocKey::Item(item.id.clone()), Some(item)));
    planned
}

/// A change to an item's schedule from a date on.
#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ScheduleChange {
    pub from: NaiveDate,
    pub repeat: Repeat,
    pub amount_cents: Cents,
}

/// `schedule` with `change` from its date on: what comes before stays as it was.
fn rescheduled(mut schedule: Vec<Segment>, change: ScheduleChange) -> Vec<Segment> {
    schedule.retain(|segment| segment.from < change.from);
    schedule.push(Segment {
        from: change.from,
        until: None,
        repeat: change.repeat,
        amount_cents: change.amount_cents,
    });
    schedule
}

/// Adds an item, or saves an edit to one.
pub fn save_item(
    snapshot: &mut Snapshot,
    input: ItemInput,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    save_item_from(snapshot, input, None, ctx)
}

/// Saves an item and, with `change`, changes its schedule from a date on:
/// both or, when either is refused, neither.
pub fn save_item_from(
    snapshot: &mut Snapshot,
    mut input: ItemInput,
    change: Option<ScheduleChange>,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    if !valid_id(&input.id) {
        return Err(invalid("An item's id is 1–64 letters, digits and dashes"));
    }
    ours(snapshot, &DocKey::Item(input.id.clone()))?;
    let name =
        text(Some(input.name), MAX_NAME, "name")?.ok_or_else(|| invalid("Give it a name"))?;
    if let Some(change) = change {
        input.schedule = rescheduled(input.schedule, change);
    }
    check_schedule(&input.schedule)?;
    let created_at = snapshot
        .items
        .get(&input.id)
        .map_or(ctx.now, |existing| existing.created_at);
    let saved = Item {
        id: input.id,
        kind: input.kind,
        name,
        category: text(input.category, MAX_CATEGORY, "category")?,
        schedule: input.schedule,
        autopay: input.autopay,
        reminder: check_reminder(input.reminder)?,
        archived: input.archived,
        note: text(input.note, MAX_NOTE, "note")?,
        created_at,
        updated_at: ctx.now,
    };
    // Unchanged but for the time: nothing to write
    if snapshot.items.get(&saved.id).is_some_and(|existing| {
        Item {
            updated_at: existing.updated_at,
            ..saved.clone()
        } == *existing
    }) {
        return Ok(Planned::default());
    }
    Ok(write_item(snapshot, &saved))
}

/// Changes the schedule from `from` on: what comes before stays as it was.
pub fn change_schedule(
    snapshot: &mut Snapshot,
    item_id: &str,
    from: NaiveDate,
    repeat: Repeat,
    amount_cents: Cents,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let mut changed = item(snapshot, item_id)?.clone();
    let change = ScheduleChange {
        from,
        repeat,
        amount_cents,
    };
    changed.schedule = rescheduled(changed.schedule, change);
    check_schedule(&changed.schedule)?;
    changed.updated_at = ctx.now;
    Ok(write_item(snapshot, &changed))
}

/// Archives an item (it stops; its history stays), or brings it back.
pub fn archive_item(
    snapshot: &mut Snapshot,
    item_id: &str,
    archived: bool,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let mut changed = item(snapshot, item_id)?.clone();
    if changed.archived == archived {
        return Ok(Planned::default());
    }
    changed.archived = archived;
    changed.updated_at = ctx.now;
    Ok(write_item(snapshot, &changed))
}

/// Deletes an item and everything said about its occurrences.
pub fn delete_item(snapshot: &mut Snapshot, item_id: &str) -> Result<Planned, CoreError> {
    item(snapshot, item_id)?;
    let dates: Vec<NaiveDate> = snapshot
        .overrides
        .keys()
        .filter(|(id, _)| id == item_id)
        .map(|(_, date)| *date)
        .collect();
    let keys: Vec<DocKey> = dates
        .into_iter()
        .map(|date| DocKey::Occ {
            date,
            item_id: item_id.to_string(),
        })
        .collect();
    // All of it or none: checked before anything is written
    for key in &keys {
        ours(snapshot, key)?;
    }
    let mut planned = Planned::default();
    for key in keys {
        planned.add(snapshot.write::<Override>(key, None));
    }
    planned.add(snapshot.write::<Item>(DocKey::Item(item_id.to_string()), None));
    Ok(planned)
}

/// What the user says about one occurrence: all of it, as it should be now.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceInput {
    pub item_id: String,
    /// Which occurrence: the schedule's date.
    pub date: NaiveDate,
    pub status: OccStatus,
    #[serde(default)]
    pub amount_cents: Option<Cents>,
    #[serde(default)]
    pub moved_to: Option<NaiveDate>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Marks an occurrence paid, skipped or open again, moves it or changes its amount.
pub fn set_occurrence(
    snapshot: &mut Snapshot,
    input: OccurrenceInput,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let found = item(snapshot, &input.item_id)?;
    let key = DocKey::Occ {
        date: input.date,
        item_id: input.item_id.clone(),
    };
    ours(snapshot, &key)?;
    let existing = snapshot
        .overrides
        .contains_key(&(input.item_id.clone(), input.date));
    if !existing && !is_item_date(found, input.date) {
        return Err(invalid("It isn't due on that date"));
    }
    if let OccStatus::Done { on, amount_cents } = input.status {
        cents(amount_cents, "amount paid")?;
        if on > ctx.today() + Duration::days(1) {
            return Err(invalid(
                "It can't be paid later than tomorrow: mark it paid once it is",
            ));
        }
    }
    if let Some(amount) = input.amount_cents {
        cents(amount, "amount")?;
    }
    if input
        .moved_to
        .is_some_and(|to| (to - input.date).num_days().abs() > MOVE_DAYS)
    {
        return Err(invalid(format!(
            "It can be moved up to {} days either way",
            MOVE_DAYS
        )));
    }
    let note = text(input.note, MAX_NOTE, "note")?;
    // Back to just as scheduled: nothing to keep
    let plain = input.status == OccStatus::Open
        && input.amount_cents.is_none()
        && input.moved_to.is_none()
        && note.is_none();
    let over = Override {
        item_id: input.item_id,
        date: input.date,
        status: input.status,
        amount_cents: input.amount_cents,
        moved_to: input.moved_to.filter(|to| *to != input.date),
        note,
        updated_at: ctx.now,
    };
    let mut planned = Planned::default();
    if plain {
        planned.add(snapshot.write::<Override>(key, None));
    } else if snapshot
        .overrides
        .get(&(over.item_id.clone(), over.date))
        .map(|old| Override {
            updated_at: ctx.now,
            ..old.clone()
        })
        != Some(over.clone())
    {
        planned.add(snapshot.write(key, Some(&over)));
    }
    Ok(planned)
}

/// Sets the balance the forecast starts from.
pub fn set_balance(
    snapshot: &mut Snapshot,
    balance: Balance,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    ours(snapshot, &DocKey::Settings)?;
    let today = ctx.today();
    if balance.as_of > today {
        return Err(invalid("Set the balance as of today or a day before"));
    }
    if balance.as_of < today - Duration::days(MAX_BALANCE_AGE_DAYS) {
        return Err(invalid("Set a balance from the past year"));
    }
    if balance.cents.abs() > MAX_CENTS {
        return Err(invalid(
            "The balance must be between -$10,000,000,000 and $10,000,000,000",
        ));
    }
    let settings = Settings {
        balance: Some(balance),
        ..snapshot.settings()
    };
    let mut planned = Planned::default();
    planned.add(snapshot.write(DocKey::Settings, Some(&settings)));
    Ok(planned)
}

/// Saves the settings (the balance is set_balance's, and stays as it is).
pub fn save_settings(snapshot: &mut Snapshot, settings: Settings) -> Result<Planned, CoreError> {
    ours(snapshot, &DocKey::Settings)?;
    if !(MIN_HORIZON_DAYS..=MAX_HORIZON_DAYS).contains(&settings.horizon_days) {
        return Err(invalid(format!(
            "Look {} to {} days ahead",
            MIN_HORIZON_DAYS, MAX_HORIZON_DAYS
        )));
    }
    cents(settings.low_balance_cents, "low balance")?;
    let plan = &settings.taskmint;
    cents(plan.min_withdrawal_cents, "smallest withdrawal")?;
    if plan.arrival_delay_hours > MAX_ARRIVAL_HOURS {
        return Err(invalid("A withdrawal can take up to two weeks to arrive"));
    }
    if let WithdrawPolicy::Weekly { weekday, hour } = plan.policy {
        if weekday > 6 || hour > 23 {
            return Err(invalid("Choose a day of the week and an hour"));
        }
    }
    match plan.future {
        FutureEarnings::Off => {}
        FutureEarnings::Weekly { cents: weekly } => {
            cents(weekly, "weekly earnings")?;
        }
        FutureEarnings::Trailing { weeks } if (1..=12).contains(&weeks) => {}
        FutureEarnings::Trailing { .. } => return Err(invalid("Average over 1 to 12 weeks")),
    }
    if settings.reminders.hour > 23 || settings.reminders.lead_days > MAX_LEAD_DAYS {
        return Err(invalid(format!(
            "Remind at an hour of the day, up to {} days before",
            MAX_LEAD_DAYS
        )));
    }
    let saved = Settings {
        balance: snapshot.settings().balance,
        ..settings
    };
    let mut planned = Planned::default();
    planned.add(snapshot.write(DocKey::Settings, Some(&saved)));
    Ok(planned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TaskMintPlan;
    use crate::occur::tests::{d, item, put_item};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn input(id: &str) -> ItemInput {
        ItemInput {
            id: id.into(),
            kind: ItemKind::Bill,
            name: " Rent ".into(),
            category: Some("  ".into()),
            schedule: vec![Segment {
                from: d(2026, 11, 1),
                until: None,
                repeat: Repeat::Months { n: 1, day: 1 },
                amount_cents: 120_000,
            }],
            autopay: false,
            reminder: Some(ItemReminder {
                lead_days: vec![3, 0, 3],
            }),
            archived: false,
            note: None,
        }
    }

    fn message(result: Result<Planned, CoreError>) -> String {
        result.unwrap_err().to_string()
    }

    #[test]
    fn saves_an_item_tidied_and_keeps_its_creation_time() {
        let mut s = Snapshot::default();
        let planned = save_item(&mut s, input("rent"), &ctx()).unwrap();
        assert_eq!(planned.writes.len(), 1);
        assert_eq!(planned.undo[0].json, None);
        let saved = &s.items["rent"];
        assert_eq!(saved.name, "Rent");
        assert_eq!(saved.category, None);
        assert_eq!(
            saved.reminder,
            Some(ItemReminder {
                lead_days: vec![0, 3]
            })
        );
        assert_eq!(saved.created_at, ctx().now);
        // The same again: nothing; an edit later keeps when it was made
        assert_eq!(
            save_item(&mut s, input("rent"), &ctx()).unwrap(),
            Planned::default()
        );
        let later = Ctx::new(ctx().now_ms() + 1000, "America/Chicago");
        let edited = ItemInput {
            name: "Rent!".into(),
            reminder: Some(ItemReminder { lead_days: vec![] }),
            ..input("rent")
        };
        save_item(&mut s, edited, &later).unwrap();
        assert_eq!(s.items["rent"].created_at, ctx().now);
        assert_eq!(s.items["rent"].updated_at, later.now);
        assert_eq!(s.items["rent"].reminder, None);
    }

    #[test]
    fn says_what_to_fix_in_an_item() {
        let mut s = Snapshot::default();
        let bad = |change: fn(&mut ItemInput)| {
            let mut value = input("rent");
            change(&mut value);
            value
        };
        let cases: Vec<(ItemInput, &str)> = vec![
            (bad(|i| i.id = "a b".into()), "An item's id is 1–64 letters, digits and dashes"),
            (bad(|i| i.name = "  ".into()), "Give it a name"),
            (bad(|i| i.name = "x".repeat(81)), "Keep the name to 80 characters"),
            (bad(|i| i.category = Some("x".repeat(41))), "Keep the category to 40 characters"),
            (bad(|i| i.note = Some("x".repeat(501))), "Keep the note to 500 characters"),
            (bad(|i| i.schedule.clear()), "A schedule has 1 to 24 parts"),
            (bad(|i| i.schedule[0].amount_cents = -1), "The amount must be between $0 and $10,000,000,000"),
            (bad(|i| i.schedule[0].until = Some(d(2026, 10, 1))), "It can't end before it starts"),
            (bad(|i| i.schedule[0].repeat = Repeat::Days { n: 0 }), "Choose how often it repeats: every 1–365 days, 1–52 weeks, 1–12 months or 1–10 years"),
            (bad(|i| i.reminder = Some(ItemReminder { lead_days: vec![31] })), "Remind up to 3 times, each up to 30 days before"),
            (bad(|i| i.reminder = Some(ItemReminder { lead_days: vec![1, 2, 3, 4] })), "Remind up to 3 times, each up to 30 days before"),
        ];
        for (value, expected) in cases {
            assert_eq!(message(save_item(&mut s, value, &ctx())), expected);
        }
        let twice = bad(|i| {
            let first = i.schedule[0].clone();
            i.schedule.push(first);
        });
        assert_eq!(
            message(save_item(&mut s, twice, &ctx())),
            "Each change to the schedule starts after the one before"
        );
        for repeat in [
            Repeat::Weeks { n: 53 },
            Repeat::Months { n: 13, day: 1 },
            Repeat::Months { n: 1, day: 32 },
            Repeat::Years { n: 11 },
        ] {
            assert!(check_repeat(repeat).is_err());
        }
        for repeat in [
            Repeat::Once,
            Repeat::Weeks { n: 2 },
            Repeat::Years { n: 1 },
            Repeat::Days { n: 365 },
        ] {
            assert!(check_repeat(repeat).is_ok());
        }
        assert!(s.items.is_empty());
    }

    #[test]
    fn changes_the_schedule_from_a_date_and_archives_and_deletes() {
        let mut s = Snapshot::default();
        save_item(&mut s, input("rent"), &ctx()).unwrap();
        let planned = change_schedule(
            &mut s,
            "rent",
            d(2027, 1, 1),
            Repeat::Months { n: 1, day: 1 },
            130_000,
            &ctx(),
        )
        .unwrap();
        assert_eq!(planned.writes.len(), 1);
        assert_eq!(s.items["rent"].schedule.len(), 2);
        // From before it started: a new schedule altogether
        change_schedule(
            &mut s,
            "rent",
            d(2026, 10, 1),
            Repeat::Weeks { n: 2 },
            1,
            &ctx(),
        )
        .unwrap();
        assert_eq!(s.items["rent"].schedule.len(), 1);
        assert!(change_schedule(&mut s, "rent", d(2027, 1, 1), Repeat::Once, -1, &ctx()).is_err());
        assert!(change_schedule(
            &mut s,
            "rent",
            d(2027, 1, 1),
            Repeat::Days { n: 0 },
            1,
            &ctx()
        )
        .is_err());
        assert_eq!(
            message(change_schedule(
                &mut s,
                "gone",
                d(2027, 1, 1),
                Repeat::Once,
                1,
                &ctx()
            )),
            "That bill isn't there any more (deleted on another device?)"
        );
        let mut full = input("full");
        full.schedule = (1..=24)
            .map(|day| Segment {
                from: d(2026, 1, day),
                until: None,
                repeat: Repeat::Once,
                amount_cents: 1,
            })
            .collect();
        save_item(&mut s, full, &ctx()).unwrap();
        assert!(change_schedule(&mut s, "full", d(2026, 2, 1), Repeat::Once, 1, &ctx()).is_err());

        assert_eq!(
            archive_item(&mut s, "rent", true, &ctx())
                .unwrap()
                .writes
                .len(),
            1
        );
        assert!(s.items["rent"].archived);
        assert_eq!(
            archive_item(&mut s, "rent", true, &ctx()).unwrap(),
            Planned::default()
        );
        assert!(archive_item(&mut s, "gone", true, &ctx()).is_err());

        set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 10, 1), OccStatus::Skipped),
            &ctx(),
        )
        .unwrap();
        set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 10, 15), OccStatus::Skipped),
            &ctx(),
        )
        .unwrap();
        let planned = delete_item(&mut s, "rent").unwrap();
        assert_eq!(planned.writes.len(), 3);
        assert!(planned.writes.iter().all(|write| write.json.is_none()));
        // Undoing puts the item back before its occurrences
        assert_eq!(planned.undo[0].kind, "item");
        assert!(s.overrides.is_empty() && !s.items.contains_key("rent"));
        assert!(delete_item(&mut s, "rent").is_err());
    }

    fn occurrence(item_id: &str, date: NaiveDate, status: OccStatus) -> OccurrenceInput {
        OccurrenceInput {
            item_id: item_id.into(),
            date,
            status,
            amount_cents: None,
            moved_to: None,
            note: None,
        }
    }

    #[test]
    fn records_what_happened_to_an_occurrence() {
        let mut s = Snapshot::default();
        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 11, 1),
                Repeat::Months { n: 1, day: 1 },
                100,
            ),
        );
        let paid = OccStatus::Done {
            on: d(2026, 11, 2),
            amount_cents: 100,
        };
        let planned = set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 11, 1), paid.clone()),
            &ctx(),
        )
        .unwrap();
        assert_eq!(planned.writes[0].doc_id, "occ~2026-11-01~rent");
        // The same again: nothing; open again: deleted
        assert_eq!(
            set_occurrence(&mut s, occurrence("rent", d(2026, 11, 1), paid), &ctx()).unwrap(),
            Planned::default()
        );
        let open = set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 11, 1), OccStatus::Open),
            &ctx(),
        )
        .unwrap();
        assert_eq!(open.writes[0].json, None);
        // Open with nothing recorded: nothing to write
        let again = set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 11, 1), OccStatus::Open),
            &ctx(),
        );
        assert_eq!(again.unwrap(), Planned::default());
        assert!(s.overrides.is_empty());
        // Moved (to where it already is: not moved) with a note
        let moved = OccurrenceInput {
            moved_to: Some(d(2026, 12, 1)),
            note: Some(" late fee waived ".into()),
            amount_cents: Some(90),
            ..occurrence("rent", d(2026, 12, 1), OccStatus::Open)
        };
        set_occurrence(&mut s, moved, &ctx()).unwrap();
        let kept = &s.overrides[&("rent".to_string(), d(2026, 12, 1))];
        assert_eq!(
            (kept.moved_to, kept.note.as_deref(), kept.amount_cents),
            (None, Some("late fee waived"), Some(90))
        );

        let refusals: Vec<(OccurrenceInput, &str)> = vec![
            (
                OccurrenceInput {
                    note: Some("x".repeat(501)),
                    ..occurrence("rent", d(2026, 11, 1), OccStatus::Open)
                },
                "Keep the note to 500 characters",
            ),
            (
                occurrence("rent", d(2026, 11, 2), OccStatus::Skipped),
                "It isn't due on that date",
            ),
            (
                occurrence("gone", d(2026, 11, 1), OccStatus::Skipped),
                "That bill isn't there any more (deleted on another device?)",
            ),
            (
                occurrence(
                    "rent",
                    d(2026, 11, 1),
                    OccStatus::Done {
                        on: d(2026, 11, 12),
                        amount_cents: 1,
                    },
                ),
                "It can't be paid later than tomorrow: mark it paid once it is",
            ),
            (
                occurrence(
                    "rent",
                    d(2026, 11, 1),
                    OccStatus::Done {
                        on: d(2026, 11, 1),
                        amount_cents: -1,
                    },
                ),
                "The amount paid must be between $0 and $10,000,000,000",
            ),
            (
                OccurrenceInput {
                    amount_cents: Some(-5),
                    ..occurrence("rent", d(2026, 11, 1), OccStatus::Open)
                },
                "The amount must be between $0 and $10,000,000,000",
            ),
            (
                OccurrenceInput {
                    moved_to: Some(d(2027, 2, 1)),
                    ..occurrence("rent", d(2026, 11, 1), OccStatus::Open)
                },
                "It can be moved up to 62 days either way",
            ),
        ];
        for (value, expected) in refusals {
            assert_eq!(message(set_occurrence(&mut s, value, &ctx())), expected);
        }
        // One the schedule no longer has can still be changed (it has a record)
        s.items.get_mut("rent").unwrap().schedule[0].from = d(2027, 1, 1);
        assert!(set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 12, 1), OccStatus::Skipped),
            &ctx()
        )
        .is_ok());
    }

    #[test]
    fn sets_the_balance_and_the_settings_separately() {
        let mut s = Snapshot::default();
        let balance = Balance {
            cents: -500,
            as_of: d(2026, 11, 10),
        };
        set_balance(&mut s, balance, &ctx()).unwrap();
        assert_eq!(s.settings().balance, Some(balance));
        for (bad, expected) in [
            (
                Balance {
                    cents: 1,
                    as_of: d(2026, 11, 11),
                },
                "Set the balance as of today or a day before",
            ),
            (
                Balance {
                    cents: 1,
                    as_of: d(2025, 11, 1),
                },
                "Set a balance from the past year",
            ),
            (
                Balance {
                    cents: MAX_CENTS + 1,
                    as_of: d(2026, 11, 10),
                },
                "The balance must be between -$10,000,000,000 and $10,000,000,000",
            ),
        ] {
            assert_eq!(message(set_balance(&mut s, bad, &ctx())), expected);
        }
        // Saving the settings keeps the balance
        let mut settings = Settings {
            horizon_days: 90,
            balance: None,
            ..Settings::default()
        };
        save_settings(&mut s, settings.clone()).unwrap();
        assert_eq!(s.settings().horizon_days, 90);
        assert_eq!(s.settings().balance, Some(balance));
        settings.taskmint.future = FutureEarnings::Weekly { cents: 50_000 };
        settings.taskmint.policy = WithdrawPolicy::Weekly {
            weekday: 6,
            hour: 23,
        };
        assert!(save_settings(&mut s, settings.clone()).is_ok());
        settings.taskmint.future = FutureEarnings::Trailing { weeks: 4 };
        assert!(save_settings(&mut s, settings.clone()).is_ok());

        let refused = |change: fn(&mut Settings)| {
            let mut value = Settings::default();
            change(&mut value);
            value
        };
        let cases: Vec<(Settings, &str)> = vec![
            (
                refused(|s| s.horizon_days = 13),
                "Look 14 to 366 days ahead",
            ),
            (
                refused(|s| s.low_balance_cents = -1),
                "The low balance must be between $0 and $10,000,000,000",
            ),
            (
                refused(|s| s.taskmint.min_withdrawal_cents = -1),
                "The smallest withdrawal must be between $0 and $10,000,000,000",
            ),
            (
                refused(|s| s.taskmint.arrival_delay_hours = 337),
                "A withdrawal can take up to two weeks to arrive",
            ),
            (
                refused(|s| {
                    s.taskmint.policy = WithdrawPolicy::Weekly {
                        weekday: 7,
                        hour: 0,
                    }
                }),
                "Choose a day of the week and an hour",
            ),
            (
                refused(|s| {
                    s.taskmint.policy = WithdrawPolicy::Weekly {
                        weekday: 0,
                        hour: 24,
                    }
                }),
                "Choose a day of the week and an hour",
            ),
            (
                refused(|s| s.taskmint.future = FutureEarnings::Weekly { cents: -1 }),
                "The weekly earnings must be between $0 and $10,000,000,000",
            ),
            (
                refused(|s| s.taskmint.future = FutureEarnings::Trailing { weeks: 13 }),
                "Average over 1 to 12 weeks",
            ),
            (
                refused(|s| s.reminders.hour = 24),
                "Remind at an hour of the day, up to 30 days before",
            ),
            (
                refused(|s| s.reminders.lead_days = 31),
                "Remind at an hour of the day, up to 30 days before",
            ),
        ];
        for (value, expected) in cases {
            assert_eq!(message(save_settings(&mut s, value)), expected);
        }
        assert_eq!(
            s.settings().taskmint,
            TaskMintPlan {
                future: FutureEarnings::Trailing { weeks: 4 },
                policy: WithdrawPolicy::Weekly {
                    weekday: 6,
                    hour: 23
                },
                ..TaskMintPlan::default()
            }
        );
    }

    #[test]
    fn leaves_what_a_newer_budgetmint_wrote_alone() {
        use crate::docs::IncomingDoc;
        let mut s = Snapshot::default();
        let monthly = Repeat::Months { n: 1, day: 1 };
        put_item(
            &mut s,
            item("rent", ItemKind::Bill, d(2026, 11, 1), monthly, 100),
        );
        let paid = OccStatus::Done {
            on: d(2026, 11, 2),
            amount_cents: 100,
        };
        set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 11, 1), paid.clone()),
            &ctx(),
        )
        .unwrap();
        set_balance(
            &mut s,
            Balance {
                cents: 1,
                as_of: d(2026, 11, 10),
            },
            &ctx(),
        )
        .unwrap();
        let newer = |doc_id: &str| IncomingDoc {
            doc_id: doc_id.into(),
            json: Some("{}".into()),
            schema: 2,
        };
        let refused = |result: Result<Planned, CoreError>| {
            assert_eq!(result.unwrap_err().to_string(), NEWER);
        };

        // An occurrence a newer one wrote: not set, and its item not deleted
        s.apply(vec![newer("occ~2026-11-01~rent")]);
        refused(set_occurrence(
            &mut s,
            occurrence("rent", d(2026, 11, 1), OccStatus::Open),
            &ctx(),
        ));
        refused(delete_item(&mut s, "rent"));
        // Its other occurrences still are
        set_occurrence(&mut s, occurrence("rent", d(2026, 12, 1), paid), &ctx()).unwrap();

        // The item: not saved, rescheduled, archived or deleted, nor its occurrences set
        s.apply(vec![newer("item~rent")]);
        let mut edit = input("rent");
        edit.name = "Flat".into();
        refused(save_item(&mut s, edit, &ctx()));
        refused(change_schedule(
            &mut s,
            "rent",
            d(2027, 1, 1),
            monthly,
            200,
            &ctx(),
        ));
        refused(archive_item(&mut s, "rent", true, &ctx()));
        refused(delete_item(&mut s, "rent"));
        refused(set_occurrence(
            &mut s,
            occurrence("rent", d(2027, 1, 1), OccStatus::Skipped),
            &ctx(),
        ));

        // The settings: neither the balance nor the rest
        s.apply(vec![newer("settings~account")]);
        let balance = Balance {
            cents: 2,
            as_of: d(2026, 11, 10),
        };
        refused(set_balance(&mut s, balance, &ctx()));
        refused(save_settings(&mut s, Settings::default()));
        assert_eq!(s.settings().balance.unwrap().cents, 1);
        assert_eq!(s.items["rent"].name, "RENT");
    }

    #[test]
    fn saves_an_edit_and_a_schedule_change_as_one() {
        let mut s = Snapshot::default();
        save_item(&mut s, input("rent"), &ctx()).unwrap();
        let mut edit = input("rent");
        edit.name = "Flat".into();
        let change = |amount_cents| ScheduleChange {
            from: d(2027, 1, 1),
            repeat: Repeat::Months { n: 1, day: 1 },
            amount_cents,
        };
        // The change refused: the name isn't saved either
        assert!(save_item_from(&mut s, edit.clone(), Some(change(-1)), &ctx()).is_err());
        assert_eq!(s.items["rent"].name, "Rent");
        // Both, in one write that one undo takes back
        let planned = save_item_from(&mut s, edit, Some(change(130_000)), &ctx()).unwrap();
        assert_eq!((planned.writes.len(), planned.undo.len()), (1, 1));
        let saved = &s.items["rent"];
        assert_eq!(saved.name, "Flat");
        assert_eq!(saved.schedule.len(), 2);
        assert_eq!(saved.schedule[1].amount_cents, 130_000);
    }

    #[test]
    fn undoes_a_change_only_while_it_still_stands() {
        let mut s = Snapshot::default();
        save_item(&mut s, input("rent"), &ctx()).unwrap();
        let archived = archive_item(&mut s, "rent", true, &ctx()).unwrap();
        // Still as it left it: its undo, which brings the item back as it was
        let writes = undo(&s, archived.clone()).unwrap();
        assert_eq!(writes, archived.undo);
        // Renamed since: undoing the archiving would take the new name back with it
        let mut edit = input("rent");
        edit.name = "Flat".into();
        edit.archived = true;
        save_item(&mut s, edit, &ctx()).unwrap();
        assert_eq!(undo(&s, archived).unwrap_err().to_string(), CHANGED_SINCE);
        // A deletion is undone while the item is still gone
        let deleted = delete_item(&mut s, "rent").unwrap();
        assert_eq!(undo(&s, deleted.clone()).unwrap(), deleted.undo);
    }
}
