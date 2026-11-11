//! The withdrawals ahead. The payment site allows one every interval, and
//! each takes everything withdrawable then (TaskMint's rule): the first,
//! once the site allows it after TaskMint's last, takes the curve's amount
//! then; each after it, an interval later at least, what the curve has
//! added since. The user's policy says when they withdraw (as soon as they
//! can, or on a weekday), and a withdrawal below their minimum waits for
//! more.

use super::contract::PayoutForecast;
use super::curve::{Curve, Money};
use crate::model::{TaskMintPlan, WithdrawPolicy};
use crate::time::{hour, Ctx, HOUR_MS};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// No forecast projects more withdrawals than this (a year of one a day).
const MAX_WITHDRAWALS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProjectedWithdrawal {
    /// When it's made.
    pub at_ms: i64,
    /// Open now: the site allows it already, and there's money to take.
    pub opens_now: bool,
    /// When it reaches the bank (after the user's arrival delay), and on which day.
    pub arrives_at_ms: i64,
    pub arrives_on: NaiveDate,
    pub money: Money,
    pub total_cents: i64,
}

/// The first time at or after `at_ms` the policy withdraws.
pub fn policy_time(policy: WithdrawPolicy, ctx: &Ctx, at_ms: i64) -> i64 {
    let WithdrawPolicy::Weekly {
        weekday,
        hour: at_hour,
    } = policy
    else {
        return at_ms;
    };
    let day = ctx.day_of(at_ms);
    (0..=7)
        .filter_map(|ahead| day.checked_add_signed(Duration::days(ahead)))
        .filter(|date| date.weekday().num_days_from_monday() == u32::from(weekday % 7))
        .map(|date| ctx.at(date, hour(at_hour.min(23))))
        .find(|time| *time >= at_ms)
        .unwrap_or(at_ms)
}

