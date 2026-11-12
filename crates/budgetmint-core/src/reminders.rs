//! The reminders coming up: each open occurrence of an item with a
//! reminder, the set number of days before it's due, at the hour the user
//! chose; and, when an account's balance is about to go low, one about that. Each has
//! a stable key (and a 31-bit id from it, for Android's scheduled
//! notifications), so scheduling them again replaces rather than repeats.
//! The client words them.
//!
//! A device that shows reminders only while BudgetMint runs (the desktop,
//! the web) can also ask for the ones it missed while it was closed: those
//! due since it last ran, up to MISSED_MAX_MS ago, which it shows at once.

use crate::docs::Snapshot;
use crate::forecast::contract::PayoutForecast;
use crate::model::{Cents, ItemKind, OccStatus};
use crate::occur::occurrences;
use crate::project::project_accounts;
use crate::time::{hour, Ctx};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// The furthest ahead reminders are worked out, and the most at once.
pub const MAX_WINDOW_DAYS: u16 = 60;
pub const MAX_REMINDERS: u16 = 64;
/// The furthest back a missed reminder is still shown.
pub const MISSED_MAX_MS: i64 = crate::time::DAY_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum ReminderKind {
    Bill,
    Income,
    /// Money to move between two accounts.
    Transfer,
    /// The balance goes below the low mark (or zero) on `due`.
    LowBalance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Stable: the same reminder always has it.
    pub key: String,
    /// The key as a positive 31-bit number (Android's notification ids).
    pub id: u32,
    pub at_ms: i64,
    pub kind: ReminderKind,
    pub item_id: Option<String>,
    /// The item's name; for a low-balance one, the account's when it isn't the main one (else empty).
    pub name: String,
    /// The account a low-balance one is about, when it isn't the main one.
    pub account_id: Option<String>,
    pub due: NaiveDate,
    /// The occurrence's amount; the balance then, for a low-balance one.
    pub amount_cents: Cents,
    pub lead_days: u8,
    /// Days from when it's shown to `due`: `lead_days` at its time, fewer
    /// for one shown late (below zero once `due` has passed).
    pub days_left: i32,
    pub autopay: bool,
    /// Below zero (not just low), for a low-balance one.
    pub short: bool,
}

/// FNV-1a (32-bit) of `key`, as a positive 31-bit id.
pub fn reminder_id(key: &str) -> u32 {
    let hash = key.bytes().fold(0x811c_9dc5_u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    });
    hash & 0x7fff_ffff
}

