//! The changes the user makes, as the documents they write. Each checks the
//! rules first (the messages say what to fix), takes effect in core's copy
//! at once, and comes with the writes that undo it. The client sends the
//! writes; their echo from Firestore changes nothing more.

use crate::docs::{valid_id, DocKey, DocWrite, Snapshot};
use crate::error::{invalid, invalid_at, CoreError, FormField};
use crate::model::{
    Account, Balance, Cents, FutureEarnings, Item, ItemKind, ItemReminder, Leg, OccStatus,
    Override, Repeat, SaveUp, Segment, Settings, Weekends, WithdrawPolicy, MAIN_ACCOUNT, MAX_CENTS,
    MAX_HORIZON_DAYS, MIN_HORIZON_DAYS,
};
use crate::occur::MOVE_DAYS;
use crate::recur::{is_item_date, item_dates};
use crate::time::{in_calendar, Ctx, FIRST_YEAR, LAST_YEAR};
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
/// The most bank accounts besides the main one.
pub const MAX_ACCOUNTS: usize = 12;

/// What a change writes, and what writing undoes it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub writes: Vec<DocWrite>,
    pub undo: Vec<DocWrite>,
}

impl Planned {
    pub(crate) fn add(&mut self, write: Option<(DocWrite, DocWrite)>) {
        if let Some((write, undo)) = write {
            self.writes.push(write);
            self.undo.insert(0, undo);
        }
    }

