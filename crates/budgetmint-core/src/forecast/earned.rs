//! What each work day earned in TaskMint that no withdrawal has taken yet,
//! and when the withdrawal that takes it reaches the bank. A withdrawal takes
//! everything withdrawable then (series), so the carried money goes with the
//! first one, and a step's with the first made at or after its release.
//! Money TaskMint doesn't say the day of (an older TaskMint) isn't here.

use super::curve::{Curve, Money};
use super::series::ProjectedWithdrawal;
use chrono::NaiveDate;
use std::collections::BTreeMap;

/// A work day's money, not withdrawn yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unwithdrawn {
    pub day: NaiveDate,
    pub money: Money,
    /// When the last of it reaches the bank: None when no withdrawal ahead
    /// (within what's projected) takes all of it.
    pub arrives_on: Option<NaiveDate>,
}

/// Each work day's money in `curve`, soonest day first, with the
/// withdrawals (`withdrawals`, projected from it) that take it.
pub fn unwithdrawn(curve: &Curve, withdrawals: &[ProjectedWithdrawal]) -> Vec<Unwithdrawn> {
    let carried = curve
        .carried_days
        .iter()
        .map(|(day, money)| (*day, *money, withdrawals.first()));
    let released = curve.steps.iter().filter_map(|step| {
        let taken_by = withdrawals.iter().find(|made| made.at_ms >= step.at_ms);
        Some((step.day?, step.money, taken_by))
    });
    let mut days: BTreeMap<NaiveDate, Unwithdrawn> = BTreeMap::new();
    for (day, money, taken_by) in carried.chain(released) {
        if money.total() == 0 {
            continue;
        }
        let arrives_on = taken_by.map(|made| made.arrives_on);
        let earned = days.entry(day).or_insert(Unwithdrawn {
            day,
            money: Money::default(),
            arrives_on,
        });
        earned.money = earned.money + money;
        // The later of the two: none when either part has none
        earned.arrives_on = earned.arrives_on.zip(arrives_on).map(|(a, b)| a.max(b));
    }
    days.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::super::contract::{Amount, CarriedDay, Open, PayoutForecast, Step, Taken};
    use super::super::curve::live_curve;
    use super::super::series::project_withdrawals;
    use super::*;
    use crate::model::{FutureEarnings, TaskMintPlan};
    use crate::time::{Ctx, DAY_MS, HOUR_MS};

    /// 1972-09-27, noon UTC (a Wednesday).
    const NOW: i64 = 1000 * DAY_MS + 12 * HOUR_MS;

    fn d(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn cents(actual_cents: i64) -> Amount {
        Amount {
            actual_cents,
            ..Amount::default()
        }
    }

    fn step(at_ms: i64, day: Option<&str>, actual_cents: i64) -> Step {
        Step {
            at_ms,
            day: day.map(d),
            actual_cents,
            estimated_cents: 0,
            past_due_cents: 0,
            open: None,
        }
    }

    /// The last withdrawal two days ago: the next opens tomorrow at noon, then every three days.
    fn forecast(carried_days: &[(&str, i64)], steps: Vec<Step>) -> PayoutForecast {
        PayoutForecast {
            schema: 1,
            as_of_ms: NOW,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            cutoff: Some(Taken {
                taken_at_ms: NOW - 2 * DAY_MS,
                amount_cents: 1,
            }),
            recent_withdrawals: vec![],
            next_allowed_at_ms: Some(NOW + DAY_MS),
            scheduled: None,
            carried: cents(carried_days.iter().map(|(_, cents)| cents).sum()),
            carried_days: carried_days
                .iter()
                .map(|(day, actual)| CarriedDay {
                    day: Some(d(day)),
                    amount: cents(*actual),
                })
                .collect(),
            steps,
            recent_days: vec![],
            zone: "UTC".into(),
        }
    }

    fn earned(
        forecast: &PayoutForecast,
        plan: &TaskMintPlan,
    ) -> Vec<(NaiveDate, i64, Option<NaiveDate>)> {
        let ctx = Ctx::new(NOW, "UTC");
        let until = NOW + 30 * DAY_MS;
        let curve = live_curve(forecast, &ctx, plan, until);
        let withdrawals = project_withdrawals(forecast, &curve, &ctx, plan, until);
        unwithdrawn(&curve, &withdrawals)
            .into_iter()
            .map(|day| (day.day, day.money.total(), day.arrives_on))
            .collect()
    }

    #[test]
    fn each_days_money_goes_with_the_withdrawal_that_takes_it() {
        // Made tomorrow (the 28th) at noon, in the bank a day later; the next on the 1st, in on the 2nd
        let f = forecast(
            &[("1972-09-18", 300), ("1972-09-19", 0), ("1972-09-20", 500)],
            vec![
                // Released before tomorrow's withdrawal: in it
                step(NOW + 6 * HOUR_MS, Some("1972-09-21"), 200),
                // Released just as it's made: in it too
                step(NOW + DAY_MS, Some("1972-09-22"), 50),
                // After it: in the next one
                step(NOW + 2 * DAY_MS, Some("1972-09-23"), 70),
                // TaskMint didn't say the day: left out
                step(NOW + 2 * DAY_MS, None, 1_000),
            ],
        );
        assert_eq!(
            earned(&f, &TaskMintPlan::default()),
            vec![
                (d("1972-09-18"), 300, Some(d("1972-09-29"))),
                (d("1972-09-20"), 500, Some(d("1972-09-29"))),
                (d("1972-09-21"), 200, Some(d("1972-09-29"))),
                (d("1972-09-22"), 50, Some(d("1972-09-29"))),
                (d("1972-09-23"), 70, Some(d("1972-10-02"))),
            ]
        );
    }

    #[test]
    fn a_day_in_two_withdrawals_is_in_the_bank_when_the_last_of_it_is() {
        let f = forecast(
            &[("1972-09-20", 100)],
            vec![step(NOW + 2 * DAY_MS, Some("1972-09-20"), 40)],
        );
        assert_eq!(
            earned(&f, &TaskMintPlan::default()),
            vec![(d("1972-09-20"), 140, Some(d("1972-10-02")))]
        );
        // None of it reaches the minimum: no withdrawal takes it, however it's split
        let waits = TaskMintPlan {
            min_withdrawal_cents: 1_000,
            ..TaskMintPlan::default()
        };
        assert_eq!(earned(&f, &waits), vec![(d("1972-09-20"), 140, None)]);
        // A withdrawal takes the carried part, and the rest is past what's projected
        let f = forecast(
            &[("1972-09-20", 100)],
            vec![step(NOW + 90 * DAY_MS, Some("1972-09-20"), 40)],
        );
        assert_eq!(
            earned(&f, &TaskMintPlan::default()),
            vec![(d("1972-09-20"), 140, None)]
        );
    }

    #[test]
    fn an_older_taskmints_forecast_has_no_days() {
        let mut f = forecast(&[], vec![step(NOW + DAY_MS, None, 500)]);
        f.carried = cents(900);
        // Nor does carried money whose day didn't read
        f.carried_days = vec![CarriedDay {
            day: None,
            amount: cents(900),
        }];
        assert!(earned(&f, &TaskMintPlan::default()).is_empty());
    }

    #[test]
    fn counts_what_the_user_counts_and_the_open_timers_and_assumed_days() {
        // Today's timer, running since 9 at $10 an hour: three hours in, released a week from now
        let mut timer = step(NOW, Some("1972-09-27"), 0);
        timer.estimated_cents = 500;
        timer.open = Some(Open {
            since_ms: NOW - 3 * HOUR_MS,
            cents_per_hour: 1_000,
        });
        let f = forecast(&[("1972-09-20", 100)], vec![timer]);
        let found = earned(&f, &TaskMintPlan::default());
        assert_eq!(found[1].0, d("1972-09-27"));
        assert_eq!(found[1].1, 500 + 3_000);
        // Estimates not counted: today's timer isn't there
        let no_estimates = TaskMintPlan {
            count_estimates: false,
            ..TaskMintPlan::default()
        };
        assert_eq!(earned(&f, &no_estimates).len(), 1);
        // $70 a week assumed: tomorrow on earns $10 a day, released a week after
        let assumed = TaskMintPlan {
            future: FutureEarnings::Weekly { cents: 7_000 },
            ..TaskMintPlan::default()
        };
        let found = earned(&f, &assumed);
        assert_eq!(found[2].0, d("1972-09-28"));
        assert_eq!(found[2].1, 1_000);
    }
}
