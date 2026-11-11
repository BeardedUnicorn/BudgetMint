//! What a withdrawal at any time from now takes, from TaskMint's forecast:
//! `carried`, plus each step from its time. Open timers are brought up to
//! now (they've earned since TaskMint measured them, and they're released
//! the release days after they stop, so after now); what the user chose not
//! to count is left out; and earnings still to come are added when the user
//! assumes them, marked as assumed.

use super::contract::{Amount, PayoutForecast};
use crate::model::{FutureEarnings, TaskMintPlan};
use crate::time::{Ctx, HOUR_MS};
use chrono::{Duration, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::ops::{Add, Sub};

/// Money a withdrawal takes, by where it comes from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Money {
    /// The payment site's amounts.
    pub actual_cents: i64,
    /// Tracked time not imported yet.
    pub estimated_cents: i64,
    /// Part of actual: still pending on the site after its release.
    pub past_due_cents: i64,
    /// Earnings assumed still to come (FutureEarnings).
    pub assumed_cents: i64,
}

impl Money {
    pub fn total(&self) -> i64 {
        self.actual_cents + self.estimated_cents + self.assumed_cents
    }
}

impl Add for Money {
    type Output = Money;
    fn add(self, other: Money) -> Money {
        Money {
            actual_cents: self.actual_cents + other.actual_cents,
            estimated_cents: self.estimated_cents + other.estimated_cents,
            past_due_cents: self.past_due_cents + other.past_due_cents,
            assumed_cents: self.assumed_cents + other.assumed_cents,
        }
    }
}