    /// `then`, made after this: its undo comes first.
    pub(crate) fn then(&mut self, then: Planned) {
        self.writes.extend(then.writes);
        self.undo.splice(0..0, then.undo);
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
    /// Its amount varies: expect the average of the last few paid.
    #[serde(default)]
    pub varies: bool,
    /// Set money aside for it ahead of each time (bills that come monthly or less often).
    #[serde(default)]
    pub save_up: bool,
    /// What's set aside for it already, as of today: given, setting aside
    /// starts over from today with it; none keeps what there is.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub saved_cents: Option<Cents>,
    /// The bank account it's in (a transfer's source); none: the main one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub account_id: Option<String>,
    /// Where a transfer goes; none: the main account.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub to_account_id: Option<String>,
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

/// A date the user gave, in core's calendar (a year typed with a digit
/// too many isn't).
pub(crate) fn check_date(date: NaiveDate) -> Result<(), CoreError> {
    if in_calendar(date) {
        Ok(())
    } else {
        Err(invalid(format!(
            "Choose a date from {} to {}",
            FIRST_YEAR, LAST_YEAR
        )))
    }
}

pub(crate) fn check_repeat(repeat: Repeat) -> Result<(), CoreError> {
    let ok = match repeat {
        Repeat::Once => true,
        Repeat::Days { n } => (1..=365).contains(&n),
        Repeat::Weeks { n } => (1..=52).contains(&n),
        Repeat::Months { n, day } => (1..=12).contains(&n) && (1..=31).contains(&day),
        Repeat::TwiceMonthly { first, second } => {
            if !(1..=31).contains(&first) || !(first + 1..=31).contains(&second) {
                return Err(invalid(
                    "Choose two days of the month for it, the earlier first",
                ));
            }
            true
        }
        Repeat::MonthWeekday { n, week, weekday } => {
            if !(1..=5).contains(&week) || weekday > 6 {
                return Err(invalid(
                    "Choose which week of the month (first to fourth, or last) and which day",
                ));
            }
            (1..=12).contains(&n)
        }
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

/// A rule's refusal (the checks below give only those), said of one of the form's fields.
fn at(field: FormField) -> impl Fn(CoreError) -> CoreError {
    move |error| CoreError::InvalidField(field, error.to_string())
}

fn check_schedule(schedule: &[Segment]) -> Result<(), CoreError> {
    if schedule.is_empty() || schedule.len() > MAX_SEGMENTS {
        return Err(invalid(format!(
            "A schedule has 1 to {} parts",
            MAX_SEGMENTS
        )));
    }
    for (index, segment) in schedule.iter().enumerate() {
        check_date(segment.from).map_err(at(FormField::Dates))?;
        segment
            .until
            .map_or(Ok(()), check_date)
            .map_err(at(FormField::Ends))?;
        check_repeat(segment.repeat).map_err(at(FormField::Repeat))?;
        cents(segment.amount_cents, "amount").map_err(at(FormField::Amount))?;
        if segment.until.is_some_and(|until| until < segment.from) {
            return Err(at(FormField::Ends)(invalid(
                "It can't end before it starts",
            )));
        }
        if index > 0 && segment.from <= schedule[index - 1].from {
            return Err(at(FormField::Dates)(invalid(
                "Each change to the schedule starts after the one before",
            )));
        }
    }
    Ok(())
}

/// Money is set aside for bills, a month or more apart: for one that comes
/// every few days or weeks, there's no time to.
fn check_save_up(kind: ItemKind, schedule: &[Segment]) -> Result<(), CoreError> {
    let often = schedule.iter().any(|segment| {
        matches!(
            segment.repeat,
            Repeat::Days { .. } | Repeat::Weeks { .. } | Repeat::TwiceMonthly { .. }
        )
    });
    if kind != ItemKind::Bill || often {
        return Err(invalid(
            "Money can be set aside for bills that come monthly or less often",
        ));
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

/// `category` as another item spells it, when one does ignoring case: one
/// category, not "Utilities" and "utilities".
fn spelled_as_before(snapshot: &Snapshot, id: &str, category: String) -> String {
    snapshot
        .items
        .values()
        .filter(|other| other.id != id)
        .filter_map(|other| other.category.as_ref())
        .find(|spelled| spelled.to_lowercase() == category.to_lowercase())
        .cloned()
        .unwrap_or(category)
}

/// What a change to a document a newer BudgetMint wrote is refused with.
pub const NEWER: &str =
    "A newer BudgetMint changed this. Update BudgetMint on this device to change it here.";

/// A document a newer BudgetMint wrote isn't this version's to change: it
/// would write back what it last read, without what the newer one added.
pub(crate) fn ours(snapshot: &Snapshot, key: &DocKey) -> Result<(), CoreError> {
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

/// The account an item names, as it's kept: none for the main one. Refused
/// when there's no such account, or it's archived and the item isn't.
fn item_account(
    snapshot: &Snapshot,
    id: Option<String>,
    archived: bool,
) -> Result<Option<String>, CoreError> {
    let Some(id) = id.filter(|id| id != MAIN_ACCOUNT) else {
        return Ok(None);
    };
    match snapshot.accounts.get(&id) {
        Some(account) if archived || !account.archived => Ok(Some(id)),
        Some(_) => Err(invalid_at(
            FormField::Account,
            "That account is archived: bring it back first, or choose another",
        )),
        None => Err(invalid_at(
            FormField::Account,
            "That account isn't there any more (deleted on another device?)",
        )),
    }
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
    /// Its last date (inclusive); none: it goes on.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub until: Option<NaiveDate>,
    /// Where its weekend dates go (they stay, without it).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub weekends: Option<Weekends>,
}

/// `schedule` with `change` from its date on: what comes before stays as it was.
fn rescheduled(mut schedule: Vec<Segment>, change: ScheduleChange) -> Vec<Segment> {
    schedule.retain(|segment| segment.from < change.from);
    schedule.push(Segment {
        from: change.from,
        until: change.until,
        repeat: change.repeat,
        amount_cents: change.amount_cents,
        weekends: change.weekends.unwrap_or_default(),
    });
    schedule
}

/// Adds an item, or saves an edit to one.
pub fn save_item(
    snapshot: &mut Snapshot,
    input: ItemInput,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    save_item_from(snapshot, input, None, false, ctx)
}

/// Saves an item and, with `change`, changes its schedule from a date on:
/// both or, when either is refused, neither. An `edit` is refused once the
/// item is gone (deleted on another device): saving it would bring it back.
pub fn save_item_from(
    snapshot: &mut Snapshot,
    mut input: ItemInput,
    change: Option<ScheduleChange>,
    edit: bool,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    if !valid_id(&input.id) {
        return Err(invalid("An item's id is 1–64 letters, digits and dashes"));
    }
    if edit {
        item(snapshot, &input.id)?;
    }
    ours(snapshot, &DocKey::Item(input.id.clone()))?;
    let name = text(Some(input.name), MAX_NAME, "name")
        .map_err(at(FormField::Name))?
        .ok_or_else(|| at(FormField::Name)(invalid("Give it a name")))?;
    let changed_from = change.map(|change| change.from);
    if let Some(change) = change {
        input.schedule = rescheduled(input.schedule, change);
    }
    check_schedule(&input.schedule)?;
    let existing = snapshot.items.get(&input.id);
    // Where the first one after the change would come in a period settled already
    let again = existing
        .zip(changed_from)
        .and_then(|(old, from)| settled_already(snapshot, old, &input.schedule, from));
    let created_at = existing.map_or(ctx.now, |existing| existing.created_at);
    let save_up = if input.save_up {
        // How often it comes is what refuses it
        check_save_up(input.kind, &input.schedule).map_err(at(FormField::Repeat))?;
        Some(match input.saved_cents {
            // Set aside from when it was turned on, as it was
            None => existing
                .and_then(|existing| existing.save_up)
                .unwrap_or(SaveUp {
                    since: ctx.today(),
                    saved_cents: None,
                }),
            // So much already: from today, with it
            Some(saved) => SaveUp {
                since: ctx.today(),
                saved_cents: (cents(saved, "amount set aside").map_err(at(FormField::Saved))? > 0)
                    .then_some(saved),
            },
        })
    } else {
        None
    };
    let category = text(input.category, MAX_CATEGORY, "category")
        .map_err(at(FormField::Category))?
        .map(|category| spelled_as_before(snapshot, &input.id, category));
    let account_id = item_account(snapshot, input.account_id, input.archived)?;
    let to_account_id = match input.kind {
        ItemKind::Transfer => {
            let to = item_account(snapshot, input.to_account_id, input.archived)?;
            if to == account_id {
                return Err(invalid_at(
                    FormField::Account,
                    "Choose two different accounts to move money between",
                ));
            }
            to
        }
        // Only a transfer goes anywhere
        ItemKind::Bill | ItemKind::Income => None,
    };
    let saved = Item {
        id: input.id,
        kind: input.kind,
        name,
        category,
        schedule: input.schedule,
        autopay: input.autopay,
        reminder: check_reminder(input.reminder).map_err(at(FormField::Reminder))?,
        archived: input.archived,
        note: text(input.note, MAX_NOTE, "note").map_err(at(FormField::Note))?,
        varies: input.varies,
        save_up,
        account_id,
        to_account_id,
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
    let mut planned = write_item(snapshot, &saved);
    if let Some(date) = again {
        planned.then(
            set_occurrence(
                snapshot,
                OccurrenceInput {
                    item_id: saved.id,
                    date,
                    status: OccStatus::Skipped,
                    amount_cents: None,
                    moved_to: None,
                    note: Some(SETTLED_ALREADY.into()),
                },
                ctx,
            )
            .expect("a date of the schedule just saved, with nothing on it, can be skipped"),
        );
    }
    Ok(planned)
}

/// The note on the one a schedule change would have asked for twice.
pub const SETTLED_ALREADY: &str = "Paid or skipped already, before its schedule changed.";

/// How many days shorter than the old gap the new one may be and still be the same rhythm.
const SAME_RHYTHM_DAYS: i64 = 3;

/// The first date of a schedule changed from `from` on, when it would ask
/// again for what's settled: paid on the 12th and then moved to the 20th,
/// the same month would be owed twice. That's so when the last one paid (or
/// skipped) is nearer to it than the next the old schedule had, and the new
/// one comes no more often than the old (a bill made fortnightly is wanted
/// each time). None when nothing's settled, or the date holds something.
fn settled_already(
    snapshot: &Snapshot,
    old: &Item,
    schedule: &[Segment],
    from: NaiveDate,
) -> Option<NaiveDate> {
    let far = Duration::days(366 * 11);
    let new = Item {
        schedule: schedule.to_vec(),
        ..old.clone()
    };
    let mut ahead = item_dates(&new, from, from + far)
        .into_iter()
        .map(|(date, _)| date);
    let first = ahead.next()?;
    let second = ahead.next()?;
    let last = snapshot
        .overrides
        .range((old.id.clone(), from - far)..(old.id.clone(), first))
        .rev()
        .find(|(_, over)| over.status != OccStatus::Open)
        .map(|((_, date), _)| *date)?;
    let old_next = item_dates(old, last + Duration::days(1), last + far)
        .first()
        .map(|(date, _)| *date)?;
    let nearer_the_last = first < old_next && first - last < old_next - first;
    let as_often = second - first + Duration::days(SAME_RHYTHM_DAYS) >= old_next - last;
    let free = !snapshot.overrides.contains_key(&(old.id.clone(), first));
    (nearer_the_last && as_often && free).then_some(first)
}

/// Something that happens once, recorded as it happens (or will): what
/// was spent or came in, on a day.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RecordInput {
    /// Made by the client, for the item it becomes.
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    pub amount_cents: Cents,
    pub on: NaiveDate,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// The bank account it's in (a transfer's source); none: the main one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub account_id: Option<String>,
    /// Where a transfer goes; none: the main account.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub to_account_id: Option<String>,
}

/// A one-off item, already paid (or received) when it's dated today or
/// before, and still to come when later: one change, with one undo.
pub fn record(
    snapshot: &mut Snapshot,
    input: RecordInput,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    if input.amount_cents <= 0 {
        return Err(invalid_at(FormField::Amount, "Enter the amount"));
    }
    if snapshot.items.contains_key(&input.id) {
        return Err(invalid("That's recorded already"));
    }
    let mut planned = save_item(
        snapshot,
        ItemInput {
            id: input.id.clone(),
            kind: input.kind,
            name: input.name,
            category: input.category,
            schedule: vec![Segment {
                from: input.on,
                until: None,
                repeat: Repeat::Once,
                amount_cents: input.amount_cents,
                weekends: Weekends::Keep,
            }],
            autopay: false,
            reminder: None,
            archived: false,
            note: input.note,
            varies: false,
            save_up: false,
            saved_cents: None,
            account_id: input.account_id,
            to_account_id: input.to_account_id,
        },
        ctx,
    )?;
    if input.on <= ctx.today() {
        planned.then(
            set_occurrence(
                snapshot,
                OccurrenceInput {
                    item_id: input.id,
                    date: input.on,
                    status: OccStatus::Done {
                        on: input.on,
                        amount_cents: input.amount_cents,
                    },
                    amount_cents: None,
                    moved_to: None,
                    note: None,
                },
                ctx,
            )
            // The item was just saved, on that day, for that amount: nothing to refuse
            .expect("a one-off just saved takes its payment"),
        );
    }
    Ok(planned)
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
        until: None,
        // Weekend dates go where they went
        weekends: changed.schedule.last().map(|last| last.weekends),
    };
    changed.schedule = rescheduled(changed.schedule, change);
    check_schedule(&changed.schedule)?;
    changed.updated_at = ctx.now;
    Ok(write_item(snapshot, &changed))
}

/// Replaces the budget with a backup's (crate::backup): each document it
/// has, written as it has it, and every other one deleted. All of it or
/// none, with the writes that undo it.
pub fn restore_budget(snapshot: &mut Snapshot, json: &str) -> Result<Planned, CoreError> {
    let restored = crate::backup::read_backup(json)?;
    let items: Vec<String> = snapshot.items.keys().cloned().collect();
    let accounts: Vec<String> = snapshot.accounts.keys().cloned().collect();
    let overrides: Vec<(String, NaiveDate)> = snapshot.overrides.keys().cloned().collect();
    let occ = |(item_id, date): &(String, NaiveDate)| DocKey::Occ {
        date: *date,
        item_id: item_id.clone(),
    };
    // A document a newer BudgetMint wrote isn't this one's to replace: checked first
    let mut keys = vec![DocKey::Settings];
    keys.extend(
        items
            .iter()
            .chain(restored.items.keys())
            .map(|id| DocKey::Item(id.clone())),
    );
    keys.extend(overrides.iter().chain(restored.overrides.keys()).map(occ));
    keys.extend(
        accounts
            .iter()
            .chain(restored.accounts.keys())
            .map(|id| DocKey::Account(id.clone())),
    );
    for key in &keys {
        ours(snapshot, key)?;
    }
    let mut planned = Planned::default();
    for at in overrides
        .iter()
        .filter(|at| !restored.overrides.contains_key(at))
    {
        planned.add(snapshot.write::<Override>(occ(at), None));
    }
    for id in items.iter().filter(|id| !restored.items.contains_key(*id)) {
        planned.add(snapshot.write::<Item>(DocKey::Item(id.clone()), None));
    }
    for id in accounts
        .iter()
        .filter(|id| !restored.accounts.contains_key(*id))
    {
        planned.add(snapshot.write::<Account>(DocKey::Account(id.clone()), None));
    }
    planned.add(snapshot.write(DocKey::Settings, restored.settings.as_ref()));
    for (id, account) in &restored.accounts {
        planned.add(snapshot.write(DocKey::Account(id.clone()), Some(account)));
    }
    for (id, item) in &restored.items {
        planned.add(snapshot.write(DocKey::Item(id.clone()), Some(item)));
    }
    for (at, over) in &restored.overrides {
        planned.add(snapshot.write(occ(at), Some(over)));
    }
    Ok(planned)
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
    if !archived {
        // Its accounts are still in use (an archived account holds only what's archived)
        item_account(snapshot, changed.account_id.clone(), false)?;
        item_account(snapshot, changed.to_account_id.clone(), false)?;
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
    check_date(input.date)?;
    input.moved_to.map_or(Ok(()), check_date)?;
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
        check_date(on)?;
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

/// The account `id` names, when it's in use: the main one, or another
/// that's there and not archived.
pub(crate) fn live_account(snapshot: &Snapshot, id: &str) -> Result<Account, CoreError> {
    if id == MAIN_ACCOUNT {
        return Ok(snapshot.main_account());
    }
    let found = account(snapshot, id)?;
    if found.archived {
        return Err(invalid("That account is archived: bring it back first"));
    }
    Ok(found.clone())
}

/// Whether `balance` is one `account_id`'s forecast can start from (and
/// the account's document this version's to change: the settings, for the
/// main one).
pub(crate) fn check_balance(
    snapshot: &Snapshot,
    account_id: &str,
    balance: Balance,
    ctx: &Ctx,
) -> Result<(), CoreError> {
    if account_id == MAIN_ACCOUNT {
        ours(snapshot, &DocKey::Settings)?;
    } else {
        live_account(snapshot, account_id)?;
    }
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
    Ok(())
}

/// Sets the balance the main account's forecast starts from.
pub fn set_balance(
    snapshot: &mut Snapshot,
    balance: Balance,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    set_account_balance(snapshot, MAIN_ACCOUNT, balance, ctx)
}

/// Sets the balance `account_id`'s forecast starts from.
pub fn set_account_balance(
    snapshot: &mut Snapshot,
    account_id: &str,
    balance: Balance,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    check_balance(snapshot, account_id, balance, ctx)?;
    Ok(write_balance(snapshot, account_id, balance, None))
}

/// Writes `account_id`'s balance (checked already) and, with them, its
/// checks: in the settings for the main account, in its own document for
/// another.
pub(crate) fn write_balance(
    snapshot: &mut Snapshot,
    account_id: &str,
    balance: Balance,
    checks: Option<Vec<crate::model::BalanceCheck>>,
) -> Planned {
    let mut planned = Planned::default();
    match snapshot.accounts.get(account_id) {
        Some(kept) if account_id != MAIN_ACCOUNT => {
            let updated = Account {
                balance: Some(balance),
                checks: checks.unwrap_or_else(|| kept.checks.clone()),
                ..kept.clone()
            };
            planned.add(snapshot.write(DocKey::Account(account_id.to_string()), Some(&updated)));
        }
        _ => {
            let settings = snapshot.settings();
            let updated = Settings {
                balance: Some(balance),
                checks: checks.unwrap_or_else(|| settings.checks.clone()),
                ..settings
            };
            planned.add(snapshot.write(DocKey::Settings, Some(&updated)));
        }
    }
    planned
}

/// Each account an item of `kind` moves money in, and which way: its own
/// for a bill or income, and where it goes too for a transfer.
fn legs(kind: ItemKind, account: &str, to: &str) -> Vec<(String, Leg)> {
    match kind {
        ItemKind::Bill => vec![(account.to_string(), Leg::Out)],
        ItemKind::Income => vec![(account.to_string(), Leg::In)],
        ItemKind::Transfer => vec![(account.to_string(), Leg::Out), (to.to_string(), Leg::In)],
    }
}

fn item_legs(item: &Item) -> Vec<(String, Leg)> {
    legs(
        item.kind,
        item.account(),
        item.to_account_id.as_deref().unwrap_or(MAIN_ACCOUNT),
    )
}

/// The balances once money paid (or received, or moved) on or before
/// their day is taken off them (or added): the user says it went after the
/// balance was set. Left as it is, a balance is taken to count it already,
/// and the forecast leaves it out. A transfer moves each of its two
/// accounts' balances that's dated on or after its day; a bill or income,
/// its own account's. Refused when it would move none. Checked before
/// anything is written.
fn moved_balances(
    snapshot: &Snapshot,
    legs: Vec<(String, Leg)>,
    amount_cents: Cents,
    on: NaiveDate,
    ctx: &Ctx,
) -> Result<Vec<(String, Balance)>, CoreError> {
    let mut moved = Vec::new();
    let mut why = "Set your balance first";
    for (account_id, leg) in legs {
        match snapshot.balance_of(&account_id) {
            None => {}
            Some(balance) if on > balance.as_of => {
                why = "It's after your balance's day: the forecast counts it already";
            }
            Some(balance) => {
                let now = Balance {
                    cents: balance.cents + leg.sign() * amount_cents,
                    as_of: balance.as_of,
                };
                check_balance(snapshot, &account_id, now, ctx)?;
                moved.push((account_id, now));
            }
        }
    }
    if moved.is_empty() {
        return Err(invalid(why));
    }
    Ok(moved)
}

fn write_moved(snapshot: &mut Snapshot, moved: Vec<(String, Balance)>) -> Planned {
    let mut planned = Planned::default();
    for (account_id, balance) in moved {
        planned.then(write_balance(snapshot, &account_id, balance, None));
    }
    planned
}

/// `record`, and with `from_balance`, what it records moves the balance
/// too (moved_balances): one change, with one undo.
pub fn record_with_balance(
    snapshot: &mut Snapshot,
    input: RecordInput,
    from_balance: bool,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let moved = if from_balance {
        let named = |id: &Option<String>| id.as_deref().unwrap_or(MAIN_ACCOUNT).to_string();
        let legs = legs(
            input.kind,
            &named(&input.account_id),
            &named(&input.to_account_id),
        );
        moved_balances(snapshot, legs, input.amount_cents, input.on, ctx)?
    } else {
        Vec::new()
    };
    let mut planned = record(snapshot, input, ctx)?;
    planned.then(write_moved(snapshot, moved));
    Ok(planned)
}

/// `set_occurrence`, and with `from_balance`, what was paid moves the
/// balance too (moved_balances): one change, with one undo.
pub fn set_occurrence_with_balance(
    snapshot: &mut Snapshot,
    input: OccurrenceInput,
    from_balance: bool,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let moved = if from_balance {
        let OccStatus::Done { on, amount_cents } = input.status else {
            return Err(invalid("Only what's paid moves the balance"));
        };
        let legs = item_legs(item(snapshot, &input.item_id)?);
        // Marked paid before, it moved the balance then (or the balance had it)
        if snapshot
            .overrides
            .get(&(input.item_id.clone(), input.date))
            .is_some_and(|over| matches!(over.status, OccStatus::Done { .. }))
        {
            return Err(invalid(
                "It's marked paid already: the balance stays as it is",
            ));
        }
        moved_balances(snapshot, legs, amount_cents, on, ctx)?
    } else {
        Vec::new()
    };
    let mut planned = set_occurrence(snapshot, input, ctx)?;
    planned.then(write_moved(snapshot, moved));
    Ok(planned)
}

/// Saves the settings (the balance is set_balance's, and stays as it is).
pub fn save_settings(snapshot: &mut Snapshot, settings: Settings) -> Result<Planned, CoreError> {
    ours(snapshot, &DocKey::Settings)?;
    if settings.currency.len() != 3 || !settings.currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(invalid(
            "Choose a currency by its three-letter code (USD, EUR)",
        ));
    }
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
    cents(settings.spending_weekly_cents, "everyday spending")?;
    // The balance and its checks are set_balance's and settle's: they stay as they are
    let saved = Settings {
        balance: snapshot.settings().balance,
        checks: snapshot.settings().checks,
        ..settings
    };
    let mut planned = Planned::default();
    planned.add(snapshot.write(DocKey::Settings, Some(&saved)));
    Ok(planned)
}

/// A bank account as the user edits it.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    /// Made by the client for a new one; "main" for the main account.
    pub id: String,
    pub name: String,
    /// Days below this are flagged low.
    #[serde(default)]
    pub low_balance_cents: Cents,
}

fn account<'a>(snapshot: &'a Snapshot, id: &str) -> Result<&'a Account, CoreError> {
    ours(snapshot, &DocKey::Account(id.to_string()))?;
    snapshot.accounts.get(id).ok_or_else(|| {
        CoreError::NotFound("That account isn't there any more (deleted on another device?)".into())
    })
}

/// Adds a bank account, or saves one's name and low mark. The main
/// account's name is kept in a document of its own, and its low mark in the
/// settings, where it's always been.
pub fn save_account(snapshot: &mut Snapshot, input: AccountInput) -> Result<Planned, CoreError> {
    if !valid_id(&input.id) {
        return Err(invalid(
            "An account's id is 1–64 letters, digits and dashes",
        ));
    }
    let key = DocKey::Account(input.id.clone());
    ours(snapshot, &key)?;
    let name = text(Some(input.name), MAX_NAME, "name")
        .map_err(at(FormField::Name))?
        .ok_or_else(|| invalid_at(FormField::Name, "Give it a name"))?;
    if let Some(other) = snapshot
        .all_accounts()
        .into_iter()
        .find(|other| other.id != input.id && other.name.to_lowercase() == name.to_lowercase())
    {
        // The main one may be out of sight (Settings lists it alone only once renamed): say so
        return Err(invalid_at(
            FormField::Name,
            if other.is_main() {
                "Your main account has that name"
            } else {
                "Another account has that name"
            },
        ));
    }
    let low_balance_cents = cents(input.low_balance_cents, "low balance")?;
    let existing = snapshot.accounts.get(&input.id).cloned();
    let extra: Vec<u32> = snapshot
        .accounts
        .values()
        .filter(|account| !account.is_main())
        .map(|account| account.order)
        .collect();
    let mut planned = Planned::default();
    let saved = match existing {
        _ if input.id == MAIN_ACCOUNT => {
            let settings = snapshot.settings();
            if settings.low_balance_cents != low_balance_cents {
                ours(snapshot, &DocKey::Settings)?;
                let settings = Settings {
                    low_balance_cents,
                    ..settings
                };
                planned.add(snapshot.write(DocKey::Settings, Some(&settings)));
            }
            // Only its name and place: the rest is the settings'
            Account {
                id: input.id,
                name,
                order: existing.map_or(0, |existing| existing.order),
                balance: None,
                low_balance_cents: 0,
                checks: Vec::new(),
                archived: false,
            }
        }
        Some(existing) => Account {
            name,
            low_balance_cents,
            ..existing
        },
        None if extra.len() >= MAX_ACCOUNTS => {
            return Err(invalid(format!(
                "BudgetMint keeps up to {} accounts besides the main one",
                MAX_ACCOUNTS
            )));
        }
        // After the ones there are
        None => Account {
            id: input.id,
            name,
            order: extra.into_iter().max().unwrap_or(0) + 1,
            balance: None,
            low_balance_cents,
            checks: Vec::new(),
            archived: false,
        },
    };
    planned.add(snapshot.write(key, Some(&saved)));
    Ok(planned)
}

/// Whether `item` is in `account_id`, or moves money to it.
fn uses(item: &Item, account_id: &str) -> bool {
    item.account_id.as_deref() == Some(account_id)
        || item.to_account_id.as_deref() == Some(account_id)
}

/// The main account is every budget's: it can't be archived or deleted.
fn not_main(account_id: &str) -> Result<(), CoreError> {
    if account_id == MAIN_ACCOUNT {
        return Err(invalid("The main account stays: every budget has it"));
    }
    Ok(())
}

/// Archives an account (it leaves the lists and the totals; its history
/// stays), or brings it back. Refused while anything not archived is in it.
pub fn archive_account(
    snapshot: &mut Snapshot,
    account_id: &str,
    archived: bool,
) -> Result<Planned, CoreError> {
    not_main(account_id)?;
    let mut changed = account(snapshot, account_id)?.clone();
    if archived
        && snapshot
            .items
            .values()
            .any(|item| !item.archived && uses(item, account_id))
    {
        return Err(invalid(
            "It still has bills, income or transfers: archive them or move them to another account first",
        ));
    }
    changed.archived = archived;
    let mut planned = Planned::default();
    planned.add(snapshot.write(DocKey::Account(account_id.to_string()), Some(&changed)));
    Ok(planned)
}

/// Deletes an account nothing is in (archived items too: their history names it).
pub fn delete_account(snapshot: &mut Snapshot, account_id: &str) -> Result<Planned, CoreError> {
    not_main(account_id)?;
    account(snapshot, account_id)?;
    if snapshot.items.values().any(|item| uses(item, account_id)) {
        return Err(invalid(
            "It has bills, income or transfers (archived ones too): archive the account instead",
        ));
    }
    let mut planned = Planned::default();
    planned.add(snapshot.write::<Account>(DocKey::Account(account_id.to_string()), None));
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
                weekends: crate::model::Weekends::Keep,
            }],
            autopay: false,
            reminder: Some(ItemReminder {
                lead_days: vec![3, 0, 3],
            }),
            archived: false,
            note: None,
            varies: false,
            save_up: false,
            saved_cents: None,
            account_id: None,
            to_account_id: None,
        }
    }

