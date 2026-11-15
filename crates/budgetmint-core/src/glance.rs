//! The budget at a glance, for something that shows it while the app is
//! closed (Android's home-screen widgets): the overview and the goals as
//! they stand today and on each of the days after, so the day's own can be
//! shown when the day comes, with nobody there to ask core again.
//!
//! A later day's is what core would say that day if nothing changed
//! meanwhile: what's unpaid by then is overdue, the balance is the
//! projected one.

use crate::docs::Snapshot;
use crate::forecast::contract::PayoutForecast;
use crate::forecast::ForecastStatus;
use crate::goals::{self, GoalsView};
use crate::time::{instant, Ctx, MAX_MS};
use crate::views::{self, Overview};
use serde::{Deserialize, Serialize};

/// The most days ahead a glance covers, today included.
pub const MAX_GLANCE_DAYS: u8 = 14;

/// One day's: `overview.today` is the day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct GlanceDay {
    pub overview: Overview,
    pub goals: GoalsView,
}

/// Today's and the days' after it, `days` in all (one at least,
/// MAX_GLANCE_DAYS at most), each as of this time of day.
pub fn glance(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    status: &ForecastStatus,
    ctx: &Ctx,
    days: u8,
) -> Vec<GlanceDay> {
    (0..i64::from(days.clamp(1, MAX_GLANCE_DAYS)))
        .map(|ahead| {
            let then = Ctx {
                now: instant(ctx.add_days(ctx.now_ms(), ahead).min(MAX_MS)),
                zone: ctx.zone,
            };
            GlanceDay {
                overview: views::overview(snapshot, taskmint, status, &then),
                goals: goals::goals(snapshot, &then),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::JsonHost;
    use serde_json::{json, Value};

    /// Nov 10, 2026, 15:00 UTC: 9:00 in Chicago.
    const NOW: f64 = 1_794_322_800_000.0;

    fn call(host: &mut JsonHost, name: &str, args: Value) -> Value {
        serde_json::from_str(&host.call(name, &args.to_string(), NOW).unwrap()).unwrap()
    }

    #[test]
    fn todays_is_the_overviews_and_each_day_after_is_that_days() {
        let mut host = JsonHost::new("America/Chicago");
        let days = call(&mut host, "get_glance", json!({ "days": 3 }));
        let days = days.as_array().unwrap();
        assert_eq!(days.len(), 3);
        assert_eq!(
            days[0]["overview"],
            call(&mut host, "get_overview", json!({}))
        );
        assert_eq!(days[0]["goals"], call(&mut host, "get_goals", json!({})));
        assert_eq!(days[1]["overview"]["today"], "2026-11-11");
        assert_eq!(days[2]["goals"]["today"], "2026-11-12");
    }

    #[test]
    fn covers_a_day_at_least_and_two_weeks_at_most() {
        let mut host = JsonHost::new("UTC");
        let count = |host: &mut JsonHost, days: u8| {
            call(host, "get_glance", json!({ "days": days }))
                .as_array()
                .unwrap()
                .len()
        };
        assert_eq!(count(&mut host, 0), 1);
        assert_eq!(count(&mut host, 200), usize::from(MAX_GLANCE_DAYS));
    }
}