/// The reminders from now to `window_days` ahead, soonest first, `max` at
/// most; with `missed_since`, also those due after it (MISSED_MAX_MS back at
/// most) that are still to be acted on, which are shown now.
pub fn upcoming(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    ctx: &Ctx,
    window_days: u16,
    max: u16,
    missed_since: Option<i64>,
) -> Vec<Reminder> {
    let settings = snapshot.settings();
    let now = ctx.now_ms();
    let today = ctx.today();
    let window = i64::from(window_days.min(MAX_WINDOW_DAYS));
    let until = now + window * crate::time::DAY_MS;
    let from = missed_since.map_or(now, |since| since.clamp(now - MISSED_MAX_MS, now));
    let at_hour = hour(settings.reminders.hour.min(23));
    // Days from when a reminder at `at_ms` is shown (now, if it was missed) to `due`
    let days_left =
        |due: NaiveDate, at_ms: i64| (due - ctx.day_of(at_ms.max(now))).num_days() as i32;
    let mut found = Vec::new();

    // Leads reach up to 30 days ahead of the due day; a missed one may be
    // for an occurrence due since it was missed
    let first = ctx.day_of(from);
    for occurrence in occurrences(snapshot, first, today + Duration::days(window + 31), false) {
        let item = occurrence.item;
        let Some(reminder) = &item.reminder else {
            continue;
        };
        if occurrence.status != OccStatus::Open {
            continue;
        }
        for lead in &reminder.lead_days {
            let at_ms = ctx.at(occurrence.due - Duration::days(i64::from(*lead)), at_hour);
            if at_ms <= from || at_ms > until {
                continue;
            }
            let key = format!(
                "{}~{}~{}",
                item.id,
                occurrence.scheduled.format("%Y-%m-%d"),
                lead
            );
            found.push(Reminder {
                id: reminder_id(&key),
                key,
                at_ms,
                kind: match item.kind {
                    ItemKind::Bill => ReminderKind::Bill,
                    ItemKind::Income => ReminderKind::Income,
                    ItemKind::Transfer => ReminderKind::Transfer,
                },
                item_id: Some(item.id.clone()),
                name: item.name.clone(),
                account_id: None,
                due: occurrence.due,
                amount_cents: occurrence.expected_cents,
                lead_days: *lead,
                days_left: days_left(occurrence.due, at_ms),
                autopay: item.autopay,
                short: false,
            });
        }
    }

    if settings.reminders.low_balance {
        // At the reminder hour, today's if it's still to come
        let next_at = |date: NaiveDate| ctx.at(date, at_hour);
        let at_ms = if next_at(today) > now {
            next_at(today)
        } else {
            next_at(today + Duration::days(1))
        };
        // Each account by its own balance and low mark
        for flow in project_accounts(snapshot, taskmint, ctx, today + Duration::days(window)) {
            let (account, projection) = (&flow.account, &flow.projection);
            // Without a balance the cash flow starts at an invented zero: no warning
            let low = projection
                .ahead()
                .iter()
                .filter(|_| projection.has_balance)
                .find(|day| day.closing_cents < account.low_balance_cents.max(0));
            let Some(day) = low.filter(|day| ctx.day_of(at_ms) <= day.date && at_ms <= until)
            else {
                continue;
            };
            let on = day.date.format("%Y-%m-%d");
            // The main account's key is what it was before there were others
            let key = if account.is_main() {
                format!("low~{}", on)
            } else {
                format!("low~{}~{}", account.id, on)
            };
            found.push(Reminder {
                id: reminder_id(&key),
                key,
                at_ms,
                kind: ReminderKind::LowBalance,
                item_id: None,
                // Which account, when it isn't the main one
                name: if account.is_main() {
                    String::new()
                } else {
                    account.name.clone()
                },
                account_id: (!account.is_main()).then(|| account.id.clone()),
                due: day.date,
                amount_cents: day.closing_cents,
                lead_days: 0,
                days_left: days_left(day.date, at_ms),
                autopay: false,
                short: day.short,
            });
        }
    }

    found.sort_by(|a, b| (a.at_ms, &a.key).cmp(&(b.at_ms, &b.key)));
    found.truncate(usize::from(max.min(MAX_REMINDERS)));
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::model::{Balance, ItemReminder, Repeat, Settings};
    use crate::occur::tests::{d, item, over, put_item, put_over};
    use crate::time::instant;

    /// Nov 10, 2026, noon in Chicago.
    fn ctx() -> Ctx {
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn reminded(lead_days: Vec<u8>, mut it: crate::model::Item) -> crate::model::Item {
        it.reminder = Some(ItemReminder { lead_days });
        it
    }

    #[test]
    fn reminds_the_set_days_before_at_the_set_hour() {
        let mut s = Snapshot::default();
        put_item(
            &mut s,
            reminded(
                vec![0, 3],
                item(
                    "rent",
                    ItemKind::Bill,
                    d(2026, 11, 14),
                    Repeat::Months { n: 1, day: 14 },
                    9,
                ),
            ),
        );
        let mut pay = reminded(
            vec![1],
            item("pay", ItemKind::Income, d(2026, 11, 20), Repeat::Once, 5),
        );
        pay.autopay = true;
        put_item(&mut s, pay);
        // No reminder, a paid one, and one whose reminder time has passed (today at 9)
        put_item(
            &mut s,
            item("quiet", ItemKind::Bill, d(2026, 11, 12), Repeat::Once, 1),
        );
        put_item(
            &mut s,
            reminded(
                vec![0],
                item("paid", ItemKind::Bill, d(2026, 11, 13), Repeat::Once, 1),
            ),
        );
        put_over(
            &mut s,
            over(
                "paid",
                d(2026, 11, 13),
                OccStatus::Done {
                    on: d(2026, 11, 9),
                    amount_cents: 1,
                },
            ),
        );
        put_item(
            &mut s,
            reminded(
                vec![0],
                item("today", ItemKind::Bill, d(2026, 11, 10), Repeat::Once, 1),
            ),
        );
        let settings = Settings {
            reminders: crate::model::ReminderSettings {
                low_balance: false,
                ..Default::default()
            },
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));

        let found = upcoming(&s, None, &ctx(), 20, 10, None);
        let summary: Vec<_> = found
            .iter()
            .map(|r| (r.key.as_str(), instant(r.at_ms).to_rfc3339(), r.kind))
            .collect();
        assert_eq!(
            summary,
            vec![
                (
                    "rent~2026-11-14~3",
                    "2026-11-11T15:00:00+00:00".into(),
                    ReminderKind::Bill
                ),
                (
                    "rent~2026-11-14~0",
                    "2026-11-14T15:00:00+00:00".into(),
                    ReminderKind::Bill
                ),
                (
                    "pay~2026-11-20~1",
                    "2026-11-19T15:00:00+00:00".into(),
                    ReminderKind::Income
                ),
            ]
        );
        // December's 3-days-before is past the window's 20 days
        assert_eq!(upcoming(&s, None, &ctx(), 31, 10, None).len(), 4);
        assert!(found[2].autopay);
        assert_eq!(found[0].id, reminder_id("rent~2026-11-14~3"));
        assert!(found.iter().all(|r| r.id < 1 << 31));
        // The most asked for
        assert_eq!(upcoming(&s, None, &ctx(), 20, 2, None).len(), 2);
        // Within the window only
        assert_eq!(upcoming(&s, None, &ctx(), 5, 10, None).len(), 2);
    }

    #[test]
    fn catches_up_on_the_ones_missed_in_the_last_day() {
        let mut s = Snapshot::default();
        let bill = |id: &str, due: NaiveDate, lead: u8| {
            reminded(vec![lead], item(id, ItemKind::Bill, due, Repeat::Once, 1))
        };
        // At 13:00: yesterday's (23 hours ago) and the day before's (47)
        put_item(&mut s, bill("late", d(2026, 11, 9), 0));
        put_item(&mut s, bill("soon", d(2026, 11, 12), 3));
        put_item(&mut s, bill("old", d(2026, 11, 8), 0));
        put_item(&mut s, bill("paid", d(2026, 11, 9), 0));
        put_over(
            &mut s,
            over(
                "paid",
                d(2026, 11, 9),
                OccStatus::Done {
                    on: d(2026, 11, 9),
                    amount_cents: 1,
                },
            ),
        );
        put_item(&mut s, bill("next", d(2026, 11, 10), 0));
        let settings = Settings {
            reminders: crate::model::ReminderSettings {
                hour: 13,
                low_balance: false,
                ..Default::default()
            },
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        let now = ctx().now_ms();
        let keys = |since: Option<i64>| -> Vec<(String, i32)> {
            upcoming(&s, None, &ctx(), 5, 10, since)
                .into_iter()
                .map(|r| (r.key, r.days_left))
                .collect()
        };

        // Missed since long ago: the last day's only, worded as of today
        assert_eq!(
            keys(Some(0)),
            vec![
                ("late~2026-11-09~0".to_string(), -1),
                ("soon~2026-11-12~3".to_string(), 2),
                ("next~2026-11-10~0".to_string(), 0),
            ]
        );
        // Since an hour ago, nothing was missed; nor without asking, or from later than now
        let upcoming_only = vec![("next~2026-11-10~0".to_string(), 0)];
        assert_eq!(keys(Some(now - crate::time::HOUR_MS)), upcoming_only);
        assert_eq!(keys(None), upcoming_only);
        assert_eq!(keys(Some(now + crate::time::DAY_MS)), upcoming_only);
    }

    #[test]
    fn warns_before_the_balance_goes_low() {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 1_000,
                as_of: d(2026, 11, 10),
            }),
            low_balance_cents: 500,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        put_item(
            &mut s,
            item("card", ItemKind::Bill, d(2026, 11, 16), Repeat::Once, 2_000),
        );
        let found = upcoming(&s, None, &ctx(), 10, 10, None);
        assert_eq!(found.len(), 1);
        let low = &found[0];
        assert_eq!(
            (low.kind, low.due, low.amount_cents, low.short),
            (ReminderKind::LowBalance, d(2026, 11, 16), -1_000, true)
        );
        // It's past 9 today: tomorrow at 9
        assert_eq!(instant(low.at_ms).to_rfc3339(), "2026-11-11T15:00:00+00:00");
        // Before 9: today at 9
        let early = Ctx::new(
            1_794_333_600_000 - 5 * crate::time::HOUR_MS,
            "America/Chicago",
        );
        assert_eq!(
            instant(upcoming(&s, None, &early, 10, 10, None)[0].at_ms).to_rfc3339(),
            "2026-11-10T15:00:00+00:00"
        );
        // Not low within the window, or low today already (too late to warn ahead)
        assert!(upcoming(&s, None, &ctx(), 3, 10, None).is_empty());
        let mut low_now = settings.clone();
        low_now.balance = Some(Balance {
            cents: 100,
            as_of: d(2026, 11, 10),
        });
        s.write(DocKey::Settings, Some(&low_now));
        assert!(upcoming(&s, None, &ctx(), 10, 10, None).is_empty());
        // Without a balance set there's nothing to warn about
        s.write(DocKey::Settings, Some(&Settings::default()));
        assert!(upcoming(&s, None, &ctx(), 10, 10, None).is_empty());
    }

    #[test]
    fn ids_are_stable_31_bit_hashes() {
        assert_eq!(reminder_id(""), 0x811c_9dc5 & 0x7fff_ffff);
        assert_eq!(reminder_id("a"), 0xe40c_292c & 0x7fff_ffff);
    }

    #[test]
    fn reminds_of_a_transfer_as_one() {
        use crate::occur::tests::{put_account, transfer};
        let mut s = Snapshot::default();
        put_account(&mut s, "savings", None);
        put_item(
            &mut s,
            reminded(
                vec![1],
                transfer(
                    "put",
                    (None, Some("savings")),
                    d(2026, 11, 14),
                    Repeat::Once,
                    5_000,
                ),
            ),
        );
        let found = upcoming(&s, None, &ctx(), 10, 10, None);
        assert_eq!(found.len(), 1);
        assert_eq!(
            (found[0].kind, found[0].amount_cents, found[0].due),
            (ReminderKind::Transfer, 5_000, d(2026, 11, 14))
        );
    }

    #[test]
    fn warns_of_each_account_by_its_own_balance_and_low_mark() {
        use crate::model::Account;
        use crate::occur::tests::in_account;
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 1_000,
                as_of: d(2026, 11, 10),
            }),
            low_balance_cents: 500,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        let account = |id: &str, balance: Option<Balance>| Account {
            id: id.into(),
            name: format!("My {}", id),
            order: 1,
            balance,
            low_balance_cents: 25_000,
            checks: Vec::new(),
            archived: false,
        };
        let savings = account(
            "savings",
            Some(Balance {
                cents: 30_000,
                as_of: d(2026, 11, 10),
            }),
        );
        s.write(DocKey::Account("savings".into()), Some(&savings));
        // No balance yet: nothing to warn of
        s.write(DocKey::Account("card".into()), Some(&account("card", None)));
        put_item(
            &mut s,
            in_account(
                item("fee", ItemKind::Bill, d(2026, 11, 14), Repeat::Once, 6_000),
                "savings",
            ),
        );
        put_item(
            &mut s,
            in_account(
                item("due", ItemKind::Bill, d(2026, 11, 14), Repeat::Once, 6_000),
                "card",
            ),
        );
        let found = upcoming(&s, None, &ctx(), 10, 10, None);
        assert_eq!(found.len(), 1);
        let low = &found[0];
        assert_eq!(low.key, "low~savings~2026-11-14");
        assert_eq!(
            (
                low.name.as_str(),
                low.account_id.as_deref(),
                low.amount_cents,
                low.short
            ),
            ("My savings", Some("savings"), 24_000, false)
        );
        // The main account going low too: its own reminder, keyed as it always was
        put_item(
            &mut s,
            item("rent", ItemKind::Bill, d(2026, 11, 16), Repeat::Once, 2_000),
        );
        let found = upcoming(&s, None, &ctx(), 10, 10, None);
        let keys: Vec<&str> = found.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, ["low~2026-11-16", "low~savings~2026-11-14"]);
        assert_eq!((found[0].name.as_str(), &found[0].account_id), ("", &None));
    }
}