    #[test]
    fn records_a_one_off_paid_when_its_day_has_come_with_one_undo() {
        let mut s = Snapshot::default();
        let one = |id: &str, on: NaiveDate| RecordInput {
            id: id.into(),
            kind: ItemKind::Bill,
            name: "Repair".into(),
            amount_cents: 60_000,
            on,
            category: None,
            note: Some("Brakes".into()),
            account_id: None,
            to_account_id: None,
        };
        let planned = record(&mut s, one("repair", d(2026, 11, 9)), &ctx()).unwrap();
        assert_eq!(planned.writes.len(), 2);
        let repair = &s.items["repair"];
        assert_eq!(repair.schedule[0].repeat, Repeat::Once);
        assert!(repair.reminder.is_none());
        assert_eq!(repair.note.as_deref(), Some("Brakes"));
        assert_eq!(
            s.overrides[&("repair".to_string(), d(2026, 11, 9))].status,
            OccStatus::Done {
                on: d(2026, 11, 9),
                amount_cents: 60_000
            }
        );
        // Undone together: the payment first, then the item
        assert_eq!(planned.undo.len(), 2);
        assert!(planned.undo[0].doc_id.starts_with("occ~"));
        // Later: still to come
        let later = record(&mut s, one("later", d(2026, 12, 1)), &ctx()).unwrap();
        assert_eq!(later.writes.len(), 1);
        assert!(s.overrides.keys().all(|(id, _)| id != "later"));
        assert_eq!(
            message(record(&mut s, one("repair", d(2026, 11, 9)), &ctx())),
            "That's recorded already"
        );
        let mut unnamed = one("unnamed", d(2026, 11, 9));
        unnamed.name = " ".into();
        assert_eq!(
            record(&mut s, unnamed, &ctx()).unwrap_err().field(),
            Some(FormField::Name)
        );
        let mut nothing = one("nothing", d(2026, 11, 9));
        nothing.amount_cents = 0;
        assert_eq!(
            record(&mut s, nothing, &ctx()).unwrap_err().field(),
            Some(FormField::Amount)
        );
    }

