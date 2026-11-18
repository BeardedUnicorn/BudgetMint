//! The charges a statement shows coming round (a subscription each month,
//! a bill each week) that are no bill here yet, and the income likewise:
//! found by who they're to and how evenly they're spaced, for the user to
//! add as bills or income. What the statements before kept counts with what
//! this one shows.

use crate::bank::{words, BankTransaction};
use crate::categorize::merchant_key;
use crate::docs::Snapshot;
use crate::model::{Cents, ItemKind, Leg, LineFlow, Repeat};
use crate::recur::days_in_month;
use chrono::{Datelike, Duration, Months, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// A charge (or income) that comes round, as the bill or income it could be.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RecurringFound {
    /// Which it is, among the ones found.
    pub key: String,
    pub kind: ItemKind,
    pub name: String,
    /// What it comes to: the latest, or the last three's average when it varies.
    pub amount_cents: Cents,
    pub varies: bool,
    pub repeat: Repeat,
    /// The next one's day: where its schedule would start.
    pub from: NaiveDate,
    pub category: Option<String>,
    /// How many times it was seen, and the last.
    pub count: u32,
    pub last_on: NaiveDate,
    /// The statement's lines that are it.
    pub transactions: Vec<u32>,
}

struct Charge {
    on: NaiveDate,
    /// Above zero, whichever way it went.
    cents: Cents,
    index: Option<u32>,
    name: String,
    category: Option<String>,
}

/// The day of the month `day` after `after` (a shorter month's last day for one it lacks).
fn next_on(day: u32, after: NaiveDate) -> NaiveDate {
    let of = |first: NaiveDate| {
        first + Duration::days(i64::from(day.min(days_in_month(first.year(), first.month()))) - 1)
    };
    let first = after - Duration::days(i64::from(after.day()) - 1);
    Some(of(first))
        .filter(|this| *this > after)
        .unwrap_or_else(|| of(first + Months::new(1)))
}

/// The least and the most of `charges`.
fn spread(charges: &[&Charge]) -> (Cents, Cents) {
    charges.iter().fold((Cents::MAX, 0), |(low, high), charge| {
        (low.min(charge.cents), high.max(charge.cents))
    })
}

/// How `charges` (one or more, by day) come round, when they do: the
/// schedule, the next one's day, and how long after the last one it still
/// counts as going.
fn steady(charges: &[&Charge]) -> Option<(Repeat, NaiveDate, i64)> {
    let count = charges.len() as i64;
    let last = charges[charges.len() - 1].on;
    let gaps: Vec<i64> = charges
        .windows(2)
        .map(|pair| (pair[1].on - pair[0].on).num_days())
        .collect();
    let all = |low: i64, high: i64| gaps.iter().all(|gap| (low..=high).contains(gap));
    let (low, high) = spread(charges);
    // The same amount each time (within 5%) is surer than one that varies
    let fixed = (high - low) * 20 <= high;
    let enough = if fixed {
        count >= 3
    } else {
        count >= 4 && high <= low * 2
    };
    let span: i64 = gaps.iter().sum();
    let monthly = enough && all(19, 45) && (26 * (count - 1)..=35 * (count - 1)).contains(&span);
    if count < 2 {
        None
    } else if enough && all(6, 8) {
        Some((Repeat::Weeks { n: 1 }, last + Duration::days(7), 21))
    } else if enough && all(13, 15) {
        Some((Repeat::Weeks { n: 2 }, last + Duration::days(14), 35))
    } else if monthly || (count == 2 && low == high && all(28, 32)) {
        let mut days: Vec<u32> = charges.iter().map(|charge| charge.on.day()).collect();
        days.sort_unstable();
        let day = days[days.len() / 2];
        Some((
            Repeat::Months {
                n: 1,
                day: day as u8,
            },
            next_on(day, last),
            // One paid from elsewhere a month isn't one that stopped
            62,
        ))
    } else if fixed && all(358, 372) {
        Some((Repeat::Years { n: 1 }, last + Months::new(12), 400))
    } else {
        None
    }
}

