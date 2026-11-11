//! When the balance would go short (or below the low mark), what more
//! TaskMint work would cover it: how much, and the last work day it could be
//! earned on and still reach the bank in time. TaskMint's money is released
//! the release days after the work, then waits for the next withdrawal the
//! user's policy makes, then for the bank: each step is the forecast's own
//! (crate::forecast), with the extra earnings put in as one more step.

use crate::forecast::contract::PayoutForecast;
use crate::forecast::curve::{live_curve, released_at, CurveStep, Money};
use crate::forecast::series::project_withdrawals;
use crate::model::{Cents, Settings};
use crate::project::DayRow;
use crate::time::{Ctx, HOUR_MS};
use chrono::{Duration, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EarnToCover {
    /// The first day the balance goes below what it's kept above.
    pub short_on: NaiveDate,
    /// What it's kept above: zero, or the low mark.
    pub keep_above_cents: Cents,
    /// What more TaskMint would have to earn, so no day to the horizon is below it.
    pub cents: Cents,
    /// Earned by the end of this day, it's in the bank by `short_on`; none
    /// when even today's work would come too late.
    pub work_by: Option<NaiveDate>,
    /// The withdrawal that would take it (for work by `work_by`, or today
    /// when that's too late), and the day it reaches the bank.
    pub withdrawn_on: Option<NaiveDate>,
    pub arrives_on: Option<NaiveDate>,
}

/// When `cents` more, earned on `day`, would be withdrawn and in the bank.
fn arrival(
    forecast: &PayoutForecast,
    ctx: &Ctx,
    settings: &Settings,
    until: i64,
    day: NaiveDate,
    cents: Cents,
) -> Option<(NaiveDate, NaiveDate)> {
    let plan = &settings.taskmint;
    let curve = live_curve(forecast, ctx, plan, until);
    let released = released_at(forecast, ctx, day);
    let extra = curve.with_step(CurveStep {
        at_ms: released,
        money: Money {
            estimated_cents: cents,
            ..Money::default()
        },
        day: Some(day),
    });
    project_withdrawals(forecast, &extra, ctx, plan, until)
        .into_iter()
        .find(|withdrawal| withdrawal.at_ms >= released)
        .map(|withdrawal| (ctx.day_of(withdrawal.at_ms), withdrawal.arrives_on))
}

/// What TaskMint would have to earn, and by when, for the balance in
/// `ahead` (today to the horizon) never to go below zero or the low mark.
/// None when it doesn't, or TaskMint's withdrawals aren't counted.
pub fn earn_to_cover(
    forecast: Option<&PayoutForecast>,
    ctx: &Ctx,
    settings: &Settings,
    ahead: &[DayRow],
) -> Option<EarnToCover> {
    let forecast = forecast.filter(|_| settings.taskmint.use_forecast)?;
    let keep_above = settings.low_balance_cents.max(0);
    let short = ahead
        .iter()
        .position(|day| day.closing_cents < keep_above)?;
    let short_on = ahead[short].date;
    let lowest = ahead[short..]
        .iter()
        .map(|day| day.closing_cents)
        .min()
        .expect("a short day is among them");
    let cents = keep_above - lowest;
    // Withdrawals made by the end of the horizon (less the bank's delay), as the cash flow's
    let end = ahead.last().expect("the days ahead start today").date;
    let delay = i64::from(settings.taskmint.arrival_delay_hours) * HOUR_MS;
    let until = ctx.at(end + Duration::days(1), NaiveTime::MIN) - 1 - delay;
    let today = ctx.today();

    let mut day = short_on;
    while day >= today {
        if let Some((withdrawn, arrives)) = arrival(forecast, ctx, settings, until, day, cents) {
            if arrives <= short_on {
                return Some(EarnToCover {
                    short_on,
                    keep_above_cents: keep_above,
                    cents,
                    work_by: Some(day),
                    withdrawn_on: Some(withdrawn),
                    arrives_on: Some(arrives),
                });
            }
        }
        day -= Duration::days(1);
    }
    let soonest = arrival(forecast, ctx, settings, until, today, cents);
    Some(EarnToCover {
        short_on,
        keep_above_cents: keep_above,
        cents,
        work_by: None,
        withdrawn_on: soonest.map(|(withdrawn, _)| withdrawn),
        arrives_on: soonest.map(|(_, arrives)| arrives),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::{DocKey, Snapshot};
    use crate::forecast::contract::{Amount, Taken};
    use crate::model::{Balance, ItemKind, Repeat, WithdrawPolicy};
    use crate::occur::tests::{d, item, put_item};
    use crate::project::project;
    use crate::time::DAY_MS;

    /// Nov 10, 2026, noon in Chicago (a Tuesday).
    fn ctx() -> Ctx {
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    /// Released 7 days after the work; a withdrawal every 3 days, the last
    /// taken yesterday; nothing more to come.
    fn forecast() -> PayoutForecast {
        let now = ctx().now_ms();
        PayoutForecast {
            schema: 1,
            as_of_ms: now,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: Some(now),
            cutoff: Some(Taken {
                taken_at_ms: now - DAY_MS,
                amount_cents: 0,
            }),
            recent_withdrawals: vec![],
            next_allowed_at_ms: Some(now + 2 * DAY_MS),
            scheduled: None,
            carried: Amount::default(),
            carried_days: vec![],
            steps: vec![],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        }
    }

    fn settings(low: Cents) -> Settings {
        Settings {
            balance: Some(Balance {
                cents: 10_000,
                as_of: d(2026, 11, 9),
            }),
            low_balance_cents: low,
            horizon_days: 40,
            ..Settings::default()
        }
    }

    fn cover(settings: Settings, rent_on: NaiveDate) -> Option<EarnToCover> {
        let mut s = Snapshot::default();
        s.write(DocKey::Settings, Some(&settings));
        put_item(
            &mut s,
            item("rent", ItemKind::Bill, rent_on, Repeat::Once, 30_000),
        );
        let f = forecast();
        let end = ctx().today() + Duration::days(i64::from(settings.horizon_days));
        let projection = project(&s, Some(&f), &ctx(), end);
        earn_to_cover(Some(&f), &ctx(), &settings, projection.ahead())
    }

    #[test]
    fn says_how_much_more_and_the_last_day_to_earn_it() {
        // $300 rent on Mon Nov 30 from $100: $200 short. Work by Sun Nov 22
        // is released Sun Nov 29 at 5 pm, withdrawn at once (nothing else is
        // due a withdrawal) and in the bank a day later: Mon Nov 30
        let found = cover(settings(0), d(2026, 11, 30)).unwrap();
        assert_eq!(
            found,
            EarnToCover {
                short_on: d(2026, 11, 30),
                keep_above_cents: 0,
                cents: 20_000,
                work_by: Some(d(2026, 11, 22)),
                withdrawn_on: Some(d(2026, 11, 29)),
                arrives_on: Some(d(2026, 11, 30)),
            }
        );
        // A day later would be too late: in the bank Dec 1
        let f = forecast();
        let until = ctx().at(d(2026, 12, 20), NaiveTime::MIN);
        let next_day = arrival(&f, &ctx(), &settings(0), until, d(2026, 11, 23), 20_000);
        assert_eq!(next_day, Some((d(2026, 11, 30), d(2026, 12, 1))));

        // Kept above a low mark of $50 instead: $250 more
        assert_eq!(
            cover(settings(5_000), d(2026, 11, 30)).unwrap().cents,
            25_000
        );
    }

    #[test]
    fn says_when_its_too_late_and_when_theres_nothing_to_cover() {
        // Rent tomorrow: no work now reaches the bank in time
        let late = cover(settings(0), d(2026, 11, 11)).unwrap();
        assert_eq!(late.work_by, None);
        assert_eq!(late.short_on, d(2026, 11, 11));
        // Today's work: released the 17th, then the next withdrawal
        assert!(late.arrives_on.unwrap() > d(2026, 11, 17));
        assert!(late.withdrawn_on.is_some());

        // Rent of only $50: never short
        let mut s = Snapshot::default();
        s.write(DocKey::Settings, Some(&settings(0)));
        let f = forecast();
        let projection = project(&s, Some(&f), &ctx(), d(2026, 12, 20));
        assert_eq!(
            earn_to_cover(Some(&f), &ctx(), &settings(0), projection.ahead()),
            None
        );

        // TaskMint not counted, or not there: nothing to say
        let mut off = settings(0);
        off.taskmint.use_forecast = false;
        assert_eq!(cover(off, d(2026, 11, 30)), None);
        assert_eq!(
            earn_to_cover(None, &ctx(), &settings(0), projection.ahead()),
            None
        );

        // Withdrawn weekly, past the horizon: no withdrawal takes it at all
        let mut weekly = settings(0);
        weekly.horizon_days = 10;
        weekly.taskmint.policy = WithdrawPolicy::Weekly {
            weekday: 0,
            hour: 9,
        };
        let found = cover(weekly, d(2026, 11, 20)).unwrap();
        assert_eq!((found.work_by, found.arrives_on), (None, None));
    }
}
