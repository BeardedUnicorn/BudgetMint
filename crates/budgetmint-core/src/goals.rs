//! Money set aside for bills (`Item::save_up`): ahead of each time a bill is
//! due, its amount is put by a part a month, from the day after the time
//! before (or the day saving began) until it's due, so a yearly bill takes a
//! twelfth a month instead of all at once. A once-only bill (a holiday, a
//! new laptop) is a savings goal: its amount by its day.
//!
//! The money stays in the account: the balance is what it is, but what's
//! set aside isn't free to spend (the overview's safe to spend leaves it
//! out). It's freed when the bill takes it: the day it's paid, or the day
//! the cash flow counts it due (today, for one overdue). A time that's
//! skipped has nothing set aside for it.

use crate::docs::Snapshot;
use crate::model::{Cents, OccStatus};
use crate::occur::item_occurrences;
use crate::project::settled_through;
use crate::time::Ctx;
use chrono::{Duration, Months, NaiveDate};
use serde::{Deserialize, Serialize};

/// The most parts a time is saved up in: ten years of months.
pub const MAX_PARTS: u32 = 120;

/// How far back to look for the time before (the longest a schedule
/// allows between two: ten years, and a bit).
const LOOK_BACK_DAYS: i64 = 11 * 366;

/// One time a bill is saved up for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saving {
    pub item_id: String,
    pub name: String,
    /// Which time (the schedule's date) and when it's due.
    pub scheduled: NaiveDate,
    pub due: NaiveDate,
    /// What's put by for it.
    pub cents: Cents,
    /// Each part's day and amount, soonest first.
    pub parts: Vec<(NaiveDate, Cents)>,
    /// The day the bill takes it (and it's no longer set aside).
    pub freed: NaiveDate,
}

impl Saving {
    /// What's set aside for it by the end of `date`.
    pub fn on(&self, date: NaiveDate) -> Cents {
        if date >= self.freed {
            return 0;
        }
        self.parts
            .iter()
            .take_while(|(day, _)| *day <= date)
            .map(|(_, cents)| cents)
            .sum()
    }
}

/// The days `cents` is put by on: the day saving starts, then a month on
/// from it each time, while before `by`.
fn part_days(start: NaiveDate, by: NaiveDate) -> Vec<NaiveDate> {
    (0..MAX_PARTS)
        .map_while(|k| start.checked_add_months(Months::new(k)))
        .take_while(|day| *day < by)
        .collect()
}

/// `cents` in `n` parts as even as cents allow (the larger ones last).
fn split(cents: Cents, n: usize) -> Vec<Cents> {
    let n = n as i64;
    (0..n)
        .map(|k| (k + 1) * cents / n - k * cents / n)
        .collect()
}

/// Every time a bill is saved up for that's set aside on some day in
/// [from, to]: soonest due first.
pub fn savings(snapshot: &Snapshot, ctx: &Ctx, from: NaiveDate, to: NaiveDate) -> Vec<Saving> {
    let today = ctx.today();
    let settled = settled_through(&snapshot.settings(), today);
    let mut found = Vec::new();
    for item in snapshot.items.values().filter(|item| !item.archived) {
        let Some(save_up) = item.save_up else {
            continue;
        };
        let back = from - Duration::days(LOOK_BACK_DAYS);
        // Past the window, the first time due: it's saved up for in it
        let ahead = to + Duration::days(LOOK_BACK_DAYS);
        let mut before: Option<NaiveDate> = None;
        for occurrence in item_occurrences(snapshot, item, back.max(save_up.since), ahead) {
            let start = before.map_or(save_up.since, |due| {
                (due + Duration::days(1)).max(save_up.since)
            });
            before = Some(occurrence.due);
            let (by, cents, freed) = match occurrence.status {
                OccStatus::Skipped => continue,
                OccStatus::Done { on, amount_cents } => (on.min(occurrence.due), amount_cents, on),
                OccStatus::Open => {
                    let freed = if occurrence.due > settled {
                        occurrence.due.max(today)
                    } else {
                        occurrence.due
                    };
                    (occurrence.due, occurrence.expected_cents, freed)
                }
            };
            let days = part_days(start, by);
            let saving = Saving {
                item_id: item.id.clone(),
                name: item.name.clone(),
                scheduled: occurrence.scheduled,
                due: occurrence.due,
                cents,
                parts: days.iter().copied().zip(split(cents, days.len())).collect(),
                freed,
            };
            let meets = saving.parts.first().is_some_and(|(first, _)| *first <= to) && freed > from;
            if meets {
                found.push(saving);
            }
            if start > to {
                break;
            }
        }
    }
    found.sort_by(|a, b| (a.due, &a.name).cmp(&(b.due, &b.name)));
    found
}

