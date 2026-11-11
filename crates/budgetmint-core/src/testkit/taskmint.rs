//! TaskMint's golden fixtures for the payout forecast (pinned in
//! taskmint/*.json): at each fixture's now, what a withdrawal at each time
//! takes, and the next withdrawal, must be TaskMint's own answers, worked
//! out here from the forecast alone.

use crate::forecast::contract::PayoutForecast;
use crate::forecast::curve::live_curve;
use crate::forecast::series::project_withdrawals;
use crate::model::TaskMintPlan;
use crate::time::Ctx;
use serde::Deserialize;

const FIXTURES: &[(&str, &str)] = &[
    (
        "after-withdrawal",
        include_str!("taskmint/after-withdrawal.json"),
    ),
    ("no-withdrawal", include_str!("taskmint/no-withdrawal.json")),
    ("open-timers", include_str!("taskmint/open-timers.json")),
    ("window-open", include_str!("taskmint/window-open.json")),
];

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Withdrawable {
    actual_cents: i64,
    estimated_cents: i64,
    past_due_cents: i64,
    total_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sample {
    at_ms: i64,
    #[serde(flatten)]
    amount: Withdrawable,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Next {
    opens_at_ms: i64,
    is_open: bool,
    #[serde(flatten)]
    amount: Withdrawable,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    now_ms: i64,
    forecast: PayoutForecast,
    withdrawable: Vec<Sample>,
    next: Option<Next>,
}

#[test]
fn reads_taskmints_forecast_as_taskmint_does() {
    for (name, text) in FIXTURES {
        let fixture: Fixture = serde_json::from_str(text).expect(name);
        let forecast = &fixture.forecast;
        let ctx = Ctx::new(fixture.now_ms, &forecast.zone);
        // Counting what TaskMint counts, and nothing assumed
        let plan = TaskMintPlan::default();
        let curve = live_curve(forecast, &ctx, &plan, i64::MAX);
        for sample in &fixture.withdrawable {
            let money = curve.at(sample.at_ms);
            let found = Withdrawable {
                actual_cents: money.actual_cents,
                estimated_cents: money.estimated_cents,
                past_due_cents: money.past_due_cents,
                total_cents: money.total(),
            };
            assert_eq!(found, sample.amount, "{} at {}", name, sample.at_ms);
        }

        let withdrawals = project_withdrawals(forecast, &curve, &ctx, &plan, i64::MAX);
        match &fixture.next {
            // TaskMint has no plan without a withdrawal recorded; BudgetMint's first is now
            None => assert_eq!(withdrawals[0].at_ms, fixture.now_ms, "{}", name),
            Some(next) => {
                let first = &withdrawals[0];
                assert_eq!(first.at_ms, next.opens_at_ms, "{}", name);
                assert_eq!(first.opens_now, next.is_open, "{}", name);
                assert_eq!(first.total_cents, next.amount.total_cents, "{}", name);
                assert_eq!(
                    first.money.actual_cents, next.amount.actual_cents,
                    "{}",
                    name
                );
                assert_eq!(
                    first.money.estimated_cents, next.amount.estimated_cents,
                    "{}",
                    name
                );
                assert_eq!(
                    first.money.past_due_cents, next.amount.past_due_cents,
                    "{}",
                    name
                );
            }
        }
    }
}
