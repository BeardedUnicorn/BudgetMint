//! TaskMint's payout forecast, as its contract (schema 1) spells it. Fields
//! a later TaskMint adds are ignored; missing ones read as empty.

use serde::Deserialize;

/// The contract's version this BudgetMint reads.
pub const FORECAST_SCHEMA: u32 = 1;

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
}