    #[test]
    fn starts_setting_aside_over_from_what_is_set_aside_already() {
        let mut s = Snapshot::default();
        let mut goal = input("trip");
        goal.save_up = true;
        goal.saved_cents = Some(30_000);
        save_item(&mut s, goal.clone(), &ctx()).unwrap();
        let today = ctx().today();
        assert_eq!(
            s.items["trip"].save_up,
            Some(SaveUp {
                since: today,
                saved_cents: Some(30_000)
            })
        );
        // Saved again without one: as it was
        goal.saved_cents = None;
        goal.name = "Trip!".into();
        save_item(&mut s, goal.clone(), &ctx()).unwrap();
        assert_eq!(s.items["trip"].save_up.unwrap().saved_cents, Some(30_000));
        // None at all: nothing kept to say so
        goal.saved_cents = Some(0);
        save_item(&mut s, goal.clone(), &ctx()).unwrap();
        assert_eq!(s.items["trip"].save_up.unwrap().saved_cents, None);
        goal.saved_cents = Some(-1);
        assert_eq!(
            save_item(&mut s, goal, &ctx()).unwrap_err().field(),
            Some(FormField::Saved)
        );
    }

    #[test]
    fn keeps_a_category_as_another_item_spells_it() {
        let mut s = Snapshot::default();
        let mut power = item(
            "power",
            ItemKind::Bill,
            d(2026, 11, 1),
            Repeat::Months { n: 1, day: 1 },
            100,
        );
        power.category = Some("Utilities".into());
        put_item(&mut s, power);
        let mut water = input("water");
        water.category = Some(" utilities ".into());
        save_item(&mut s, water, &ctx()).unwrap();
        assert_eq!(s.items["water"].category.as_deref(), Some("Utilities"));
        // Another item still spells it so: one item alone can't respell the category
        let mut power = input("power");
        power.category = Some("UTILITIES".into());
        save_item(&mut s, power, &ctx()).unwrap();
        assert_eq!(s.items["power"].category.as_deref(), Some("Utilities"));
        let mut gym = input("gym");
        gym.category = Some("Health".into());
        save_item(&mut s, gym, &ctx()).unwrap();
        assert_eq!(s.items["gym"].category.as_deref(), Some("Health"));
    }

