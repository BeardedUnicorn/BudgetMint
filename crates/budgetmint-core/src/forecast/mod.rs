//! TaskMint's withdrawals ahead, from the payout forecast it publishes
//! (docs/taskmint/payout-forecast.md, pinned from TaskMint):
//!
//! - [`contract`] reads it;
//! - [`curve`] turns it into what a withdrawal at any time from now takes,
//!   with open timers brought up to now and (if the user wants) earnings
//!   still to come;
//! - [`series`] projects the withdrawals themselves, and when each reaches
//!   the bank.
//!
//! None of TaskMint's math is here: the forecast is its answer, and its
//! golden fixtures (src/testkit/taskmint) check that this reads it right.

pub mod contract;
pub mod curve;
pub mod series;

use contract::{PayoutForecast, FORECAST_SCHEMA};
use serde::{Deserialize, Serialize};

/// The forecast document as the client read it (null: there's none).
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ForecastDoc {
    pub json: String,
    pub schema: u32,
    #[serde(default)]
    pub app_version: Option<String>,
    /// When TaskMint wrote it (the server's time).
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum ForecastState {
    /// No TaskMint device has published one (none syncs with this account).
    Missing,
    Ready,
    /// From a newer TaskMint than this BudgetMint knows: update BudgetMint.
    Newer,
    /// It doesn't read as a forecast.
    Unreadable,
}

/// What BudgetMint knows of TaskMint's forecast, for Settings and the pages' notes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ForecastStatus {
    pub state: ForecastState,
    /// The TaskMint that published it.
    pub app_version: Option<String>,
    pub published_at_ms: Option<i64>,
    /// When TaskMint's data was last written (the forecast holds from then).
    pub as_of_ms: Option<i64>,
    /// When TaskMint last imported the payment site's ledger.
    pub last_import_ms: Option<i64>,
}

/// TaskMint's forecast as core holds it.
#[derive(Debug, Clone)]
pub struct TaskMint {
    pub status: ForecastStatus,
    pub forecast: Option<PayoutForecast>,
}

impl Default for TaskMint {
    fn default() -> Self {
        Self::read(None)
    }
}

impl TaskMint {
    /// The forecast document, read.
    pub fn read(doc: Option<ForecastDoc>) -> TaskMint {
        let status =
            |state, doc: &Option<ForecastDoc>, forecast: Option<&PayoutForecast>| ForecastStatus {
                state,
                app_version: doc.as_ref().and_then(|doc| doc.app_version.clone()),
                published_at_ms: doc.as_ref().and_then(|doc| doc.updated_at_ms),
                as_of_ms: forecast.map(|forecast| forecast.as_of_ms),
                last_import_ms: forecast.and_then(|forecast| forecast.last_import_ms),
            };
        let Some(found) = &doc else {
            return TaskMint {
                status: status(ForecastState::Missing, &doc, None),
                forecast: None,
            };
        };
        if found.schema > FORECAST_SCHEMA {
            return TaskMint {
                status: status(ForecastState::Newer, &doc, None),
                forecast: None,
            };
        }
        match serde_json::from_str::<PayoutForecast>(&found.json) {
            Ok(forecast) if forecast.schema <= FORECAST_SCHEMA => TaskMint {
                status: status(ForecastState::Ready, &doc, Some(&forecast)),
                forecast: Some(forecast),
            },
            Ok(_) => TaskMint {
                status: status(ForecastState::Newer, &doc, None),
                forecast: None,
            },
            Err(_) => TaskMint {
                status: status(ForecastState::Unreadable, &doc, None),
                forecast: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(json: &str, schema: u32) -> Option<ForecastDoc> {
        Some(ForecastDoc {
            json: json.into(),
            schema,
            app_version: Some("4.2.0".into()),
            updated_at_ms: Some(7),
        })
    }

    #[test]
    fn reads_the_forecast_or_says_why_not() {
        assert_eq!(TaskMint::default().status.state, ForecastState::Missing);
        let ready = TaskMint::read(doc(
            r#"{"schema":1,"asOfMs":5,"fundsReleaseDays":7,"withdrawalIntervalMs":3,"lastImportMs":4}"#,
            1,
        ));
        assert_eq!(
            ready.status,
            ForecastStatus {
                state: ForecastState::Ready,
                app_version: Some("4.2.0".into()),
                published_at_ms: Some(7),
                as_of_ms: Some(5),
                last_import_ms: Some(4),
            }
        );
        assert!(ready.forecast.is_some());
        assert_eq!(
            TaskMint::read(doc("{}", 2)).status.state,
            ForecastState::Newer
        );
        let newer_json = TaskMint::read(doc(
            r#"{"schema":2,"fundsReleaseDays":7,"withdrawalIntervalMs":3}"#,
            1,
        ));
        assert_eq!(newer_json.status.state, ForecastState::Newer);
        let broken = TaskMint::read(doc("{", 1));
        assert_eq!(broken.status.state, ForecastState::Unreadable);
        assert_eq!(broken.status.app_version.as_deref(), Some("4.2.0"));
        assert!(broken.forecast.is_none());
    }
}
