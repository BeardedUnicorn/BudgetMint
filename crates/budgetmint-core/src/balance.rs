//! Updating the balance, checked against what BudgetMint expected it to be.
//!
//! The open bills (and income) due since the last balance are in the new
//! one, unless the user says one hasn't come out yet: then it's left to come
//! the day after. What the cash flow then expected by the new balance's day,
//! against what it is, is kept (`Settings::checks`): over a few updates,
//! what goes out besides the bills, a week ([`spending_estimate`]).

use crate::docs::{DocKey, Snapshot};
use crate::error::{invalid, CoreError};
use crate::forecast::contract::PayoutForecast;
use crate::model::{Balance, BalanceCheck, Cents, OccStatus, Settings};
use crate::occur::{occurrences, MOVE_DAYS};
use crate::plan::{self, check_balance, OccurrenceInput, Planned};
use crate::project::{project, settled_through, spending_between};
use crate::time::Ctx;
use crate::views::{occurrence_view, OccurrenceView};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// The checks the settings keep: half a year of weekly updates.
pub const MAX_CHECKS: usize = 26;

/// How far back the checks the estimate averages go.
pub const ESTIMATE_DAYS: i64 = 91;

/// Which occurrence: its item and the schedule's date.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct OccRef {
    pub item_id: String,
    pub date: NaiveDate,
}

/// One marked paid (or received): on a day, for an amount.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PaidInput {
    pub item_id: String,
    /// Which occurrence: the schedule's date.
    pub date: NaiveDate,
    pub on: NaiveDate,
    pub amount_cents: Cents,
}

/// What a new balance compares with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct BalanceCheckView {
    /// The balance it replaces.
    pub previous: Option<Balance>,
    /// What the cash flow expected by the end of the new balance's day,
    /// with the ones still to come left out. None with nothing to compare:
    /// no balance before, or the new one isn't after it.
    pub expected_cents: Option<Cents>,
    /// The new balance, less what was expected.
    pub difference_cents: Option<Cents>,
    /// The bills and income still open, not on autopay, that came due since
    /// the last balance (the last two months of it): in the new balance, or
    /// still to come?
    pub open: Vec<OccurrenceView>,
}

/// The open ones the new balance settles, as `balance_check` lists them.
fn open_since<'a>(
    snapshot: &'a Snapshot,
    balance: Balance,
    ctx: &Ctx,
) -> Vec<crate::occur::Occurrence<'a>> {
    let after = settled_through(&snapshot.settings(), ctx.today());
    // A day or two short of how far one can be moved, to the day after
    let from = (after + Duration::days(1)).max(balance.as_of - Duration::days(MOVE_DAYS - 1));
    occurrences(snapshot, from, balance.as_of, false)
        .into_iter()
        .filter(|occurrence| occurrence.status == OccStatus::Open && !occurrence.item.autopay)
        .collect()
}

/// Marks paid each in `paid`, and leaves each in `still_open` to come the
/// day after `as_of`: all of them or, when one's refused, none.
fn settle_occurrences(
    snapshot: &mut Snapshot,
    paid: Vec<PaidInput>,
    still_open: Vec<OccRef>,
    as_of: Option<NaiveDate>,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let mut seen = BTreeSet::new();
    let refs = paid
        .iter()
        .map(|paid| OccRef {
            item_id: paid.item_id.clone(),
            date: paid.date,
        })
        .chain(still_open.iter().cloned());
    for at in refs {
        if !seen.insert(at) {
            return Err(invalid("Each bill can be settled only once at a time"));
        }
    }
    let mut planned = Planned::default();
    // What's said of each already (its amount, where it was moved, its note) stays
    let kept = |snapshot: &Snapshot, item_id: &str, date: NaiveDate| {
        snapshot
            .overrides
            .get(&(item_id.to_string(), date))
            .map(|over| (over.amount_cents, over.moved_to, over.note.clone()))
            .unwrap_or_default()
    };
    for paid in paid {
        let (amount_cents, moved_to, note) = kept(snapshot, &paid.item_id, paid.date);
        planned.then(plan::set_occurrence(
            snapshot,
            OccurrenceInput {
                item_id: paid.item_id,
                date: paid.date,
                status: OccStatus::Done {
                    on: paid.on,
                    amount_cents: paid.amount_cents,
                },
                amount_cents,
                moved_to,
                note,
            },
            ctx,
        )?);
    }
    if !still_open.is_empty() {
        let as_of =
            as_of.ok_or_else(|| invalid("Say what the balance is, for a bill to come after it"))?;
        for open in still_open {
            let (amount_cents, _, note) = kept(snapshot, &open.item_id, open.date);
            planned.then(plan::set_occurrence(
                snapshot,
                OccurrenceInput {
                    item_id: open.item_id,
                    date: open.date,
                    status: OccStatus::Open,
                    amount_cents,
                    moved_to: Some(as_of + Duration::days(1)),
                    note,
                },
                ctx,
            )?);
        }
    }
    Ok(planned)
}

