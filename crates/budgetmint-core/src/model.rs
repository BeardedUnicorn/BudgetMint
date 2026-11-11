//! What BudgetMint keeps: bills and income on schedules, what happened to
//! their occurrences, and the account's settings. Each is a document of its
//! own (crate::docs); this is their JSON. Money is integer cents, dates are
//! calendar dates in the user's zone, and every field a later version adds
//! has a default, so older documents keep reading.

use crate::time::in_calendar;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Money in cents.
pub type Cents = i64;

/// The most a single amount may be: $10 billion, far past any bill.
pub const MAX_CENTS: Cents = 1_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    /// Money going out.
    Bill,
    /// Money coming in (other than TaskMint's withdrawals).
    Income,
}

/// How often an item comes round.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "every", rename_all = "camelCase")]
pub enum Repeat {
    /// Only on the segment's first date.
    Once,
    /// Every `n` days from the first date.
    Days { n: u16 },
    /// Every `n` weeks, on the first date's weekday.
    Weeks { n: u8 },
    /// Every `n` months, on day `day` (1–31). A month shorter than `day`
    /// has it on its last day, so 31 is "the last day of the month".
    Months { n: u8, day: u8 },
    /// Twice a month, on days `first` and `second` (1–31, `first` the
    /// earlier; 31 is the last day): the 1st and 15th, the 15th and last.
    TwiceMonthly { first: u8, second: u8 },
    /// Every `n` months on a weekday (0 Monday … 6 Sunday) of the month's
    /// `week`th week (1–4; 5 is the last): the second Friday, the last Monday.
    MonthWeekday { n: u8, week: u8, weekday: u8 },
    /// Every `n` years, on the first date's month and day (Feb 29 is Feb 28
    /// in other years).
    Years { n: u8 },
}

/// What becomes of a date that falls on a weekend (a payday banks move,
/// a bill due on a Sunday that's taken on Monday).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum Weekends {
    /// It stays on the weekend.
    #[default]
    Keep,
    /// The Friday before.
    Before,
    /// The Monday after.
    After,
}

/// A stretch of an item's schedule: from `from` (its first date) to `until`
/// (inclusive; open-ended without one), or to the next segment's `from`.
/// "Change from a date" starts a new segment, so the dates before keep
/// their occurrences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub from: NaiveDate,
    #[serde(default)]
    pub until: Option<NaiveDate>,
    pub repeat: Repeat,
    /// What each occurrence is expected to be (positive, for bills and income alike).
    pub amount_cents: Cents,
    /// Where a date on a weekend goes. The schedule's date is the one it
    /// moves to (that's the occurrence); `from` and `until` hold the dates
    /// before they move.
    #[serde(default)]
    pub weekends: Weekends,
}

/// When to be reminded of an item's occurrences: days before each (0: on the day).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ItemReminder {
    pub lead_days: Vec<u8>,
}

/// A bill or a source of income.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// Made by the client (core has no randomness): letters, digits, dashes.
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    /// Oldest first; never empty.
    pub schedule: Vec<Segment>,
    /// Paid (or received) on its own: assumed done on its date.
    #[serde(default)]
    pub autopay: bool,
    #[serde(default)]
    pub reminder: Option<ItemReminder>,
    /// Stopped: its occurrences no longer count, and history keeps them.
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub note: Option<String>,
    /// Its amount varies (a utility bill): the ones still to come are
    /// expected at the average of the last few paid (crate::occur::estimate),
    /// unless one has its own.
    #[serde(default)]
    pub varies: bool,
    /// Money is set aside for it ahead of each time it's due (crate::goals).
    #[serde(default)]
    pub save_up: Option<SaveUp>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Setting money aside for a bill: from when.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SaveUp {
    /// The day it was turned on: nothing is set aside before it.
    pub since: NaiveDate,
}

/// What happened to one occurrence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum OccStatus {
    /// Still to pay (or to come in).
    Open,
    /// Paid (or received) on `on`, for `amountCents`.
    Done {
        on: NaiveDate,
        #[serde(rename = "amountCents")]
        amount_cents: Cents,
    },
    /// Not happening this time.
    Skipped,
}

/// The user's word on one occurrence of an item: the one its schedule puts
/// on `date` (moving it doesn't change which one it is). Without one, an
/// occurrence is as the schedule says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Override {
    pub item_id: String,
    pub date: NaiveDate,
    pub status: OccStatus,
    /// This time's expected amount, when it isn't the schedule's.
    #[serde(default)]
    pub amount_cents: Option<Cents>,
    /// When it's due this time, when not on its date.
    #[serde(default)]
    pub moved_to: Option<NaiveDate>,
    #[serde(default)]
    pub note: Option<String>,
    pub updated_at: DateTime<Utc>,
}