/// What's set aside by the end of `date`, for every bill.
pub fn set_aside_on(savings: &[Saving], date: NaiveDate) -> Cents {
    savings.iter().map(|saving| saving.on(date)).sum()
}

/// A bill saved up for, as the savings page shows it: the next time it's due.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct GoalView {
    pub item_id: String,
    pub name: String,
    pub category: Option<String>,
    /// Which time (the schedule's date), and when it's due.
    pub scheduled: NaiveDate,
    pub due: NaiveDate,
    /// What it's saved up to.
    pub target_cents: Cents,
    /// Set aside for it by the end of today.
    pub set_aside_cents: Cents,
    /// The next part, and when (none left: it's all set aside).
    pub next_part: Option<GoalPart>,
    /// The parts still to come, the next among them.
    pub parts_left: u32,
    /// It happens once (a goal), rather than coming round.
    pub once: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct GoalPart {
    pub date: NaiveDate,
    pub cents: Cents,
}

/// The savings page: each bill saved up for, at its next time still to
/// come (soonest first), and what's set aside in all today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct GoalsView {
    pub today: NaiveDate,
    pub goals: Vec<GoalView>,
    pub set_aside_cents: Cents,
}

pub fn goals(snapshot: &Snapshot, ctx: &Ctx) -> GoalsView {
    let today = ctx.today();
    // As far ahead as the next time saving for one begins (after one skipped, a while)
    let all = savings(snapshot, ctx, today, today + Duration::days(LOOK_BACK_DAYS));
    let mut goals = Vec::new();
    for item in snapshot
        .items
        .values()
        .filter(|item| item.save_up.is_some() && !item.archived)
    {
        // Its first time not yet taken: the one being saved for now (or next)
        let next = all
            .iter()
            .filter(|saving| saving.item_id == item.id && saving.freed > today)
            .min_by_key(|saving| saving.due);
        let Some(saving) = next else {
            continue;
        };
        let left: Vec<&(NaiveDate, Cents)> = saving
            .parts
            .iter()
            .filter(|(day, _)| *day > today)
            .collect();
        goals.push(GoalView {
            item_id: item.id.clone(),
            name: item.name.clone(),
            category: item.category.clone(),
            scheduled: saving.scheduled,
            due: saving.due,
            target_cents: saving.cents,
            set_aside_cents: saving.on(today),
            next_part: left.first().map(|(date, cents)| GoalPart {
                date: *date,
                cents: *cents,
            }),
            parts_left: left.len() as u32,
            once: item
                .schedule
                .iter()
                .all(|segment| segment.repeat == crate::model::Repeat::Once),
        });
    }
    goals.sort_by(|a, b| (a.due, &a.name).cmp(&(b.due, &b.name)));
    GoalsView {
        today,
        set_aside_cents: set_aside_on(&all, today),
        goals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::model::{Balance, ItemKind, Repeat, SaveUp, Settings};
    use crate::occur::tests::{d, item, over, put_item, put_over};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn saved(
        id: &str,
        from: NaiveDate,
        repeat: Repeat,
        cents: Cents,
        since: NaiveDate,
    ) -> crate::model::Item {
        let mut bill = item(id, ItemKind::Bill, from, repeat, cents);
        bill.save_up = Some(SaveUp { since });
        bill
    }

    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 100_000,
                as_of: d(2026, 11, 9),
            }),
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        s
    }

    #[test]
    fn a_yearly_bill_is_saved_up_a_twelfth_a_month() {
        let mut s = budget();
        // Insurance, $1,200 every Mar 3; saving for it since this year's
        put_item(
            &mut s,
            saved(
                "car",
                d(2026, 3, 3),
                Repeat::Years { n: 1 },
                120_000,
                d(2026, 1, 1),
            ),
        );
        let all = savings(&s, &ctx(), d(2026, 11, 10), d(2027, 1, 31));
        assert_eq!(all.len(), 1);
        let next = &all[0];
        assert_eq!(
            (next.scheduled, next.due, next.freed),
            (d(2027, 3, 3), d(2027, 3, 3), d(2027, 3, 3))
        );
        // From Mar 4, a month at a time, the last on Feb 4: twelve parts of $100
        assert_eq!(next.parts.len(), 12);
        assert_eq!(next.parts[0], (d(2026, 3, 4), 10_000));
        assert_eq!(next.parts[11], (d(2027, 2, 4), 10_000));
        assert_eq!(next.on(d(2026, 11, 10)), 90_000);
        assert_eq!(next.on(d(2027, 3, 2)), 120_000);
        assert_eq!(next.on(d(2027, 3, 3)), 0);

        // And a holiday, due before it: first on the page
        put_item(
            &mut s,
            saved(
                "trip",
                d(2027, 1, 20),
                Repeat::Once,
                30_000,
                d(2026, 11, 10),
            ),
        );
        let view = goals(&s, &ctx());
        assert_eq!(view.goals[0].item_id, "trip");
        assert_eq!(view.set_aside_cents, 90_000 + 10_000);
        let mut s = s.clone();
        crate::plan::delete_item(&mut s, "trip").unwrap();
        let view = goals(&s, &ctx());
        assert_eq!(view.set_aside_cents, 90_000);
        assert_eq!(
            view.goals,
            vec![GoalView {
                item_id: "car".into(),
                name: "CAR".into(),
                category: None,
                scheduled: d(2027, 3, 3),
                due: d(2027, 3, 3),
                target_cents: 120_000,
                set_aside_cents: 90_000,
                next_part: Some(GoalPart {
                    date: d(2026, 12, 4),
                    cents: 10_000
                }),
                parts_left: 3,
                once: false,
            }]
        );
    }

    #[test]
    fn a_goal_from_today_splits_evenly_and_frees_its_money_when_taken() {
        let mut s = budget();
        // $1,000 for a holiday on Feb 20, saving from today: Nov 10, Dec 10, Jan 10, Feb 10
        put_item(
            &mut s,
            saved(
                "trip",
                d(2027, 2, 20),
                Repeat::Once,
                100_001,
                d(2026, 11, 10),
            ),
        );
        let view = goals(&s, &ctx());
        let trip = &view.goals[0];
        assert!(trip.once);
        assert_eq!(trip.set_aside_cents, 25_000);
        assert_eq!(trip.parts_left, 3);
        let all = savings(&s, &ctx(), d(2026, 11, 10), d(2027, 2, 28));
        let parts: Vec<Cents> = all[0].parts.iter().map(|(_, cents)| *cents).collect();
        // The odd cent in the last part
        assert_eq!(parts, vec![25_000, 25_000, 25_000, 25_001]);
        assert_eq!(set_aside_on(&all, d(2027, 2, 19)), 100_001);
        assert_eq!(set_aside_on(&all, d(2027, 2, 20)), 0);

        // Paid early, on Feb 1: taken then, after the parts before it
        put_over(
            &mut s,
            over(
                "trip",
                d(2027, 2, 20),
                OccStatus::Done {
                    on: d(2027, 2, 1),
                    amount_cents: 98_000,
                },
            ),
        );
        let paid = savings(
            &s,
            &Ctx::new(1_801_000_000_000, "America/Chicago"),
            d(2027, 1, 1),
            d(2027, 3, 1),
        );
        assert_eq!(paid[0].freed, d(2027, 2, 1));
        assert_eq!(paid[0].parts.len(), 3);
        assert_eq!(paid[0].cents, 98_000);
    }

    #[test]
    fn skipped_overdue_and_archived_times() {
        let mut s = budget();
        // Monthly on the 5th, saved for since Oct 1. November's is before the
        // balance's day (it has it): December's is saved from Nov 6, January's from Dec 6
        put_item(
            &mut s,
            saved(
                "tax",
                d(2026, 10, 5),
                Repeat::Months { n: 1, day: 5 },
                30_000,
                d(2026, 10, 1),
            ),
        );
        let all = savings(&s, &ctx(), d(2026, 11, 10), d(2026, 12, 31));
        let dues = |all: &[Saving]| all.iter().map(|s| s.due).collect::<Vec<_>>();
        assert_eq!(dues(&all), vec![d(2026, 12, 5), d(2027, 1, 5)]);
        assert_eq!(all[0].parts, vec![(d(2026, 11, 6), 30_000)]);

        // December's skipped: nothing set aside for it, and January's still from Dec 6
        put_over(&mut s, over("tax", d(2026, 12, 5), OccStatus::Skipped));
        let all = savings(&s, &ctx(), d(2026, 11, 10), d(2026, 12, 31));
        assert_eq!(dues(&all), vec![d(2027, 1, 5)]);
        assert_eq!(all[0].parts, vec![(d(2026, 12, 6), 30_000)]);
        assert_eq!(goals(&s, &ctx()).goals[0].set_aside_cents, 0);

        // Due the day after the balance's, and open: overdue, taken today
        let mut late = budget();
        put_item(
            &mut late,
            saved(
                "gym",
                d(2026, 11, 9),
                Repeat::Months { n: 1, day: 9 },
                5_000,
                d(2026, 10, 1),
            ),
        );
        let mut settings = late.settings();
        settings.balance = Some(Balance {
            cents: 0,
            as_of: d(2026, 11, 8),
        });
        late.write(DocKey::Settings, Some(&settings));
        let all = savings(&late, &ctx(), d(2026, 11, 9), d(2026, 11, 10));
        assert_eq!(
            (all[0].due, all[0].freed),
            (d(2026, 11, 9), d(2026, 11, 10))
        );
        // By the end of today, the bill has it
        assert_eq!(set_aside_on(&all[..1], d(2026, 11, 9)), 5_000);
        assert_eq!(set_aside_on(&all[..1], d(2026, 11, 10)), 0);

        // Archived: nothing
        let mut gone = saved("old", d(2027, 1, 1), Repeat::Once, 100, d(2026, 1, 1));
        gone.archived = true;
        let mut s = budget();
        put_item(&mut s, gone);
        assert!(savings(&s, &ctx(), d(2026, 11, 10), d(2027, 1, 1)).is_empty());
        // Not saved up for: nothing either
        put_item(
            &mut s,
            item("plain", ItemKind::Bill, d(2027, 1, 1), Repeat::Once, 100),
        );
        assert!(goals(&s, &ctx()).goals.is_empty());
    }

    #[test]
    fn due_before_saving_starts_has_nothing_set_aside() {
        let mut s = budget();
        // Turned on today for a bill due today: no time to save
        put_item(
            &mut s,
            saved("now", d(2026, 11, 10), Repeat::Once, 5_000, d(2026, 11, 10)),
        );
        let all = savings(&s, &ctx(), d(2026, 11, 10), d(2026, 11, 30));
        assert!(all.is_empty());
        assert!(goals(&s, &ctx()).goals.is_empty());
        assert_eq!(split(100, 0), Vec::<Cents>::new());
        // A long way off: no more than ten years of parts
        assert_eq!(
            part_days(d(2026, 1, 1), d(2050, 1, 1)).len(),
            MAX_PARTS as usize
        );
        assert!(part_days(NaiveDate::MAX, NaiveDate::MAX).is_empty());
    }
}