/// What the cash flow, from the balance there is now, has by the end of
/// `as_of`: None when there's no balance before it.
fn expected_by(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    as_of: NaiveDate,
    ctx: &Ctx,
) -> Option<(Balance, Cents)> {
    let previous = snapshot
        .settings()
        .balance
        .filter(|previous| previous.as_of < as_of)?;
    let projection = project(snapshot, taskmint, ctx, ctx.today());
    // The projection starts the day after the previous balance's: it has `as_of`
    let row = projection.day(as_of)?;
    Some((previous, row.closing_cents))
}

/// What `balance` compares with, the open ones in `still_open` left to come
/// after it, and every other one listed taken as in it.
pub fn balance_check(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    balance: Balance,
    still_open: Vec<OccRef>,
    ctx: &Ctx,
) -> BalanceCheckView {
    let today = ctx.today();
    let settled = settled_through(&snapshot.settings(), today);
    let open = open_since(snapshot, balance, ctx);
    let views = open
        .iter()
        .map(|occurrence| occurrence_view(occurrence, today, settled))
        .collect::<Vec<_>>();
    let paid = paid_on_due(&views, &still_open);
    // On a copy: what settling them would leave
    let mut draft = snapshot.clone();
    let settled_draft = settle_occurrences(&mut draft, paid, still_open, Some(balance.as_of), ctx);
    let expected = settled_draft
        .ok()
        .and_then(|_| expected_by(&draft, taskmint, balance.as_of, ctx));
    BalanceCheckView {
        previous: snapshot.settings().balance,
        expected_cents: expected.map(|(_, cents)| cents),
        difference_cents: expected.map(|(_, cents)| balance.cents - cents),
        open: views,
    }
}

/// Each of `open` not in `still_open`, as paid on its due day at what was expected.
pub fn paid_on_due(open: &[OccurrenceView], still_open: &[OccRef]) -> Vec<PaidInput> {
    open.iter()
        .filter(|view| {
            !still_open
                .iter()
                .any(|at| at.item_id == view.item_id && at.date == view.scheduled)
        })
        .map(|view| PaidInput {
            item_id: view.item_id.clone(),
            date: view.scheduled,
            on: view.due,
            amount_cents: view.expected_cents,
        })
        .collect()
}