/// The balance the forecast starts from: what the account held at the end
/// of `asOf`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub cents: Cents,
    pub as_of: NaiveDate,
}

/// When TaskMint's withdrawals are assumed to be made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WithdrawPolicy {
    /// As soon as the site allows one (and there's money to take).
    #[default]
    AsSoonAsOpen,
    /// On a weekday (0 Monday … 6 Sunday) at an hour, once the site allows.
    Weekly { weekday: u8, hour: u8 },
}

/// TaskMint's forecast reaches only as far as work already done. Beyond it,
/// earnings to come can be assumed (and are shown as assumed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FutureEarnings {
    /// Only what TaskMint knows of.
    #[default]
    Off,
    /// This much earned a week.
    Weekly { cents: Cents },
    /// What the last `weeks` weeks averaged.
    Trailing { weeks: u8 },
}

/// How the forecast counts TaskMint's withdrawals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
pub struct TaskMintPlan {
    /// Count TaskMint's withdrawals at all.
    pub use_forecast: bool,
    pub policy: WithdrawPolicy,
    /// Don't withdraw less than this: wait for more.
    pub min_withdrawal_cents: Cents,
    /// How long a withdrawal takes to reach the bank.
    pub arrival_delay_hours: u16,
    /// Count tracked time not imported yet (TaskMint's ~ amounts).
    pub count_estimates: bool,
    /// Count money the site still lists as pending after its release.
    pub count_past_due: bool,
    pub future: FutureEarnings,
}

impl Default for TaskMintPlan {
    fn default() -> Self {
        Self {
            use_forecast: true,
            policy: WithdrawPolicy::AsSoonAsOpen,
            min_withdrawal_cents: 0,
            arrival_delay_hours: 24,
            count_estimates: true,
            count_past_due: true,
            future: FutureEarnings::Off,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderSettings {
    /// The hour of the day reminders come (0–23).
    pub hour: u8,
    /// Days ahead a new bill reminds by default.
    pub lead_days: u8,
    /// Remind when the balance is about to go below the low mark.
    pub low_balance: bool,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        Self {
            hour: 9,
            lead_days: 3,
            low_balance: true,
        }
    }
}

/// The account's settings: one document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub balance: Option<Balance>,
    /// Days below this are flagged low (below zero is short).
    pub low_balance_cents: Cents,
    /// How far ahead the forecast looks.
    pub horizon_days: u16,
    pub taskmint: TaskMintPlan,
    pub reminders: ReminderSettings,
    /// The currency amounts are in (ISO 4217): only how they're written,
    /// since core keeps cents of whichever it is and converts nothing.
    pub currency: String,
    /// The calendar's weeks start on Monday (else Sunday).
    pub week_starts_monday: bool,
    /// What's spent in a week outside the bills (food, fuel): the cash flow
    /// takes it out a day at a time (crate::project::day_spending). 0: none.
    pub spending_weekly_cents: Cents,
    /// The balance's past updates, against what BudgetMint expected then,
    /// newest last (crate::plan::MAX_CHECKS of them).
    pub checks: Vec<BalanceCheck>,
}

/// An update of the balance, against what the cash flow expected it to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct BalanceCheck {
    /// The balance before: as of the end of this day.
    pub from: NaiveDate,
    /// The new balance's day.
    pub to: NaiveDate,
    /// What the cash flow had the balance at by the end of `to`.
    pub expected_cents: Cents,
    /// What it was.
    pub actual_cents: Cents,
    /// The everyday spending the cash flow took out over those days.
    pub assumed_spending_cents: Cents,
}

impl BalanceCheck {
    /// What went out over its days besides the bills: the spending assumed,
    /// and what the balance came in below what was expected.
    pub fn spent_outside_cents(&self) -> Cents {
        self.assumed_spending_cents + self.expected_cents - self.actual_cents
    }

    /// The days it covers.
    pub fn days(&self) -> i64 {
        (self.to - self.from).num_days()
    }
}

/// The currency amounts are in until the user chooses another.
pub const DEFAULT_CURRENCY: &str = "USD";

pub const DEFAULT_HORIZON_DAYS: u16 = 60;
pub const MIN_HORIZON_DAYS: u16 = 14;
pub const MAX_HORIZON_DAYS: u16 = 366;