    #[test]
    fn says_which_field_a_refusal_is_about() {
        let field = |change: &dyn Fn(&mut ItemInput)| {
            let mut one = input("x");
            change(&mut one);
            save_item(&mut Snapshot::default(), one, &ctx())
                .unwrap_err()
                .field()
        };
        let segment =
            |change: fn(&mut Segment)| move |one: &mut ItemInput| change(&mut one.schedule[0]);
        assert_eq!(field(&|one| one.name = " ".into()), Some(FormField::Name));
        assert_eq!(
            field(&|one| one.name = "n".repeat(MAX_NAME + 1)),
            Some(FormField::Name)
        );
        assert_eq!(
            field(&|one| one.category = Some("c".repeat(MAX_CATEGORY + 1))),
            Some(FormField::Category)
        );
        assert_eq!(
            field(&|one| one.note = Some("n".repeat(MAX_NOTE + 1))),
            Some(FormField::Note)
        );
        assert_eq!(
            field(&segment(|s| s.amount_cents = -1)),
            Some(FormField::Amount)
        );
        assert_eq!(
            field(&segment(|s| s.repeat = Repeat::Weeks { n: 0 })),
            Some(FormField::Repeat)
        );
        assert_eq!(
            field(&segment(|s| s.from = d(1000, 1, 1))),
            Some(FormField::Dates)
        );
        assert_eq!(
            field(&segment(|s| s.until = Some(d(1000, 1, 1)))),
            Some(FormField::Ends)
        );
        assert_eq!(
            field(&segment(|s| s.until = Some(d(2026, 10, 1)))),
            Some(FormField::Ends)
        );
        assert_eq!(
            field(&|one| {
                let mut later = one.schedule[0].clone();
                later.from = d(2026, 10, 1);
                one.schedule.push(later);
            }),
            Some(FormField::Dates)
        );
        assert_eq!(
            field(&|one| one.reminder = Some(ItemReminder {
                lead_days: vec![99]
            })),
            Some(FormField::Reminder)
        );
        assert_eq!(
            field(&|one| {
                one.save_up = true;
                one.schedule[0].repeat = Repeat::Weeks { n: 1 };
            }),
            Some(FormField::Repeat)
        );
        // A refusal that isn't about a field isn't said of one
        assert_eq!(field(&|one| one.id = "?".into()), None);
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
            (bad(|i| i.schedule[0].from = d(20261, 11, 1)), "Choose a date from 1900 to 2199"),
            (bad(|i| i.schedule[0].until = Some(d(22026, 1, 1))), "Choose a date from 1900 to 2199"),
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
            Repeat::TwiceMonthly {
                first: 1,
                second: 15,
            },
            Repeat::TwiceMonthly {
                first: 30,
                second: 31,
            },
            Repeat::MonthWeekday {
                n: 1,
                week: 5,
                weekday: 6,
            },
        ] {
            assert!(check_repeat(repeat).is_ok());
        }
        let twice_wrong = "Choose two days of the month for it, the earlier first";
        let weekday_wrong =
            "Choose which week of the month (first to fourth, or last) and which day";
        for (repeat, expected) in [
            (Repeat::TwiceMonthly { first: 0, second: 15 }, twice_wrong),
            (Repeat::TwiceMonthly { first: 15, second: 15 }, twice_wrong),
            (Repeat::TwiceMonthly { first: 15, second: 32 }, twice_wrong),
            (Repeat::TwiceMonthly { first: 31, second: 31 }, twice_wrong),
            (Repeat::MonthWeekday { n: 1, week: 0, weekday: 4 }, weekday_wrong),
            (Repeat::MonthWeekday { n: 1, week: 6, weekday: 4 }, weekday_wrong),
            (Repeat::MonthWeekday { n: 1, week: 2, weekday: 7 }, weekday_wrong),
            (
                Repeat::MonthWeekday { n: 13, week: 2, weekday: 4 },
                "Choose how often it repeats: every 1–365 days, 1–52 weeks, 1–12 months or 1–10 years",
            ),
        ] {
            assert_eq!(check_repeat(repeat).unwrap_err().to_string(), expected);
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
                weekends: crate::model::Weekends::Keep,
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
    fn moves_the_balance_by_what_was_paid_after_it_was_set() {
        let mut s = Snapshot::default();
        let balance = |s: &Snapshot| s.settings().balance.unwrap().cents;
        let one = |id: &str, kind: ItemKind, on: NaiveDate| RecordInput {
            id: id.into(),
            kind,
            name: "Repair".into(),
            amount_cents: 60_000,
            on,
            category: None,
            note: None,
            account_id: None,
            to_account_id: None,
        };
        let repair = || one("repair", ItemKind::Bill, d(2026, 11, 10));
        assert_eq!(
            message(record_with_balance(&mut s, repair(), true, &ctx())),
            "Set your balance first"
        );
        // Today's (Nov 10) balance
        set_balance(
            &mut s,
            Balance {
                cents: 100_000,
                as_of: d(2026, 11, 10),
            },
            &ctx(),
        )
        .unwrap();
        let planned = record_with_balance(&mut s, repair(), true, &ctx()).unwrap();
        assert_eq!(balance(&s), 40_000);
        // One change: undone, the balance goes back first
        assert_eq!(planned.writes.len(), 3);
        assert_eq!(planned.undo[0].doc_id, "settings~account");
        // Income adds; without, the balance is taken to have it already
        record_with_balance(
            &mut s,
            one("refund", ItemKind::Income, d(2026, 11, 9)),
            true,
            &ctx(),
        )
        .unwrap();
        record_with_balance(
            &mut s,
            one("gift", ItemKind::Bill, d(2026, 11, 10)),
            false,
            &ctx(),
        )
        .unwrap();
        assert_eq!(balance(&s), 100_000);
        // After the balance's day the forecast counts it: refused, and nothing's written
        assert_eq!(
            message(record_with_balance(
                &mut s,
                one("later", ItemKind::Bill, d(2026, 11, 11)),
                true,
                &ctx()
            )),
            "It's after your balance's day: the forecast counts it already"
        );
        assert!(!s.items.contains_key("later"));

        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 11, 1),
                Repeat::Months { n: 1, day: 1 },
                30_000,
            ),
        );
        let paid = |on: NaiveDate| OccStatus::Done {
            on,
            amount_cents: 30_000,
        };
        assert_eq!(
            message(set_occurrence_with_balance(
                &mut s,
                occurrence("rent", d(2026, 11, 1), OccStatus::Skipped),
                true,
                &ctx()
            )),
            "Only what's paid moves the balance"
        );
        assert!(set_occurrence_with_balance(
            &mut s,
            occurrence("gone", d(2026, 11, 1), paid(d(2026, 11, 10))),
            true,
            &ctx()
        )
        .is_err());
        let planned = set_occurrence_with_balance(
            &mut s,
            occurrence("rent", d(2026, 11, 1), paid(d(2026, 11, 10))),
            true,
            &ctx(),
        )
        .unwrap();
        assert_eq!(balance(&s), 70_000);
        assert_eq!(planned.writes.len(), 2);
        // Paid already: it moved the balance then
        assert_eq!(
            message(set_occurrence_with_balance(
                &mut s,
                occurrence("rent", d(2026, 11, 1), paid(d(2026, 11, 9))),
                true,
                &ctx()
            )),
            "It's marked paid already: the balance stays as it is"
        );
        // Without: only the occurrence
        let planned = set_occurrence_with_balance(
            &mut s,
            occurrence("rent", d(2026, 11, 1), paid(d(2026, 11, 9))),
            false,
            &ctx(),
        )
        .unwrap();
        assert_eq!(planned.writes.len(), 1);
        assert_eq!(balance(&s), 70_000);
        // A balance it would push out of range: refused before anything's written
        set_balance(
            &mut s,
            Balance {
                cents: -MAX_CENTS,
                as_of: d(2026, 11, 10),
            },
            &ctx(),
        )
        .unwrap();
        let before = s.overrides.len();
        assert!(set_occurrence_with_balance(
            &mut s,
            occurrence("rent", d(2026, 12, 1), paid(d(2026, 11, 10))),
            true,
            &ctx()
        )
        .is_err());
        assert_eq!(s.overrides.len(), before);
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
            (
                occurrence("rent", d(1, 1, 1), OccStatus::Skipped),
                "Choose a date from 1900 to 2199",
            ),
            (
                OccurrenceInput {
                    moved_to: Some(d(20261, 11, 1)),
                    ..occurrence("rent", d(2026, 11, 1), OccStatus::Open)
                },
                "Choose a date from 1900 to 2199",
            ),
            (
                occurrence(
                    "rent",
                    d(2026, 11, 1),
                    OccStatus::Done {
                        on: d(1026, 11, 1),
                        amount_cents: 1,
                    },
                ),
                "Choose a date from 1900 to 2199",
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
                refused(|s| s.currency = "usd".into()),
                "Choose a currency by its three-letter code (USD, EUR)",
            ),
            (
                refused(|s| s.currency = "EURO".into()),
                "Choose a currency by its three-letter code (USD, EUR)",
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
            (
                refused(|s| s.spending_weekly_cents = -1),
                "The everyday spending must be between $0 and $10,000,000,000",
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
            schema: crate::docs::BUDGET_SCHEMA + 1,
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
    fn a_schedule_change_doesnt_ask_again_for_what_was_settled() {
        use crate::occur::tests::{over, put_over};
        let paid = |on| OccStatus::Done {
            on,
            amount_cents: 120_000,
        };
        // Rent on the 1st (input), or as said; and its schedule changed from a date on
        let bill = |s: &mut Snapshot, repeat: Repeat, from: NaiveDate| {
            let mut bill = input("rent");
            bill.schedule[0].repeat = repeat;
            bill.schedule[0].from = from;
            save_item(s, bill.clone(), &ctx()).unwrap();
            bill
        };
        let change = |from, repeat, until| ScheduleChange {
            from,
            repeat,
            amount_cents: 120_000,
            until,
            weekends: None,
        };
        let on_the = |day| Repeat::Months { n: 1, day };
        let skipped = |s: &Snapshot| -> Vec<NaiveDate> {
            s.overrides
                .values()
                .filter(|over| over.status == OccStatus::Skipped)
                .map(|over| over.date)
                .collect()
        };

        // Paid on the 1st, then moved to the 5th: November's isn't owed again
        let mut s = Snapshot::default();
        let rent = bill(&mut s, on_the(1), d(2026, 11, 1));
        // Nothing settled yet: nothing to skip
        let mut unpaid = s.clone();
        let to_5th = change(d(2026, 11, 2), on_the(5), None);
        save_item_from(&mut unpaid, rent.clone(), Some(to_5th), true, &ctx()).unwrap();
        assert!(skipped(&unpaid).is_empty());
        put_over(&mut s, over("rent", d(2026, 11, 1), paid(d(2026, 11, 1))));
        let before = s.clone();
        let planned = save_item_from(&mut s, rent.clone(), Some(to_5th), true, &ctx()).unwrap();
        assert_eq!(skipped(&s), vec![d(2026, 11, 5)]);
        let note = s.overrides[&("rent".to_string(), d(2026, 11, 5))]
            .note
            .clone();
        assert_eq!(note.as_deref(), Some(SETTLED_ALREADY));
        // One change, with one undo for both
        assert_eq!((planned.writes.len(), planned.undo.len()), (2, 2));

        // Made fortnightly: each one's wanted
        let mut often = before.clone();
        let fortnightly = change(d(2026, 11, 2), Repeat::Weeks { n: 2 }, None);
        save_item_from(&mut often, rent.clone(), Some(fortnightly), true, &ctx()).unwrap();
        assert!(skipped(&often).is_empty());
        // Once more only, or ending before it comes again: nothing to compare
        let mut once = before.clone();
        let last = change(d(2026, 11, 5), Repeat::Once, None);
        save_item_from(&mut once, rent.clone(), Some(last), true, &ctx()).unwrap();
        assert!(skipped(&once).is_empty());
        let mut ended = before.clone();
        let never = change(d(2026, 11, 2), on_the(5), Some(d(2026, 11, 3)));
        save_item_from(&mut ended, rent.clone(), Some(never), true, &ctx()).unwrap();
        assert!(skipped(&ended).is_empty());
        // The 5th holds something already: it's left as it is
        let mut held = before.clone();
        put_over(&mut held, over("rent", d(2026, 11, 5), OccStatus::Open));
        save_item_from(&mut held, rent.clone(), Some(to_5th), true, &ctx()).unwrap();
        assert!(skipped(&held).is_empty());

        // Paid on Oct 28, then moved earlier, to the 15th: that's November's, still owed
        let mut s = Snapshot::default();
        let rent = bill(&mut s, on_the(28), d(2026, 10, 28));
        put_over(&mut s, over("rent", d(2026, 10, 28), paid(d(2026, 10, 28))));
        let to_15th = change(d(2026, 11, 10), on_the(15), None);
        save_item_from(&mut s, rent, Some(to_15th), true, &ctx()).unwrap();
        assert!(skipped(&s).is_empty());

        // A one-off paid, then made monthly: the old schedule had no next to be nearer to
        let mut s = Snapshot::default();
        let rent = bill(&mut s, Repeat::Once, d(2026, 11, 1));
        put_over(&mut s, over("rent", d(2026, 11, 1), paid(d(2026, 11, 1))));
        save_item_from(&mut s, rent, Some(to_5th), true, &ctx()).unwrap();
        assert!(skipped(&s).is_empty());
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
            until: None,
            weekends: None,
        };
        // The change refused: the name isn't saved either
        assert!(save_item_from(&mut s, edit.clone(), Some(change(-1)), true, &ctx()).is_err());
        assert_eq!(s.items["rent"].name, "Rent");
        // Both, in one write that one undo takes back
        let planned =
            save_item_from(&mut s, edit.clone(), Some(change(130_000)), true, &ctx()).unwrap();
        assert_eq!((planned.writes.len(), planned.undo.len()), (1, 1));
        let saved = &s.items["rent"];
        assert_eq!(saved.name, "Flat");
        assert_eq!(saved.schedule.len(), 2);
        assert_eq!(saved.schedule[1].amount_cents, 130_000);
        // A change that ends: on a date after it starts
        let ending = |until| ScheduleChange {
            until: Some(until),
            ..change(130_000)
        };
        assert_eq!(
            message(save_item_from(
                &mut s,
                edit.clone(),
                Some(ending(d(2026, 12, 31))),
                true,
                &ctx()
            )),
            "It can't end before it starts"
        );
        save_item_from(
            &mut s,
            edit.clone(),
            Some(ending(d(2027, 6, 30))),
            true,
            &ctx(),
        )
        .unwrap();
        assert_eq!(s.items["rent"].schedule[1].until, Some(d(2027, 6, 30)));

        // Deleted on another device meanwhile: the edit would bring it back
        s.apply(vec![crate::docs::IncomingDoc {
            doc_id: "item~rent".into(),
            json: None,
            schema: 1,
        }]);
        assert_eq!(
            message(save_item_from(&mut s, edit.clone(), None, true, &ctx())),
            "That bill isn't there any more (deleted on another device?)"
        );
        assert!(s.items.is_empty());
        // Added (not an edit): it's made
        assert!(save_item_from(&mut s, edit, None, false, &ctx()).is_ok());
    }

    #[test]
    fn restores_a_backup_whole_and_undoes_it_whole() {
        let mut s = Snapshot::default();
        save_item(&mut s, input("rent"), &ctx()).unwrap();
        let skipped = occurrence("rent", d(2026, 11, 1), OccStatus::Skipped);
        set_occurrence(&mut s, skipped, &ctx()).unwrap();
        let backup = crate::backup::export(&s, &ctx()).backup;
        save_item(&mut s, input("gym"), &ctx()).unwrap();
        // The occurrence opened again since: the backup's skip comes back
        let open = occurrence("rent", d(2026, 11, 1), OccStatus::Open);
        set_occurrence(&mut s, open, &ctx()).unwrap();
        let planned = restore_budget(&mut s, &backup).unwrap();
        assert_eq!(s.items.keys().collect::<Vec<_>>(), vec!["rent"]);
        assert_eq!(
            s.overrides[&("rent".to_string(), d(2026, 11, 1))].status,
            OccStatus::Skipped
        );
        // Once more: nothing changes
        assert_eq!(restore_budget(&mut s, &backup).unwrap(), Planned::default());
        // Undone: gym back, and the occurrence open again
        let undone: Vec<String> = undo(&s, planned)
            .unwrap()
            .into_iter()
            .map(|write| write.doc_id)
            .collect();
        assert_eq!(undone, ["occ~2026-11-01~rent", "item~gym"]);
        // A newer BudgetMint's document isn't replaced: nothing is
        s.apply(vec![crate::docs::IncomingDoc {
            doc_id: "item~rent".into(),
            json: Some("{}".into()),
            schema: 9,
        }]);
        assert_eq!(message(restore_budget(&mut s, &backup)), NEWER);
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

    fn account_input(id: &str, name: &str, low_balance_cents: Cents) -> AccountInput {
        AccountInput {
            id: id.into(),
            name: name.into(),
            low_balance_cents,
        }
    }

    fn newer(doc_id: &str) -> crate::docs::IncomingDoc {
        crate::docs::IncomingDoc {
            doc_id: doc_id.into(),
            json: Some("{}".into()),
            schema: crate::docs::BUDGET_SCHEMA + 1,
        }
    }

    #[test]
    fn adds_and_names_bank_accounts_and_keeps_the_main_ones_in_the_settings() {
        let mut s = Snapshot::default();
        assert_eq!(
            message(save_account(&mut s, account_input("a b", "X", 0))),
            "An account's id is 1–64 letters, digits and dashes"
        );
        let unnamed = save_account(&mut s, account_input("savings", "  ", 0)).unwrap_err();
        assert_eq!(unnamed.field(), Some(FormField::Name));
        let long = save_account(&mut s, account_input("savings", &"x".repeat(81), 0)).unwrap_err();
        assert_eq!(long.field(), Some(FormField::Name));
        assert_eq!(
            message(save_account(
                &mut s,
                account_input("savings", "Savings", -1)
            )),
            "The low balance must be between $0 and $10,000,000,000"
        );

        let planned = save_account(&mut s, account_input("savings", " Savings ", 5_000)).unwrap();
        assert_eq!(planned.writes.len(), 1);
        assert_eq!(
            (planned.writes[0].doc_id.as_str(), planned.writes[0].schema),
            ("account~savings", 4)
        );
        assert_eq!(
            (
                s.accounts["savings"].name.as_str(),
                s.accounts["savings"].order
            ),
            ("Savings", 1)
        );
        // The next one comes after it
        save_account(&mut s, account_input("card", "Card", 0)).unwrap();
        assert_eq!(s.accounts["card"].order, 2);
        // One name each, whatever its letters' case: the main account's too,
        // said as its (alone, it's the one account Settings may not list)
        for (taken, why) in [
            ("savings", "Another account has that name"),
            ("MAIN ACCOUNT", "Your main account has that name"),
        ] {
            let refused = save_account(&mut s, account_input("x", taken, 0)).unwrap_err();
            assert_eq!(refused.to_string(), why);
            assert_eq!(refused.field(), Some(FormField::Name));
        }
        // Renamed, with another low mark: its place and balance stay
        save_account(&mut s, account_input("savings", "Rainy day", 7_000)).unwrap();
        let savings = &s.accounts["savings"];
        assert_eq!(
            (
                savings.name.as_str(),
                savings.order,
                savings.low_balance_cents
            ),
            ("Rainy day", 1, 7_000)
        );
        // Saved as it is: nothing to write
        assert_eq!(
            save_account(&mut s, account_input("savings", "Rainy day", 7_000)).unwrap(),
            Planned::default()
        );

        // The main account's name is a document of its own, and no settings are written for it
        let named = save_account(&mut s, account_input(MAIN_ACCOUNT, "Checking", 0)).unwrap();
        assert_eq!(named.writes.len(), 1);
        assert_eq!(named.writes[0].doc_id, "account~main");
        assert!(s.settings.is_none());
        // Its low mark is the settings', as ever
        let marked = save_account(&mut s, account_input(MAIN_ACCOUNT, "Checking", 2_500)).unwrap();
        assert_eq!(marked.writes.len(), 1);
        assert_eq!(marked.writes[0].doc_id, "settings~account");
        assert_eq!(s.settings().low_balance_cents, 2_500);
        assert_eq!(s.accounts[MAIN_ACCOUNT].low_balance_cents, 0);
        let main = s.account(MAIN_ACCOUNT).unwrap();
        assert_eq!(
            (main.name.as_str(), main.low_balance_cents),
            ("Checking", 2_500)
        );

        // So many and no more (the main one aside)
        for n in 2..MAX_ACCOUNTS {
            save_account(
                &mut s,
                account_input(&format!("a{}", n), &format!("A {}", n), 0),
            )
            .unwrap();
        }
        assert_eq!(
            message(save_account(&mut s, account_input("more", "More", 0))),
            "BudgetMint keeps up to 12 accounts besides the main one"
        );
        // One there already can still be saved
        save_account(&mut s, account_input("card", "Credit card", 0)).unwrap();

        // What a newer BudgetMint wrote isn't this one's to change
        s.apply(vec![newer("account~held"), newer("settings~account")]);
        assert_eq!(
            message(save_account(&mut s, account_input("held", "Held", 0))),
            NEWER
        );
        assert_eq!(
            message(save_account(
                &mut s,
                account_input(MAIN_ACCOUNT, "Checking", 1)
            )),
            NEWER
        );
    }

    #[test]
    fn puts_an_item_in_an_account_and_moves_money_between_two() {
        let mut s = Snapshot::default();
        save_account(&mut s, account_input("savings", "Savings", 0)).unwrap();
        let in_account =
            |id: &str, kind: ItemKind, from: Option<&str>, to: Option<&str>| ItemInput {
                kind,
                account_id: from.map(str::to_string),
                to_account_id: to.map(str::to_string),
                ..input(id)
            };
        let field = |result: Result<Planned, CoreError>| {
            let refused = result.unwrap_err();
            assert_eq!(refused.field(), Some(FormField::Account));
            refused.to_string()
        };
        // A bill in savings: a newer document, with its account
        let fee = in_account("fee", ItemKind::Bill, Some("savings"), Some("savings"));
        let planned = save_item(&mut s, fee, &ctx()).unwrap();
        assert_eq!(planned.writes[0].schema, 4);
        // Only a transfer goes anywhere
        assert_eq!(
            (
                s.items["fee"].account_id.as_deref(),
                &s.items["fee"].to_account_id
            ),
            (Some("savings"), &None)
        );
        // "main" is no account of its own: it's kept as none
        let rent = in_account("rent", ItemKind::Bill, Some(MAIN_ACCOUNT), None);
        let planned = save_item(&mut s, rent, &ctx()).unwrap();
        assert_eq!(planned.writes[0].schema, crate::docs::BASE_SCHEMA);
        assert_eq!(s.items["rent"].account_id, None);

        // A transfer names two accounts that are there, and not the same one
        let put = in_account("put", ItemKind::Transfer, None, Some("savings"));
        save_item(&mut s, put, &ctx()).unwrap();
        assert_eq!(s.items["put"].to_account(), Some("savings"));
        let take = in_account(
            "take",
            ItemKind::Transfer,
            Some("savings"),
            Some(MAIN_ACCOUNT),
        );
        save_item(&mut s, take, &ctx()).unwrap();
        assert_eq!(
            (s.items["take"].account(), s.items["take"].to_account()),
            ("savings", Some(MAIN_ACCOUNT))
        );
        let different = "Choose two different accounts to move money between";
        for (from, to) in [(None, None), (Some("savings"), Some("savings"))] {
            let same = in_account("same", ItemKind::Transfer, from, to);
            assert_eq!(field(save_item(&mut s, same, &ctx())), different);
        }
        let gone = "That account isn't there any more (deleted on another device?)";
        let from_gone = in_account("x", ItemKind::Bill, Some("gone"), None);
        assert_eq!(field(save_item(&mut s, from_gone, &ctx())), gone);
        let to_gone = in_account("x", ItemKind::Transfer, None, Some("gone"));
        assert_eq!(field(save_item(&mut s, to_gone, &ctx())), gone);
        // Money isn't set aside for a transfer
        let mut saved_for = in_account("x", ItemKind::Transfer, None, Some("savings"));
        saved_for.save_up = true;
        assert_eq!(
            message(save_item(&mut s, saved_for, &ctx())),
            "Money can be set aside for bills that come monthly or less often"
        );

        // Recorded once: a transfer made today is done, in both its accounts
        let moved = RecordInput {
            id: "moved".into(),
            kind: ItemKind::Transfer,
            name: "To savings".into(),
            amount_cents: 2_000,
            on: d(2026, 11, 10),
            category: None,
            note: None,
            account_id: None,
            to_account_id: Some("savings".into()),
        };
        let planned = record(&mut s, moved, &ctx()).unwrap();
        assert_eq!(planned.writes.len(), 2);
        assert_eq!(s.items["moved"].to_account(), Some("savings"));
    }

    #[test]
    fn archives_an_account_once_nothing_live_is_in_it_and_deletes_an_empty_one() {
        let mut s = Snapshot::default();
        save_account(&mut s, account_input("savings", "Savings", 0)).unwrap();
        save_account(&mut s, account_input("card", "Card", 0)).unwrap();
        let stays = "The main account stays: every budget has it";
        assert_eq!(message(archive_account(&mut s, MAIN_ACCOUNT, true)), stays);
        assert_eq!(message(delete_account(&mut s, MAIN_ACCOUNT)), stays);
        let gone = "That account isn't there any more (deleted on another device?)";
        assert_eq!(message(archive_account(&mut s, "gone", true)), gone);
        assert_eq!(message(delete_account(&mut s, "gone")), gone);

        let fee = ItemInput {
            account_id: Some("savings".into()),
            ..input("fee")
        };
        save_item(&mut s, fee.clone(), &ctx()).unwrap();
        let put = ItemInput {
            kind: ItemKind::Transfer,
            to_account_id: Some("card".into()),
            ..input("put")
        };
        save_item(&mut s, put, &ctx()).unwrap();
        let in_use = "It still has bills, income or transfers: archive them or move them to another account first";
        assert_eq!(message(archive_account(&mut s, "savings", true)), in_use);
        assert_eq!(message(archive_account(&mut s, "card", true)), in_use);
        let has_some =
            "It has bills, income or transfers (archived ones too): archive the account instead";
        assert_eq!(message(delete_account(&mut s, "savings")), has_some);

        // Its items archived, it can be: out of use, its history kept
        archive_item(&mut s, "fee", true, &ctx()).unwrap();
        archive_item(&mut s, "put", true, &ctx()).unwrap();
        let archived = archive_account(&mut s, "savings", true).unwrap();
        assert_eq!(archived.writes[0].doc_id, "account~savings");
        assert!(s.accounts["savings"].archived);
        archive_account(&mut s, "card", true).unwrap();
        // Archived again: nothing to write
        assert_eq!(
            archive_account(&mut s, "card", true).unwrap(),
            Planned::default()
        );
        assert_eq!(message(delete_account(&mut s, "savings")), has_some);

        // Nothing live goes into an archived account, or comes back in one
        let closed = "That account is archived: bring it back first, or choose another";
        let refused = save_item(&mut s, fee.clone(), &ctx()).unwrap_err();
        assert_eq!(refused.to_string(), closed);
        assert_eq!(refused.field(), Some(FormField::Account));
        assert_eq!(message(archive_item(&mut s, "fee", false, &ctx())), closed);
        assert_eq!(message(archive_item(&mut s, "put", false, &ctx())), closed);
        // An archived item in it can still be edited
        let renamed = ItemInput {
            name: "Old fee".into(),
            archived: true,
            ..fee
        };
        save_item(&mut s, renamed, &ctx()).unwrap();
        assert_eq!(s.items["fee"].name, "Old fee");

        // Brought back, so can they be
        archive_account(&mut s, "savings", false).unwrap();
        archive_account(&mut s, "card", false).unwrap();
        archive_item(&mut s, "fee", false, &ctx()).unwrap();
        archive_item(&mut s, "put", false, &ctx()).unwrap();
        // Empty, an account is deleted, and that's undone with it as it was
        delete_item(&mut s, "fee").unwrap();
        let deleted = delete_account(&mut s, "savings").unwrap();
        assert_eq!(deleted.writes[0].json, None);
        assert!(deleted.undo[0].json.as_ref().unwrap().contains("Savings"));
        assert!(!s.accounts.contains_key("savings"));

        // A newer BudgetMint's account is left alone
        s.apply(vec![newer("account~card")]);
        assert_eq!(message(archive_account(&mut s, "card", true)), NEWER);
        assert_eq!(message(delete_account(&mut s, "card")), NEWER);
    }

    #[test]
    fn moves_the_balance_of_each_account_the_money_is_in() {
        let mut s = Snapshot::default();
        for (id, name) in [("savings", "Savings"), ("card", "Card"), ("old", "Old")] {
            save_account(&mut s, account_input(id, name, 0)).unwrap();
        }
        // The main account named: its balance is the settings' all the same
        save_account(&mut s, account_input(MAIN_ACCOUNT, "Checking", 0)).unwrap();
        archive_account(&mut s, "old", true).unwrap();
        let on = |day| d(2026, 11, day);
        let balance = |cents, day| Balance {
            cents,
            as_of: on(day),
        };
        let set = set_balance(&mut s, balance(10_000, 10), &ctx()).unwrap();
        assert_eq!(set.writes[0].doc_id, "settings~account");
        let set = set_account_balance(&mut s, "savings", balance(5_000, 10), &ctx()).unwrap();
        assert_eq!(set.writes[0].doc_id, "account~savings");
        assert_eq!(
            message(set_account_balance(&mut s, "gone", balance(1, 10), &ctx())),
            "That account isn't there any more (deleted on another device?)"
        );
        assert_eq!(
            message(set_account_balance(&mut s, "old", balance(1, 10), &ctx())),
            "That account is archived: bring it back first"
        );
        assert_eq!(
            message(set_account_balance(
                &mut s,
                "savings",
                balance(1, 11),
                &ctx()
            )),
            "Set the balance as of today or a day before"
        );
        let cents = |s: &Snapshot| {
            (
                s.settings().balance.unwrap().cents,
                s.accounts["savings"].balance.unwrap().cents,
            )
        };
        let one = |id: &str, kind: ItemKind, day: u32, from: Option<&str>, to: Option<&str>| {
            RecordInput {
                id: id.into(),
                kind,
                name: id.into(),
                amount_cents: 1_000,
                on: on(day),
                category: None,
                note: None,
                account_id: from.map(str::to_string),
                to_account_id: to.map(str::to_string),
            }
        };
        // Moved from the main account to savings today: out of the one, into the other
        let put = one("put", ItemKind::Transfer, 10, None, Some("savings"));
        let planned = record_with_balance(&mut s, put, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (9_000, 6_000));
        let written: Vec<&str> = planned.writes.iter().map(|w| w.doc_id.as_str()).collect();
        assert_eq!(
            written,
            [
                "item~put",
                "occ~2026-11-10~put",
                "settings~account",
                "account~savings"
            ]
        );
        // A bill and income in savings: its balance alone
        let fee = one("fee", ItemKind::Bill, 10, Some("savings"), None);
        record_with_balance(&mut s, fee, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (9_000, 5_000));
        let interest = one("interest", ItemKind::Income, 10, Some("savings"), None);
        record_with_balance(&mut s, interest, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (9_000, 6_000));
        // To an account with no balance yet: only where it leaves
        let pay_card = one(
            "pay-card",
            ItemKind::Transfer,
            10,
            Some("savings"),
            Some("card"),
        );
        record_with_balance(&mut s, pay_card, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (9_000, 5_000));
        assert_eq!(s.accounts["card"].balance, None);
        // All in an account with none: nothing to move, and nothing recorded
        let due = one("due", ItemKind::Bill, 10, Some("card"), None);
        assert_eq!(
            message(record_with_balance(&mut s, due, true, &ctx())),
            "Set your balance first"
        );
        assert!(!s.items.contains_key("due"));

        // Savings' balance as of the 8th: a transfer on the 9th is after it (its forecast counts
        // it), and on or before the main account's, which moves
        set_account_balance(&mut s, "savings", balance(5_000, 8), &ctx()).unwrap();
        let later = one("later", ItemKind::Transfer, 9, None, Some("savings"));
        record_with_balance(&mut s, later, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (8_000, 5_000));
        let after = "It's after your balance's day: the forecast counts it already";
        let late_fee = one("late-fee", ItemKind::Bill, 9, Some("savings"), None);
        assert_eq!(
            message(record_with_balance(&mut s, late_fee, true, &ctx())),
            after
        );
        // With no balance on the other side either, that's still why
        let nowhere = one(
            "nowhere",
            ItemKind::Transfer,
            9,
            Some("savings"),
            Some("card"),
        );
        assert_eq!(
            message(record_with_balance(&mut s, nowhere, true, &ctx())),
            after
        );

        // Marked paid on its balance's day: the account it's in
        let rent = ItemInput {
            account_id: Some("savings".into()),
            ..input("rent")
        };
        save_item(&mut s, rent, &ctx()).unwrap();
        let paid = occurrence(
            "rent",
            d(2026, 11, 1),
            OccStatus::Done {
                on: on(8),
                amount_cents: 100,
            },
        );
        let planned = set_occurrence_with_balance(&mut s, paid, true, &ctx()).unwrap();
        assert_eq!(cents(&s), (8_000, 4_900));
        assert_eq!(planned.writes[1].doc_id, "account~savings");

        // A newer BudgetMint's account isn't this one's to set a balance in
        s.apply(vec![newer("account~card")]);
        assert_eq!(
            message(set_account_balance(&mut s, "card", balance(1, 10), &ctx())),
            NEWER
        );
    }

    #[test]
    fn restores_a_backups_accounts_and_drops_the_ones_it_hasnt() {
        let mut s = Snapshot::default();
        save_account(&mut s, account_input("savings", "Savings", 0)).unwrap();
        let fee = ItemInput {
            account_id: Some("savings".into()),
            ..input("fee")
        };
        save_item(&mut s, fee, &ctx()).unwrap();
        let backup = crate::backup::export(&s, &ctx()).backup;
        // Since: savings renamed, and another account added
        save_account(&mut s, account_input("savings", "Rainy day", 0)).unwrap();
        save_account(&mut s, account_input("card", "Card", 0)).unwrap();
        let planned = restore_budget(&mut s, &backup).unwrap();
        assert_eq!(s.accounts.keys().collect::<Vec<_>>(), ["savings"]);
        assert_eq!(s.accounts["savings"].name, "Savings");
        let written: Vec<&str> = planned
            .writes
            .iter()
            .map(|write| write.doc_id.as_str())
            .collect();
        assert_eq!(written, ["account~card", "account~savings"]);
        // An account a newer BudgetMint wrote isn't replaced: nothing is
        s.apply(vec![newer("account~savings")]);
        assert_eq!(message(restore_budget(&mut s, &backup)), NEWER);
    }
}