impl Sub for Money {
    type Output = Money;
    fn sub(self, other: Money) -> Money {
        Money {
            actual_cents: self.actual_cents - other.actual_cents,
            estimated_cents: self.estimated_cents - other.estimated_cents,
            past_due_cents: self.past_due_cents - other.past_due_cents,
            assumed_cents: self.assumed_cents - other.assumed_cents,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurveStep {
    pub at_ms: i64,
    pub money: Money,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Curve {
    pub carried: Money,
    /// Soonest first.
    pub steps: Vec<CurveStep>,
    /// What the curve holds once each step is in.
    sums: Vec<Money>,
}

impl Curve {
    pub fn new(carried: Money, mut steps: Vec<CurveStep>) -> Curve {
        steps.sort_by_key(|step| step.at_ms);
        let mut sum = carried;
        let sums = steps
            .iter()
            .map(|step| {
                sum = sum + step.money;
                sum
            })
            .collect();
        Curve {
            carried,
            steps,
            sums,
        }
    }

    /// What a withdrawal at `at_ms` takes (counting from TaskMint's last one).
    pub fn at(&self, at_ms: i64) -> Money {
        match self.steps.partition_point(|step| step.at_ms <= at_ms) {
            0 => self.carried,
            reached => self.sums[reached - 1],
        }
    }

    /// The first step after `after_ms` that brings what's withdrawable to
    /// `need` more than `taken`.
    pub fn first_reaching(&self, after_ms: i64, taken: Money, need: i64) -> Option<i64> {
        let from = self.steps.partition_point(|step| step.at_ms <= after_ms);
        self.steps[from..]
            .iter()
            .zip(&self.sums[from..])
            .find(|(_, sum)| (**sum - taken).total() >= need)
            .map(|(step, _)| step.at_ms)
    }
}

/// When assumed earnings are taken to be released: the release days after
/// a work day ending at 5 pm.
const ASSUMED_DAY_ENDS: (u32, u32) = (17, 0);

/// `amount` as counted: estimates and past-due money only when the user counts them.
fn counted(amount: &Amount, plan: &TaskMintPlan) -> Money {
    let past_due = if plan.count_past_due {
        amount.past_due_cents
    } else {
        0
    };
    Money {
        actual_cents: amount.actual_cents - (amount.past_due_cents - past_due),
        estimated_cents: if plan.count_estimates {
            amount.estimated_cents
        } else {
            0
        },
        past_due_cents: past_due,
        assumed_cents: 0,
    }
}

/// `cents_per_hour` over `ms`, to the nearest cent.
fn earned(cents_per_hour: i64, ms: i64) -> i64 {
    let cents = i128::from(cents_per_hour) * i128::from(ms.max(0));
    ((cents + i128::from(HOUR_MS) / 2) / i128::from(HOUR_MS)) as i64
}

/// Now, in the zone of the device that built the forecast: its calendar
/// days (release days, `recentDays`) are that zone's, wherever this device is.
fn in_their_zone(forecast: &PayoutForecast, ctx: &Ctx) -> Ctx {
    Ctx::new(ctx.now_ms(), &forecast.zone)
}

/// The curve from now, up to `until_ms` for assumed earnings.
pub fn live_curve(
    forecast: &PayoutForecast,
    ctx: &Ctx,
    plan: &TaskMintPlan,
    until_ms: i64,
) -> Curve {
    let now = ctx.now_ms();
    let theirs = in_their_zone(forecast, ctx);
    let mut steps: Vec<CurveStep> = forecast
        .steps
        .iter()
        .map(|step| {
            let mut amount = Amount {
                actual_cents: step.actual_cents,
                estimated_cents: step.estimated_cents,
                past_due_cents: step.past_due_cents,
            };
            let mut at_ms = step.at_ms;
            if let Some(open) = step.open {
                amount.estimated_cents += earned(open.cents_per_hour, now - open.since_ms);
                // Released the release days after it stops: after now, at the earliest
                at_ms = at_ms.max(theirs.add_days(now, forecast.funds_release_days));
            }
            CurveStep {
                at_ms,
                money: counted(&amount, plan),
            }
        })
        .collect();
    steps.extend(assumed_steps(forecast, ctx, plan, until_ms));
    Curve::new(counted(&forecast.carried, plan), steps)
}

/// What a day is assumed to earn from tomorrow on: none when the user assumes nothing.
pub fn assumed_per_day(forecast: &PayoutForecast, ctx: &Ctx, plan: &TaskMintPlan) -> i64 {
    let (total, days) = match plan.future {
        FutureEarnings::Off => return 0,
        FutureEarnings::Weekly { cents } => (cents, 7),
        FutureEarnings::Trailing { weeks } => {
            let days = 7 * i64::from(weeks.max(1));
            // Their days are named in their zone: today there isn't over yet
            let today = in_their_zone(forecast, ctx).today();
            let first = today - Duration::days(days);
            let total = forecast
                .recent_days
                .iter()
                .filter_map(|day| {
                    let date = NaiveDate::parse_from_str(&day.day, "%Y-%m-%d").ok()?;
                    (date >= first && date < today)
                        .then_some(day.actual_cents + day.estimated_cents)
                })
                .sum();
            (total, days)
        }
    };
    (total.max(0) + days / 2) / days
}

/// Earnings assumed for each day from tomorrow, released by `until_ms`.
fn assumed_steps(
    forecast: &PayoutForecast,
    ctx: &Ctx,
    plan: &TaskMintPlan,
    until_ms: i64,
) -> Vec<CurveStep> {
    let per_day = assumed_per_day(forecast, ctx, plan);
    if per_day <= 0 {
        return Vec::new();
    }
    let ends =
        NaiveTime::from_hms_opt(ASSUMED_DAY_ENDS.0, ASSUMED_DAY_ENDS.1, 0).expect("a time of day");
    let mut steps = Vec::new();
    let mut day = ctx.today() + Duration::days(1);
    loop {
        let at_ms = ctx.add_days(ctx.at(day, ends), forecast.funds_release_days);
        if at_ms > until_ms || steps.len() >= 400 {
            break;
        }
        steps.push(CurveStep {
            at_ms,
            money: Money {
                assumed_cents: per_day,
                ..Money::default()
            },
        });
        day += Duration::days(1);
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::super::contract::{EarnedDay, Open, Step};
    use super::*;
    use crate::time::DAY_MS;

    pub(crate) fn forecast() -> PayoutForecast {
        PayoutForecast {
            schema: 1,
            as_of_ms: 0,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            cutoff: None,
            recent_withdrawals: vec![],
            next_allowed_at_ms: None,
            scheduled: None,
            carried: Amount {
                actual_cents: 1000,
                estimated_cents: 0,
                past_due_cents: 400,
            },
            steps: vec![],
            recent_days: vec![],
            zone: "UTC".into(),
        }
    }

    #[test]
    fn adds_up_to_each_time() {
        let curve = Curve::new(
            Money {
                actual_cents: 1,
                ..Money::default()
            },
            vec![
                CurveStep {
                    at_ms: 10,
                    money: Money {
                        estimated_cents: 2,
                        ..Money::default()
                    },
                },
                CurveStep {
                    at_ms: 20,
                    money: Money {
                        assumed_cents: 4,
                        past_due_cents: 1,
                        actual_cents: 1,
                        ..Money::default()
                    },
                },
            ],
        );
        assert_eq!(curve.at(9).total(), 1);
        assert_eq!(curve.at(10).total(), 3);
        assert_eq!(curve.at(25).total(), 8);
        assert_eq!(curve.at(25) - curve.at(10), curve.steps[1].money);
        let none = Money::default();
        assert_eq!(curve.first_reaching(0, none, 3), Some(10));
        assert_eq!(curve.first_reaching(10, none, 3), Some(20));
        assert_eq!(curve.first_reaching(0, none, 9), None);
        assert_eq!(curve.first_reaching(20, none, 1), None);
    }

    #[test]
    fn brings_open_timers_up_to_now_and_releases_them_after_it() {
        let now = 100 * DAY_MS;
        let ctx = Ctx::new(now, "UTC");
        let since = now - 90 * 60_000;
        let mut f = forecast();
        f.steps = vec![
            Step {
                at_ms: since + 7 * DAY_MS,
                actual_cents: 0,
                estimated_cents: 3000,
                past_due_cents: 0,
                open: Some(Open {
                    since_ms: since,
                    cents_per_hour: 6000,
                }),
            },
            Step {
                at_ms: now + DAY_MS,
                actual_cents: 500,
                estimated_cents: 0,
                past_due_cents: 0,
                open: None,
            },
        ];
        let curve = live_curve(&f, &ctx, &TaskMintPlan::default(), now);
        assert_eq!(curve.steps[1].at_ms, now + 7 * DAY_MS);
        assert_eq!(curve.steps[1].money.estimated_cents, 3000 + 9000);
        assert_eq!(curve.at(now + 7 * DAY_MS).total(), 1000 + 500 + 12000);

        // What the user doesn't count
        let plan = TaskMintPlan {
            count_estimates: false,
            count_past_due: false,
            ..TaskMintPlan::default()
        };
        let curve = live_curve(&f, &ctx, &plan, now);
        assert_eq!(
            curve.carried,
            Money {
                actual_cents: 600,
                ..Money::default()
            }
        );
        assert_eq!(curve.at(now + 30 * DAY_MS).total(), 1100);
    }

    #[test]
    fn assumes_future_earnings_only_when_asked() {
        let now = 100 * DAY_MS;
        let ctx = Ctx::new(now, "UTC");
        let mut f = forecast();
        let plan = |future| TaskMintPlan {
            future,
            ..TaskMintPlan::default()
        };
        assert_eq!(assumed_per_day(&f, &ctx, &plan(FutureEarnings::Off)), 0);
        assert_eq!(
            assumed_per_day(&f, &ctx, &plan(FutureEarnings::Weekly { cents: 7000 })),
            1000
        );
        assert_eq!(
            assumed_per_day(&f, &ctx, &plan(FutureEarnings::Weekly { cents: -5 })),
            0
        );
        let today = ctx.today();
        let day = |back: i64, cents: i64| EarnedDay {
            day: (today - Duration::days(back))
                .format("%Y-%m-%d")
                .to_string(),
            actual_cents: cents,
            estimated_cents: 1,
        };
        f.recent_days = vec![
            day(15, 99_999),
            day(14, 1399),
            day(1, 0),
            day(0, 99_999),
            EarnedDay {
                day: "garbage".into(),
                actual_cents: 5,
                estimated_cents: 5,
            },
        ];
        // Days 14 back to yesterday: (1400 + 1) / 14, today and older left out
        assert_eq!(
            assumed_per_day(&f, &ctx, &plan(FutureEarnings::Trailing { weeks: 2 })),
            100
        );
        // Zero weeks reads as one
        assert_eq!(
            assumed_per_day(&f, &ctx, &plan(FutureEarnings::Trailing { weeks: 0 })),
            0
        );

        // Tomorrow's assumed earnings come out a week after its 5 pm
        let weekly = plan(FutureEarnings::Weekly { cents: 7000 });
        let first = (100 + 1 + 7) * DAY_MS + 17 * crate::time::HOUR_MS;
        let curve = live_curve(&f, &ctx, &weekly, first + DAY_MS);
        let assumed: Vec<_> = curve
            .steps
            .iter()
            .map(|step| (step.at_ms, step.money.assumed_cents))
            .collect();
        assert_eq!(assumed, vec![(first, 1000), (first + DAY_MS, 1000)]);
        assert!(live_curve(&f, &ctx, &weekly, first - 1).steps.is_empty());
        // Never more than 400 days of it
        assert_eq!(live_curve(&f, &ctx, &weekly, i64::MAX).steps.len(), 400);
    }

    #[test]
    fn rounds_earnings_to_the_nearest_cent() {
        assert_eq!(earned(6000, HOUR_MS), 6000);
        assert_eq!(earned(1, HOUR_MS / 2), 1);
        assert_eq!(earned(1, HOUR_MS / 2 - 1), 0);
        assert_eq!(earned(6000, -5), 0);
    }

    #[test]
    fn counts_days_in_taskmints_zone_not_the_devices() {
        // The forecast was built in Chicago; this device is on UTC
        let mut f = forecast();
        f.zone = "America/Chicago".into();
        // Oct 28, 2026, noon UTC (7 am in Chicago): the clocks go back there on Nov 1
        let ctx = Ctx::new(1_793_188_800_000, "UTC");
        f.steps = vec![Step {
            at_ms: 0,
            actual_cents: 0,
            estimated_cents: 0,
            past_due_cents: 0,
            open: Some(Open {
                since_ms: ctx.now_ms(),
                cents_per_hour: 0,
            }),
        }];
        let plan = |future| TaskMintPlan {
            future,
            ..TaskMintPlan::default()
        };
        // Released seven calendar days on, at 7 am in Chicago: an hour later by UTC
        let off = plan(FutureEarnings::Off);
        let curve = live_curve(&f, &ctx, &off, ctx.now_ms());
        assert_eq!(curve.steps[0].at_ms, 1_793_797_200_000);

        // Nov 10, 3 am UTC is still the 9th in Chicago: the 9th is today there, not yet a full day
        let ctx = Ctx::new(1_794_279_600_000, "UTC");
        let day = |day: &str, cents: i64| EarnedDay {
            day: day.into(),
            actual_cents: cents,
            estimated_cents: 0,
        };
        f.recent_days = vec![day("2026-11-02", 700), day("2026-11-09", 1400)];
        assert_eq!(
            assumed_per_day(&f, &ctx, &plan(FutureEarnings::Trailing { weeks: 1 })),
            100
        );
    }
}