/// The withdrawals made by `until_ms`, soonest first.
pub fn project_withdrawals(
    forecast: &PayoutForecast,
    curve: &Curve,
    ctx: &Ctx,
    plan: &TaskMintPlan,
    until_ms: i64,
) -> Vec<ProjectedWithdrawal> {
    let now = ctx.now_ms();
    let interval = forecast.withdrawal_interval_ms.max(0);
    let need = plan.min_withdrawal_cents.max(1);
    let mut earliest = match forecast.cutoff {
        Some(last) => now.max(last.taken_at_ms.saturating_add(interval)),
        None => now,
    };
    let mut taken = Money::default();
    let mut found = Vec::new();

    while found.len() < MAX_WITHDRAWALS {
        let mut at = policy_time(plan.policy, ctx, earliest);
        if (curve.at(at) - taken).total() < need {
            // Wait for the release that makes it enough
            let Some(enough) = curve.first_reaching(at, taken, need) else {
                break;
            };
            at = policy_time(plan.policy, ctx, enough);
        }
        if at > until_ms {
            break;
        }
        let now_has = curve.at(at);
        let money = now_has - taken;
        let arrives_at_ms = at.saturating_add(i64::from(plan.arrival_delay_hours) * HOUR_MS);
        found.push(ProjectedWithdrawal {
            at_ms: at,
            opens_now: at == now,
            arrives_at_ms,
            arrives_on: ctx.day_of(arrives_at_ms),
            money,
            total_cents: money.total(),
        });
        taken = now_has;
        earliest = at.saturating_add(interval);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::super::contract::{Amount, Step, Taken};
    use super::super::curve::live_curve;
    use super::*;
    use crate::time::DAY_MS;

    fn forecast(steps: &[(i64, i64)], cutoff: Option<i64>) -> PayoutForecast {
        PayoutForecast {
            schema: 1,
            as_of_ms: 0,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            cutoff: cutoff.map(|at| Taken {
                taken_at_ms: at,
                amount_cents: 1,
            }),
            recent_withdrawals: vec![],
            next_allowed_at_ms: cutoff.map(|at| at + 3 * DAY_MS),
            scheduled: None,
            carried: Amount {
                actual_cents: 100,
                ..Amount::default()
            },
            carried_days: vec![],
            steps: steps
                .iter()
                .map(|(at_ms, cents)| Step {
                    at_ms: *at_ms,
                    day: None,
                    actual_cents: *cents,
                    estimated_cents: 0,
                    past_due_cents: 0,
                    open: None,
                })
                .collect(),
            recent_days: vec![],
            zone: "UTC".into(),
        }
    }

    fn series(
        f: &PayoutForecast,
        now: i64,
        plan: &TaskMintPlan,
        until: i64,
    ) -> Vec<(i64, i64, bool)> {
        let ctx = Ctx::new(now, "UTC");
        let curve = live_curve(f, &ctx, plan, until);
        project_withdrawals(f, &curve, &ctx, plan, until)
            .into_iter()
            .map(|w| (w.at_ms, w.total_cents, w.opens_now))
            .collect()
    }

    const NOW: i64 = 1000 * DAY_MS;

    #[test]
    fn takes_everything_when_it_opens_then_what_comes_in_an_interval_later() {
        let f = forecast(
            &[
                (NOW + DAY_MS, 50),
                (NOW + 2 * DAY_MS, 70),
                (NOW + 5 * DAY_MS, 90),
            ],
            Some(NOW - DAY_MS),
        );
        // Opens two days from now: 100 + 50 + 70; then three days on: 90
        assert_eq!(
            series(&f, NOW, &TaskMintPlan::default(), NOW + 30 * DAY_MS),
            vec![
                (NOW + 2 * DAY_MS, 220, false),
                (NOW + 5 * DAY_MS, 90, false)
            ]
        );
        // Not past what the forecast covers
        assert_eq!(
            series(&f, NOW, &TaskMintPlan::default(), NOW + 3 * DAY_MS).len(),
            1
        );
        // Open now with no withdrawal recorded
        let open = forecast(&[(NOW + DAY_MS, 50)], None);
        assert_eq!(
            series(&open, NOW, &TaskMintPlan::default(), NOW + 30 * DAY_MS),
            vec![(NOW, 100, true), (NOW + 3 * DAY_MS, 50, false)]
        );
    }

    #[test]
    fn waits_for_the_minimum_and_for_the_policys_day() {
        let f = forecast(&[(NOW + DAY_MS, 50), (NOW + 4 * DAY_MS, 500)], None);
        let min = TaskMintPlan {
            min_withdrawal_cents: 200,
            ..TaskMintPlan::default()
        };
        assert_eq!(
            series(&f, NOW, &min, NOW + 30 * DAY_MS),
            vec![(NOW + 4 * DAY_MS, 650, false)]
        );
        // Nothing ever reaches it
        let big = TaskMintPlan {
            min_withdrawal_cents: 10_000,
            ..TaskMintPlan::default()
        };
        assert!(series(&f, NOW, &big, NOW + 30 * DAY_MS).is_empty());

        // Fridays at 9 (NOW, 1972-09-27, is a Wednesday)
        let ctx = Ctx::new(NOW, "UTC");
        let today = ctx.today().weekday().num_days_from_monday() as i64;
        let friday = 4;
        let ahead = (friday - today).rem_euclid(7);
        let first_friday = NOW + ahead * DAY_MS + 9 * HOUR_MS;
        let fridays = TaskMintPlan {
            policy: WithdrawPolicy::Weekly {
                weekday: 4,
                hour: 9,
            },
            ..TaskMintPlan::default()
        };
        let made = series(&f, NOW, &fridays, NOW + 30 * DAY_MS);
        assert_eq!(made[0].0, first_friday);
        assert!(made
            .iter()
            .all(|(at, _, _)| (at - first_friday) % (7 * DAY_MS) == 0));
        assert_eq!(made.iter().map(|(_, cents, _)| cents).sum::<i64>(), 650);
    }

    #[test]
    fn finds_the_policys_next_time() {
        let ctx = Ctx::new(0, "UTC");
        // 1970-01-01 was a Thursday
        assert_eq!(policy_time(WithdrawPolicy::AsSoonAsOpen, &ctx, 5), 5);
        let thursday_9 = policy_time(
            WithdrawPolicy::Weekly {
                weekday: 3,
                hour: 9,
            },
            &ctx,
            0,
        );
        assert_eq!(thursday_9, 9 * HOUR_MS);
        // Past this week's: next week's
        let next = policy_time(
            WithdrawPolicy::Weekly {
                weekday: 3,
                hour: 9,
            },
            &ctx,
            10 * HOUR_MS,
        );
        assert_eq!(next, 7 * DAY_MS + 9 * HOUR_MS);
        // Out-of-range days and hours read sensibly
        let wrapped = policy_time(
            WithdrawPolicy::Weekly {
                weekday: 10,
                hour: 30,
            },
            &ctx,
            0,
        );
        assert_eq!(wrapped, 23 * HOUR_MS);
        // Beyond the calendar: as it is
        assert_eq!(
            policy_time(
                WithdrawPolicy::Weekly {
                    weekday: 0,
                    hour: 0
                },
                &ctx,
                i64::MAX
            ),
            i64::MAX
        );
    }

    #[test]
    fn says_when_the_money_arrives_and_stops_somewhere() {
        let f = forecast(&[], None);
        let ctx = Ctx::new(NOW, "UTC");
        let plan = TaskMintPlan {
            arrival_delay_hours: 36,
            ..TaskMintPlan::default()
        };
        let curve = live_curve(&f, &ctx, &plan, NOW);
        let made = project_withdrawals(&f, &curve, &ctx, &plan, NOW);
        assert_eq!(made[0].arrives_at_ms, NOW + 36 * HOUR_MS);
        assert_eq!(made[0].arrives_on, ctx.day_of(NOW) + Duration::days(1));
        // A step every hour, no interval: at most MAX_WITHDRAWALS
        let mut busy = forecast(&[], None);
        busy.withdrawal_interval_ms = 0;
        busy.steps = (1..1000)
            .map(|i| Step {
                at_ms: NOW + i * HOUR_MS,
                day: None,
                actual_cents: 1,
                estimated_cents: 0,
                past_due_cents: 0,
                open: None,
            })
            .collect();
        let curve = live_curve(&busy, &ctx, &TaskMintPlan::default(), i64::MAX);
        let made = project_withdrawals(&busy, &curve, &ctx, &TaskMintPlan::default(), i64::MAX);
        assert_eq!(made.len(), MAX_WITHDRAWALS);
    }
}
