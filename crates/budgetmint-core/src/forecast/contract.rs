//! TaskMint's payout forecast, as its contract (schema 1) spells it. Fields
//! a later TaskMint adds are ignored; missing ones read as empty.

use crate::model::MAX_CENTS;
use crate::time::{DAY_MS, MAX_MS};
use serde::Deserialize;

/// The contract's version this BudgetMint reads.
pub const FORECAST_SCHEMA: u32 = 1;

/// The most days TaskMint may hold earnings back, and (in days) the longest
/// wait between withdrawals: a year.
pub const MAX_WAIT_DAYS: i64 = 366;
/// The most a timer may earn in an hour: $1,000,000.
pub const MAX_CENTS_PER_HOUR: i64 = 100_000_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Amount {
    pub actual_cents: i64,
    pub estimated_cents: i64,
    pub past_due_cents: i64,
}

/// A day whose timer hasn't stopped: its money is as of `since_ms`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Open {
    pub since_ms: i64,
    pub cents_per_hour: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub at_ms: i64,
    #[serde(default)]
    pub actual_cents: i64,
    #[serde(default)]
    pub estimated_cents: i64,
    #[serde(default)]
    pub past_due_cents: i64,
    #[serde(default)]
    pub open: Option<Open>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Taken {
    pub taken_at_ms: i64,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scheduled {
    pub release_ms: i64,
    pub due_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarnedDay {
    pub day: String,
    #[serde(default)]
    pub actual_cents: i64,
    #[serde(default)]
    pub estimated_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutForecast {
    pub schema: u32,
    #[serde(default)]
    pub as_of_ms: i64,
    pub funds_release_days: i64,
    pub withdrawal_interval_ms: i64,
    #[serde(default)]
    pub last_import_ms: Option<i64>,
    #[serde(default)]
    pub cutoff: Option<Taken>,
    #[serde(default)]
    pub recent_withdrawals: Vec<Taken>,
    #[serde(default)]
    pub next_allowed_at_ms: Option<i64>,
    #[serde(default)]
    pub scheduled: Option<Scheduled>,
    #[serde(default)]
    pub carried: Amount,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub recent_days: Vec<EarnedDay>,
    #[serde(default)]
    pub zone: String,
}

impl PayoutForecast {
    /// Whether every number is one TaskMint could have written: times from
    /// 1970 to 2199, amounts within core's limit, waits of a year at most.
    /// One that isn't reads as unreadable, rather than as withdrawals no one
    /// could take (or as dates core can't count to).
    pub fn in_range(&self) -> bool {
        let time = |ms: i64| (0..=MAX_MS).contains(&ms);
        let money = |cents: i64| cents.abs() <= MAX_CENTS;
        let amount = |a: &Amount| {
            money(a.actual_cents) && money(a.estimated_cents) && money(a.past_due_cents)
        };
        let taken = |t: &Taken| time(t.taken_at_ms) && money(t.amount_cents);
        let open =
            |o: &Open| time(o.since_ms) && (0..=MAX_CENTS_PER_HOUR).contains(&o.cents_per_hour);
        let step = |s: &Step| {
            time(s.at_ms)
                && amount(&Amount {
                    actual_cents: s.actual_cents,
                    estimated_cents: s.estimated_cents,
                    past_due_cents: s.past_due_cents,
                })
                && s.open.as_ref().is_none_or(open)
        };
        (0..=MAX_WAIT_DAYS).contains(&self.funds_release_days)
            && (0..=MAX_WAIT_DAYS * DAY_MS).contains(&self.withdrawal_interval_ms)
            && time(self.as_of_ms)
            && self.last_import_ms.is_none_or(time)
            && self.cutoff.as_ref().is_none_or(taken)
            && self.recent_withdrawals.iter().all(taken)
            && self.next_allowed_at_ms.is_none_or(time)
            && self
                .scheduled
                .is_none_or(|s| time(s.release_ms) && time(s.due_ms))
            && amount(&self.carried)
            && self.steps.iter().all(step)
            && self
                .recent_days
                .iter()
                .all(|day| money(day.actual_cents) && money(day.estimated_cents))
    }

    /// The withdrawals TaskMint has recorded, newest first (the cutoff alone
    /// when it lists none).
    pub fn taken(&self) -> Vec<Taken> {
        if self.recent_withdrawals.is_empty() {
            self.cutoff.into_iter().collect()
        } else {
            self.recent_withdrawals.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_taskmint_writes_ignoring_what_it_adds() {
        let forecast: PayoutForecast = serde_json::from_str(
            r#"{"schema":1,"asOfMs":1,"fundsReleaseDays":7,"withdrawalIntervalMs":3,"lastImportMs":null,
                "cutoff":{"takenAtMs":5,"amountCents":6},"recentWithdrawals":[],"nextAllowedAtMs":8,
                "scheduled":{"releaseMs":9,"dueMs":10},"carried":{"actualCents":2,"estimatedCents":0,"pastDueCents":1},
                "steps":[{"atMs":11,"actualCents":0,"estimatedCents":7,"pastDueCents":0,"open":{"sinceMs":3,"centsPerHour":6000}}],
                "recentDays":[{"day":"2026-11-07","actualCents":1,"estimatedCents":2}],"zone":"America/Chicago",
                "somethingNew":true}"#,
        )
        .unwrap();
        assert_eq!(forecast.carried.past_due_cents, 1);
        assert_eq!(forecast.steps[0].open.unwrap().cents_per_hour, 6000);
        assert_eq!(forecast.scheduled.unwrap().due_ms, 10);
        assert_eq!(forecast.recent_days[0].estimated_cents, 2);
        assert_eq!(forecast.next_allowed_at_ms, Some(8));
        assert_eq!(forecast.zone, "America/Chicago");
        // No recent ones listed: the cutoff
        assert_eq!(
            forecast.taken(),
            vec![Taken {
                taken_at_ms: 5,
                amount_cents: 6
            }]
        );
        let listed = PayoutForecast {
            recent_withdrawals: vec![Taken {
                taken_at_ms: 1,
                amount_cents: 2,
            }],
            ..forecast
        };
        assert_eq!(listed.taken().len(), 1);
    }

    #[test]
    fn says_whether_its_numbers_could_be_taskmints() {
        let fine: PayoutForecast = serde_json::from_str(
            r#"{"schema":1,"asOfMs":1,"fundsReleaseDays":7,"withdrawalIntervalMs":3,"lastImportMs":2,
                "cutoff":{"takenAtMs":5,"amountCents":6},"recentWithdrawals":[{"takenAtMs":5,"amountCents":6}],
                "nextAllowedAtMs":8,"scheduled":{"releaseMs":9,"dueMs":10},
                "carried":{"actualCents":2,"estimatedCents":0,"pastDueCents":1},
                "steps":[{"atMs":11,"actualCents":4,"open":{"sinceMs":3,"centsPerHour":6000}},{"atMs":12}],
                "recentDays":[{"day":"2026-11-07","actualCents":1,"estimatedCents":2}]}"#,
        )
        .unwrap();
        assert!(fine.in_range());
        let far = MAX_MS + 1;
        let huge = MAX_CENTS + 1;
        let wrong: Vec<fn(&mut PayoutForecast, i64, i64)> = vec![
            |f, _, _| f.funds_release_days = 367,
            |f, _, _| f.funds_release_days = -1,
            |f, _, _| f.withdrawal_interval_ms = 367 * DAY_MS,
            |f, far, _| f.as_of_ms = far,
            |f, _, _| f.as_of_ms = -1,
            |f, far, _| f.last_import_ms = Some(far),
            |f, far, _| f.cutoff.as_mut().unwrap().taken_at_ms = far,
            |f, _, huge| f.cutoff.as_mut().unwrap().amount_cents = huge,
            |f, _, huge| f.recent_withdrawals[0].amount_cents = -huge,
            |f, far, _| f.next_allowed_at_ms = Some(far),
            |f, far, _| f.scheduled.as_mut().unwrap().release_ms = far,
            |f, far, _| f.scheduled.as_mut().unwrap().due_ms = far,
            |f, _, huge| f.carried.actual_cents = huge,
            |f, _, huge| f.carried.estimated_cents = huge,
            |f, _, huge| f.carried.past_due_cents = huge,
            |f, far, _| f.steps[0].at_ms = far,
            |f, _, huge| f.steps[1].estimated_cents = huge,
            |f, far, _| f.steps[0].open.as_mut().unwrap().since_ms = far,
            |f, _, _| f.steps[0].open.as_mut().unwrap().cents_per_hour = MAX_CENTS_PER_HOUR + 1,
            |f, _, huge| f.recent_days[0].actual_cents = huge,
            |f, _, huge| f.recent_days[0].estimated_cents = huge,
        ];
        for (index, change) in wrong.iter().enumerate() {
            let mut forecast = fine.clone();
            change(&mut forecast, far, huge);
            assert!(!forecast.in_range(), "change {}", index);
        }
    }
}