/// Marks `paid` paid and leaves `still_open` to come after the balance's day,
/// then (with one) sets the balance, keeping what was expected by then
/// against it. All of it, with one undo, or none of it.
pub fn settle(
    snapshot: &mut Snapshot,
    taskmint: Option<&PayoutForecast>,
    paid: Vec<PaidInput>,
    still_open: Vec<OccRef>,
    balance: Option<Balance>,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    if let Some(balance) = balance {
        check_balance(snapshot, balance, ctx)?;
    }
    let mut planned =
        settle_occurrences(snapshot, paid, still_open, balance.map(|b| b.as_of), ctx)?;
    let Some(balance) = balance else {
        return Ok(planned);
    };
    let settings = snapshot.settings();
    let mut checks = settings.checks.clone();
    if let Some((previous, expected_cents)) = expected_by(snapshot, taskmint, balance.as_of, ctx) {
        checks.push(BalanceCheck {
            from: previous.as_of,
            to: balance.as_of,
            expected_cents,
            actual_cents: balance.cents,
            assumed_spending_cents: spending_between(
                settings.spending_weekly_cents,
                previous.as_of,
                balance.as_of,
            ),
        });
        let extra = checks.len().saturating_sub(MAX_CHECKS);
        checks.drain(..extra);
    }
    let updated = Settings {
        balance: Some(balance),
        checks,
        ..settings
    };
    planned.add(snapshot.write(DocKey::Settings, Some(&updated)));
    Ok(planned)
}

/// What goes out in a week besides the bills, by the balance's updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SpendingEstimate {
    pub weekly_cents: Cents,
    /// The days the updates it's from cover, and how many there were.
    pub days: u32,
    pub checks: u32,
}