/// The charges and income among `transactions` (the statement's lines, less
/// the `taken` ones that paid a bill here) and what was kept before that
/// come round, and that no bill or income of this account is named for.
pub fn found(
    snapshot: &Snapshot,
    account_id: &str,
    transactions: &[BankTransaction],
    taken: &[u32],
) -> Vec<RecurringFound> {
    let Some(latest) = transactions.iter().map(|line| line.date).max() else {
        return Vec::new();
    };
    let ids: BTreeSet<&str> = transactions.iter().map(|line| line.id.as_str()).collect();
    let mut groups: BTreeMap<(String, bool), Vec<Charge>> = BTreeMap::new();
    let mut add = |name: &str, out: bool, charge: Charge| {
        groups
            .entry((merchant_key(name), out))
            .or_default()
            .push(charge)
    };
    for kept in snapshot
        .transactions
        .values()
        .filter(|month| month.account_id == account_id)
        .flat_map(|month| &month.transactions)
        .filter(|kept| {
            matches!(kept.flow, LineFlow::Spend | LineFlow::Income)
                && kept.item_id.is_none()
                && !ids.contains(kept.id.as_str())
        })
    {
        add(
            &kept.name,
            kept.amount_cents < 0,
            Charge {
                on: kept.on,
                cents: kept.amount_cents.abs(),
                index: None,
                name: kept.name.clone(),
                category: kept.category.clone(),
            },
        );
    }
    for line in transactions.iter().filter(|line| {
        matches!(line.flow, LineFlow::Spend | LineFlow::Income)
            && line.amount_cents != 0
            && !taken.contains(&line.index)
    }) {
        add(
            &line.merchant,
            line.amount_cents < 0,
            Charge {
                on: line.date,
                cents: line.amount_cents.abs(),
                index: Some(line.index),
                name: line.merchant.clone(),
                category: line.category.clone(),
            },
        );
    }
    let mut all = Vec::new();
    for ((key, out), mut charges) in groups {
        let way = if out { Leg::Out } else { Leg::In };
        // A bill or income here already named for it: nothing to add
        let here = snapshot.items.values().any(|item| {
            !item.archived
                && item.leg(account_id) == Some(way)
                && words(&item.name)
                    .iter()
                    .any(|word| key.contains(word.as_str()))
        });
        if key.is_empty() || here {
            continue;
        }
        charges.sort_by_key(|charge| charge.on);
        let whole: Vec<&Charge> = charges.iter().collect();
        // All of them, evenly; else the ones of one amount that are (a
        // subscription among a merchant's other charges)
        let mut sets: Vec<(String, Vec<&Charge>)> = vec![(key.clone(), whole)];
        if steady(&sets[0].1).is_none() {
            let mut by_amount: BTreeMap<Cents, Vec<&Charge>> = BTreeMap::new();
            for charge in &charges {
                by_amount.entry(charge.cents).or_default().push(charge);
            }
            sets = by_amount
                .into_iter()
                .map(|(cents, set)| (format!("{}@{}", key, cents), set))
                .collect();
        }
        for (key, set) in sets {
            let Some((repeat, from, going_days)) = steady(&set) else {
                continue;
            };
            let newest = set[set.len() - 1];
            if (latest - newest.on).num_days() > going_days {
                continue;
            }
            let (low, high) = spread(&set);
            let varies = (high - low) * 20 > high;
            let recent = &set[set.len().saturating_sub(3)..];
            all.push(RecurringFound {
                key,
                kind: if out {
                    ItemKind::Bill
                } else {
                    ItemKind::Income
                },
                name: newest.name.clone(),
                amount_cents: if varies {
                    recent.iter().map(|charge| charge.cents).sum::<Cents>() / recent.len() as Cents
                } else {
                    newest.cents
                },
                varies,
                repeat,
                from,
                category: set.iter().rev().find_map(|charge| charge.category.clone()),
                count: set.len() as u32,
                last_on: newest.on,
                transactions: set.iter().filter_map(|charge| charge.index).collect(),
            });
        }
    }
    all.sort_by(|a, b| (&a.name, &a.key).cmp(&(&b.name, &b.key)));
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bank::line;
    use crate::docs::DocKey;
    use crate::model::{MonthTransactions, Transaction};
    use crate::occur::tests::{d, in_account, item, put_item};

    /// The statement's lines: (day, cents, who).
    fn lines(of: &[(NaiveDate, Cents, &str)]) -> Vec<BankTransaction> {
        of.iter()
            .enumerate()
            .map(|(at, (on, cents, who))| BankTransaction {
                index: at as u32,
                id: format!("t{}", at),
                merchant: who.to_string(),
                ..line("", *on, *cents, who.to_string(), None)
            })
            .collect()
    }

    fn names(found: &[RecurringFound]) -> Vec<&str> {
        found.iter().map(|one| one.name.as_str()).collect()
    }

    #[test]
    fn finds_what_comes_round_each_week_month_and_year() {
        let s = Snapshot::default();
        let mut statement = lines(&[
            // The same each month
            (d(2026, 8, 28), -1_999, "Netflix"),
            (d(2026, 9, 28), -1_999, "Netflix"),
            (d(2026, 10, 28), -1_999, "Netflix"),
            // Each week
            (d(2026, 10, 1), -3_000, "Gym"),
            (d(2026, 10, 8), -3_000, "Gym"),
            (d(2026, 10, 15), -3_000, "Gym"),
            // Every two weeks, coming in
            (d(2026, 9, 18), 150_000, "Acme Payroll"),
            (d(2026, 10, 2), 150_000, "Acme Payroll"),
            (d(2026, 10, 16), 150_000, "Acme Payroll"),
            // Each month, for an amount that varies
            (d(2026, 7, 13), -9_000, "City Power"),
            (d(2026, 8, 12), -12_000, "City Power"),
            (d(2026, 9, 14), -10_000, "City Power"),
            (d(2026, 10, 13), -11_000, "City Power"),
            // Each year
            (d(2025, 10, 10), -9_900, "Domains"),
            (d(2026, 10, 10), -9_900, "Domains"),
            // A subscription among a merchant's other charges
            (d(2026, 9, 23), -999, "DoorDash"),
            (d(2026, 10, 2), -2_859, "DoorDash"),
            (d(2026, 10, 23), -999, "DoorDash"),
            // Paid a few days off its day, and once into the next month
            (d(2026, 7, 27), -158_005, "Mortgage"),
            (d(2026, 9, 2), -158_005, "Mortgage"),
            (d(2026, 10, 2), -158_005, "Mortgage"),
            // Before its usual day, the last time
            (d(2026, 8, 20), -5_000, "Phone"),
            (d(2026, 9, 20), -5_000, "Phone"),
            (d(2026, 10, 13), -5_000, "Phone"),
            // On the last day of the month
            (d(2026, 8, 31), -700, "Cloud"),
            (d(2026, 9, 30), -700, "Cloud"),
            // Shopping, whenever
            (d(2026, 10, 3), -4_500, "Grocer"),
            (d(2026, 10, 5), -6_100, "Grocer"),
            (d(2026, 10, 20), -2_000, "Grocer"),
            // Varying, and seen only three times; or far too unevenly
            (d(2026, 8, 5), -2_000, "Cafe"),
            (d(2026, 9, 5), -3_000, "Cafe"),
            (d(2026, 10, 5), -2_500, "Cafe"),
            (d(2026, 7, 6), -1_000, "Vet"),
            (d(2026, 8, 6), -5_000, "Vet"),
            (d(2026, 9, 6), -1_200, "Vet"),
            (d(2026, 10, 6), -1_100, "Vet"),
            // Stopped in the spring
            (d(2026, 3, 9), -800, "Old Club"),
            (d(2026, 4, 9), -800, "Old Club"),
            (d(2026, 5, 9), -800, "Old Club"),
            // Nothing to go by
            (d(2026, 8, 9), -800, ""),
            (d(2026, 9, 9), -800, ""),
            (d(2026, 10, 9), -800, ""),
            (d(2026, 8, 11), 0, "Nothing"),
            (d(2026, 9, 11), 0, "Nothing"),
            (d(2026, 10, 11), 0, "Nothing"),
        ]);
        // Money moved isn't a charge, however evenly; nor what paid a bill here
        for (on, who) in [
            (d(2026, 8, 1), "Add Funds"),
            (d(2026, 9, 1), "Add Funds"),
            (d(2026, 10, 1), "Add Funds"),
        ] {
            let index = statement.len() as u32;
            statement.push(BankTransaction {
                index,
                id: format!("t{}", index),
                merchant: who.into(),
                ..line("", on, 5_000, who.into(), Some(LineFlow::Moved))
            });
        }
        let taken_from = statement.len() as u32;
        statement.extend(
            lines(&[
                (d(2026, 8, 3), -4_000, "Water"),
                (d(2026, 9, 3), -4_000, "Water"),
                (d(2026, 10, 3), -4_000, "Water"),
            ])
            .into_iter()
            .enumerate()
            .map(|(at, line)| BankTransaction {
                index: taken_from + at as u32,
                id: format!("w{}", at),
                ..line
            }),
        );
        let taken = [taken_from, taken_from + 1, taken_from + 2];
        let found = found(&s, "main", &statement, &taken);
        assert_eq!(
            names(&found),
            vec![
                "Acme Payroll",
                "City Power",
                "Cloud",
                "Domains",
                "DoorDash",
                "Gym",
                "Mortgage",
                "Netflix",
                "Phone"
            ]
        );
        let by = |name: &str| found.iter().find(|one| one.name == name).unwrap();
        let netflix = by("Netflix");
        assert_eq!(
            (
                netflix.kind,
                netflix.amount_cents,
                netflix.varies,
                netflix.count
            ),
            (ItemKind::Bill, 1_999, false, 3)
        );
        assert_eq!(netflix.repeat, Repeat::Months { n: 1, day: 28 });
        assert_eq!(
            (netflix.from, netflix.last_on),
            (d(2026, 11, 28), d(2026, 10, 28))
        );
        assert_eq!(
            (netflix.key.as_str(), &netflix.transactions),
            ("netflix", &vec![0, 1, 2])
        );
        assert_eq!(
            (by("Gym").repeat, by("Gym").from),
            (Repeat::Weeks { n: 1 }, d(2026, 10, 22))
        );
        let pay = by("Acme Payroll");
        assert_eq!(
            (pay.kind, pay.repeat, pay.from),
            (ItemKind::Income, Repeat::Weeks { n: 2 }, d(2026, 10, 30))
        );
        let power = by("City Power");
        assert_eq!((power.varies, power.amount_cents), (true, 11_000));
        assert_eq!(power.repeat, Repeat::Months { n: 1, day: 13 });
        assert_eq!(
            (by("Domains").repeat, by("Domains").from),
            (Repeat::Years { n: 1 }, d(2027, 10, 10))
        );
        let dash = by("DoorDash");
        assert_eq!(
            (dash.key.as_str(), dash.amount_cents, dash.count),
            ("doordash@999", 999, 2)
        );
        assert_eq!(
            (by("Mortgage").repeat, by("Mortgage").from),
            (Repeat::Months { n: 1, day: 2 }, d(2026, 11, 2))
        );
        assert_eq!(
            (by("Phone").repeat, by("Phone").from),
            (Repeat::Months { n: 1, day: 20 }, d(2026, 10, 20))
        );
        assert_eq!(
            (by("Cloud").repeat, by("Cloud").from),
            (Repeat::Months { n: 1, day: 31 }, d(2026, 10, 31))
        );
        // Nothing in the statement: nothing found
        assert!(super::found(&s, "main", &[], &[]).is_empty());
    }

    #[test]
    fn leaves_out_what_is_a_bill_here_and_counts_what_was_kept_before() {
        let mut s = Snapshot::default();
        let statement = lines(&[
            (d(2026, 10, 28), -1_999, "Netflix"),
            (d(2026, 10, 12), -1_299, "Spotify"),
        ]);
        let kept =
            |id: &str, on, cents: Cents, name: &str, flow, item_id: Option<&str>| Transaction {
                id: id.into(),
                on,
                amount_cents: cents,
                name: name.into(),
                category: Some("Subscriptions".into()),
                flow,
                item_id: item_id.map(str::to_string),
            };
        let month =
            |account: &str, month: &str, transactions: Vec<Transaction>| MonthTransactions {
                account_id: account.into(),
                month: month.into(),
                transactions,
            };
        let put = |s: &mut Snapshot, kept: MonthTransactions| {
            s.write(
                DocKey::Txns {
                    account_id: kept.account_id.clone(),
                    month: kept.month.clone(),
                },
                Some(&kept),
            );
        };
        put(
            &mut s,
            month(
                "main",
                "2026-09",
                vec![
                    kept(
                        "n9",
                        d(2026, 9, 28),
                        -1_999,
                        "Netflix",
                        LineFlow::Spend,
                        None,
                    ),
                    // The statement's own line, kept before: counted once
                    kept(
                        "t0",
                        d(2026, 9, 29),
                        -1_999,
                        "Netflix",
                        LineFlow::Spend,
                        None,
                    ),
                    // It paid a bill here, or wasn't spending: not counted
                    kept(
                        "s9",
                        d(2026, 9, 12),
                        -1_299,
                        "Spotify",
                        LineFlow::Spend,
                        Some("music"),
                    ),
                    kept(
                        "m9",
                        d(2026, 9, 12),
                        -1_299,
                        "Spotify",
                        LineFlow::Moved,
                        None,
                    ),
                ],
            ),
        );
        put(
            &mut s,
            month(
                "main",
                "2026-08",
                vec![kept(
                    "n8",
                    d(2026, 8, 28),
                    -1_999,
                    "Netflix",
                    LineFlow::Spend,
                    None,
                )],
            ),
        );
        // Another account's
        put(
            &mut s,
            month(
                "card",
                "2026-08",
                vec![
                    kept(
                        "c8",
                        d(2026, 8, 12),
                        -1_299,
                        "Spotify",
                        LineFlow::Spend,
                        None,
                    ),
                    kept(
                        "c9",
                        d(2026, 9, 12),
                        -1_299,
                        "Spotify",
                        LineFlow::Spend,
                        None,
                    ),
                ],
            ),
        );
        let all = found(&s, "main", &statement, &[]);
        assert_eq!(names(&all), vec!["Netflix"]);
        assert_eq!((all[0].count, &all[0].transactions), (3, &vec![0]));
        assert_eq!(all[0].category.as_deref(), Some("Subscriptions"));
        // Income named for it, an archived bill, or one in another account: still found
        put_item(
            &mut s,
            item("netflix", ItemKind::Income, d(2026, 1, 1), Repeat::Once, 1),
        );
        let mut archived = item("old", ItemKind::Bill, d(2026, 1, 1), Repeat::Once, 1);
        archived.name = "Netflix".into();
        archived.archived = true;
        put_item(&mut s, archived);
        let mut elsewhere = in_account(
            item("there", ItemKind::Bill, d(2026, 1, 1), Repeat::Once, 1),
            "card",
        );
        elsewhere.name = "Netflix".into();
        put_item(&mut s, elsewhere);
        assert_eq!(names(&found(&s, "main", &statement, &[])), vec!["Netflix"]);
        // A bill here named for it: nothing to add
        let mut bill = item("tv", ItemKind::Bill, d(2026, 1, 1), Repeat::Once, 1);
        bill.name = "Netflix (TV)".into();
        put_item(&mut s, bill);
        assert!(found(&s, "main", &statement, &[]).is_empty());
    }
}