impl Default for Settings {
    fn default() -> Self {
        Self {
            balance: None,
            low_balance_cents: 0,
            horizon_days: DEFAULT_HORIZON_DAYS,
            taskmint: TaskMintPlan::default(),
            reminders: ReminderSettings::default(),
            currency: DEFAULT_CURRENCY.into(),
            week_starts_monday: false,
            spending_weekly_cents: 0,
            checks: Vec::new(),
        }
    }
}

// Whether each document's dates are all in core's calendar (crate::time):
// one with a date outside it doesn't read.

impl Item {
    pub fn in_calendar(&self) -> bool {
        self.schedule
            .iter()
            .all(|segment| in_calendar(segment.from) && segment.until.is_none_or(in_calendar))
            && self
                .save_up
                .is_none_or(|save_up| in_calendar(save_up.since))
    }
}

impl OccStatus {
    pub fn in_calendar(&self) -> bool {
        match self {
            OccStatus::Done { on, .. } => in_calendar(*on),
            OccStatus::Open | OccStatus::Skipped => true,
        }
    }
}

impl Override {
    pub fn in_calendar(&self) -> bool {
        in_calendar(self.date) && self.moved_to.is_none_or(in_calendar) && self.status.in_calendar()
    }
}

impl Settings {
    pub fn in_calendar(&self) -> bool {
        self.balance
            .is_none_or(|balance| in_calendar(balance.as_of))
            && self
                .checks
                .iter()
                .all(|check| in_calendar(check.from) && in_calendar(check.to))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_older_documents_with_defaults() {
        let settings: Settings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(settings, Settings::default());
        let partial: Settings =
            serde_json::from_value(json!({ "taskmint": { "minWithdrawalCents": 500 } })).unwrap();
        assert_eq!(partial.taskmint.min_withdrawal_cents, 500);
        assert!(partial.taskmint.count_estimates);
        assert_eq!(partial.reminders.hour, 9);
    }

    #[test]
    fn writes_the_documented_json() {
        let item = Item {
            id: "rent".into(),
            kind: ItemKind::Bill,
            name: "Rent".into(),
            category: None,
            schedule: vec![Segment {
                from: NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
                until: None,
                repeat: Repeat::Months { n: 1, day: 31 },
                amount_cents: 120_000,
                weekends: crate::model::Weekends::Keep,
            }],
            autopay: false,
            reminder: Some(ItemReminder { lead_days: vec![3] }),
            archived: false,
            note: None,
            varies: false,
            save_up: None,
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
        };
        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            json!({
                "id": "rent", "kind": "bill", "name": "Rent", "category": null,
                "schedule": [{ "from": "2026-01-31", "until": null,
                               "repeat": { "every": "months", "n": 1, "day": 31 }, "amountCents": 120000,
                               "weekends": "keep" }],
                "autopay": false, "reminder": { "leadDays": [3] }, "archived": false, "note": null,
                "varies": false, "saveUp": null,
                "createdAt": "1970-01-01T00:00:00Z", "updatedAt": "1970-01-01T00:00:00Z"
            })
        );
        let done = OccStatus::Done {
            on: NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
            amount_cents: 5,
        };
        assert_eq!(
            serde_json::to_value(done).unwrap(),
            json!({ "state": "done", "on": "2026-02-01", "amountCents": 5 })
        );
        assert_eq!(
            serde_json::to_value(WithdrawPolicy::Weekly {
                weekday: 4,
                hour: 9
            })
            .unwrap(),
            json!({ "kind": "weekly", "weekday": 4, "hour": 9 })
        );
        assert_eq!(
            serde_json::to_value(FutureEarnings::Trailing { weeks: 4 }).unwrap(),
            json!({ "kind": "trailing", "weeks": 4 })
        );
        assert_eq!(
            serde_json::to_value(Repeat::TwiceMonthly {
                first: 1,
                second: 15
            })
            .unwrap(),
            json!({ "every": "twiceMonthly", "first": 1, "second": 15 })
        );
        assert_eq!(
            serde_json::to_value(Repeat::MonthWeekday {
                n: 1,
                week: 2,
                weekday: 4
            })
            .unwrap(),
            json!({ "every": "monthWeekday", "n": 1, "week": 2, "weekday": 4 })
        );
        // A segment from before weekends could move keeps its dates
        let older: Segment = serde_json::from_value(json!({
            "from": "2026-01-31", "repeat": { "every": "once" }, "amountCents": 1
        }))
        .unwrap();
        assert_eq!(older.weekends, Weekends::Keep);
        assert_eq!(
            serde_json::to_value(Weekends::Before).unwrap(),
            json!("before")
        );
    }
}