/// The estimate from the checks of the last three months, once they cover a
/// week at least.
pub fn spending_estimate(settings: &Settings, today: NaiveDate) -> Option<SpendingEstimate> {
    let recent: Vec<&BalanceCheck> = settings
        .checks
        .iter()
        .filter(|check| check.to >= today - Duration::days(ESTIMATE_DAYS) && check.days() > 0)
        .collect();
    let days: i64 = recent.iter().map(|check| check.days()).sum();
    if days < 7 {
        return None;
    }
    let spent: Cents = recent.iter().map(|check| check.spent_outside_cents()).sum();
    let weekly = (i128::from(spent) * 7 + i128::from(days) / 2) / i128::from(days);
    Some(SpendingEstimate {
        weekly_cents: (weekly as Cents).max(0),
        days: days as u32,
        checks: recent.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ItemKind, Repeat};
    use crate::occur::tests::{d, item, over, put_item, put_over};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    /// $1,000 at the end of Nov 1; $50 phone on the 5th, $100 power on the
    /// 8th, $20 gym on autopay on the 9th; $40 a week of everyday spending.
    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 100_000,
                as_of: d(2026, 11, 1),
            }),
            spending_weekly_cents: 4_000,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        put_item(
            &mut s,
            item("phone", ItemKind::Bill, d(2026, 11, 5), Repeat::Once, 5_000),
        );
        put_item(
            &mut s,
            item(
                "power",
                ItemKind::Bill,
                d(2026, 11, 8),
                Repeat::Once,
                10_000,
            ),
        );
        let mut gym = item("gym", ItemKind::Bill, d(2026, 11, 9), Repeat::Once, 2_000);
        gym.autopay = true;
        put_item(&mut s, gym);
        s
    }

    fn today_balance(cents: Cents) -> Balance {
        Balance {
            cents,
            as_of: d(2026, 11, 10),
        }
    }

    fn at(item_id: &str, date: NaiveDate) -> OccRef {
        OccRef {
            item_id: item_id.into(),
            date,
        }
    }

    #[test]
    fn says_what_was_expected_and_which_bills_are_in_it() {
        let s = budget();
        // 9 days of spending ($51.43 of $40 a week, by its days), the three bills
        let check = balance_check(&s, None, today_balance(70_000), vec![], &ctx());
        let spent = spending_between(4_000, d(2026, 11, 1), d(2026, 11, 10));
        let expected = 100_000 - 5_000 - 10_000 - 2_000 - spent;
        assert_eq!(check.expected_cents, Some(expected));
        assert_eq!(check.difference_cents, Some(70_000 - expected));
        assert_eq!(check.previous.unwrap().as_of, d(2026, 11, 1));
        // Autopay's not asked about
        let names: Vec<&str> = check
            .open
            .iter()
            .map(|view| view.item_id.as_str())
            .collect();
        assert_eq!(names, vec!["phone", "power"]);

        // The power bill hasn't come out yet: it's expected after, so more was expected now
        let later = balance_check(
            &s,
            None,
            today_balance(70_000),
            vec![at("power", d(2026, 11, 8))],
            &ctx(),
        );
        assert_eq!(later.expected_cents, Some(expected + 10_000));

        // No balance before: nothing to compare; one as of before it: likewise
        let mut fresh = budget();
        let mut settings = fresh.settings();
        settings.balance = None;
        fresh.write(DocKey::Settings, Some(&settings));
        assert_eq!(
            balance_check(&fresh, None, today_balance(1), vec![], &ctx()).expected_cents,
            None
        );
        let older = Balance {
            cents: 1,
            as_of: d(2026, 10, 30),
        };
        assert_eq!(
            balance_check(&s, None, older, vec![], &ctx()).difference_cents,
            None
        );
        // One as of a day still to come: nothing to compare yet
        let ahead = Balance {
            cents: 1,
            as_of: d(2026, 11, 11),
        };
        assert_eq!(
            balance_check(&s, None, ahead, vec![], &ctx()).expected_cents,
            None
        );
    }

    #[test]
    fn settles_the_bills_and_keeps_the_check_in_one_change() {
        let mut s = budget();
        let check = balance_check(&s, None, today_balance(70_000), vec![], &ctx());
        let still = vec![at("power", d(2026, 11, 8))];
        let paid = paid_on_due(&check.open, &still);
        assert_eq!(paid.len(), 1);
        let planned = settle(
            &mut s,
            None,
            paid,
            still,
            Some(today_balance(70_000)),
            &ctx(),
        )
        .unwrap();
        // Phone paid on its day; power moved to tomorrow; the balance and its check
        assert_eq!(planned.writes.len(), 3);
        assert_eq!(
            s.overrides[&("phone".to_string(), d(2026, 11, 5))].status,
            OccStatus::Done {
                on: d(2026, 11, 5),
                amount_cents: 5_000
            }
        );
        assert_eq!(
            s.overrides[&("power".to_string(), d(2026, 11, 8))].moved_to,
            Some(d(2026, 11, 11))
        );
        let settings = s.settings();
        assert_eq!(settings.balance, Some(today_balance(70_000)));
        let kept = settings.checks[0];
        assert_eq!(kept.from, d(2026, 11, 1));
        assert_eq!(kept.to, d(2026, 11, 10));
        assert_eq!(
            Some(kept.expected_cents),
            balance_check(
                &budget(),
                None,
                today_balance(70_000),
                vec![at("power", d(2026, 11, 8))],
                &ctx()
            )
            .expected_cents
        );
        assert_eq!(kept.days(), 9);
        // $200 less than expected, with the $51.43 of spending assumed: $251.43 went out besides
        assert_eq!(
            kept.spent_outside_cents(),
            kept.assumed_spending_cents + kept.expected_cents - 70_000
        );
        // One undo takes all of it back, the undo of the last write first
        assert_eq!(planned.undo.len(), 3);
        assert_eq!(planned.undo[0].doc_id, "settings~account");
    }

    #[test]
    fn keeps_what_was_said_and_refuses_what_it_cant_settle() {
        let mut s = budget();
        let mut phone = over("phone", d(2026, 11, 5), OccStatus::Open);
        phone.note = Some("Autopay failed".into());
        phone.amount_cents = Some(5_500);
        put_over(&mut s, phone);
        let paid = PaidInput {
            item_id: "phone".into(),
            date: d(2026, 11, 5),
            on: d(2026, 11, 6),
            amount_cents: 5_500,
        };
        // Only marking paid: no balance, no check
        let planned = settle(&mut s, None, vec![paid.clone()], vec![], None, &ctx()).unwrap();
        assert_eq!(planned.writes.len(), 1);
        let kept = &s.overrides[&("phone".to_string(), d(2026, 11, 5))];
        assert_eq!(kept.note.as_deref(), Some("Autopay failed"));
        assert_eq!(kept.amount_cents, Some(5_500));
        assert!(s.settings().checks.is_empty());

        let message = |result: Result<Planned, CoreError>| result.unwrap_err().to_string();
        let mut s = budget();
        assert_eq!(
            message(settle(
                &mut s,
                None,
                vec![paid.clone()],
                vec![at("phone", d(2026, 11, 5))],
                None,
                &ctx()
            )),
            "Each bill can be settled only once at a time"
        );
        assert_eq!(
            message(settle(
                &mut s,
                None,
                vec![],
                vec![at("phone", d(2026, 11, 5))],
                None,
                &ctx()
            )),
            "Say what the balance is, for a bill to come after it"
        );
        assert_eq!(
            message(settle(
                &mut s,
                None,
                vec![],
                vec![],
                Some(Balance {
                    cents: 1,
                    as_of: d(2026, 11, 11)
                }),
                &ctx()
            )),
            "Set the balance as of today or a day before"
        );
        // One to leave open that isn't there
        assert!(settle(
            &mut s,
            None,
            vec![],
            vec![at("nope", d(2026, 11, 5))],
            Some(today_balance(1)),
            &ctx()
        )
        .is_err());
        // A balance with none before it: set, with nothing to check it against
        let mut fresh = budget();
        let mut settings = fresh.settings();
        settings.balance = None;
        fresh.write(DocKey::Settings, Some(&settings));
        settle(
            &mut fresh,
            None,
            vec![],
            vec![],
            Some(today_balance(1)),
            &ctx(),
        )
        .unwrap();
        assert_eq!(fresh.settings().balance, Some(today_balance(1)));
        assert!(fresh.settings().checks.is_empty());
        // A refusal halfway: the paid one before it isn't kept either (the host runs it on a copy)
        let unknown = PaidInput {
            item_id: "nope".into(),
            ..paid
        };
        assert!(settle(&mut s, None, vec![unknown], vec![], None, &ctx()).is_err());
        // The check's copy refusing: nothing expected, nothing kept
        let check = balance_check(
            &s,
            None,
            today_balance(1),
            vec![at("phone", d(2026, 11, 5)), at("phone", d(2026, 11, 5))],
            &ctx(),
        );
        assert_eq!(check.expected_cents, None);
    }

    #[test]
    fn keeps_half_a_year_of_checks_and_estimates_the_spending_from_them() {
        let mut settings = Settings::default();
        assert_eq!(spending_estimate(&settings, d(2026, 11, 10)), None);
        // Weekly checks: each $70 below what was expected, with $30 assumed: $100 a week besides
        for week in 0..30 {
            let to = d(2026, 5, 5) + Duration::days(7 * week);
            settings.checks.push(BalanceCheck {
                from: to - Duration::days(7),
                to,
                expected_cents: 50_000,
                actual_cents: 43_000,
                assumed_spending_cents: 3_000,
            });
        }
        let estimate = spending_estimate(&settings, d(2026, 11, 24)).unwrap();
        assert_eq!(estimate.weekly_cents, 10_000);
        // The last three months' (to Nov 24 from Aug 25 on)
        assert_eq!(estimate.checks, 14);
        assert_eq!(estimate.days, 98);
        // A balance that came in above what was expected: nothing spent besides
        settings
            .checks
            .iter_mut()
            .for_each(|check| check.actual_cents = 60_000);
        assert_eq!(
            spending_estimate(&settings, d(2026, 11, 24))
                .unwrap()
                .weekly_cents,
            0
        );

        // Settling keeps the latest 26
        let mut s = budget();
        let mut full = s.settings();
        full.checks = settings.checks.clone();
        s.write(DocKey::Settings, Some(&full));
        settle(&mut s, None, vec![], vec![], Some(today_balance(1)), &ctx()).unwrap();
        let checks = s.settings().checks;
        assert_eq!(checks.len(), MAX_CHECKS);
        assert_eq!(checks.last().unwrap().to, d(2026, 11, 10));
    }
}
