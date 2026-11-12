//! A month looked back on: what the bills and income came to against what
//! was expected, by category (one on autopay that's come due, or one the
//! balance has taken in, as paid at what was expected, as the cash flow has
//! it); what TaskMint paid in; the bills paid late;
//! what went out besides the bills, by the balance's updates; and the six
//! months up to it, side by side.

use crate::docs::Snapshot;
use crate::forecast::contract::PayoutForecast;
use crate::model::{Cents, ItemKind, OccStatus};
use crate::occur::{occurrences, Occurrence};
use crate::project::{recorded_arrivals, settled_through, spending_between};
use crate::recur::days_in_month;
use crate::time::{in_calendar, Ctx};
use chrono::{Datelike, Duration, Months, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// How far back the client reads what was paid: a month before that may be
/// missing some of it.
pub const KEPT_DAYS: i64 = 400;

/// The months the report puts side by side, its own the last.
pub const TREND_MONTHS: u32 = 6;

/// What a month's bills (or income) came to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReportTotals {
    /// Those due in the month, skipped ones aside.
    pub count: u32,
    /// What they were expected to come to.
    pub expected_cents: Cents,
    /// What the ones paid (or received) came to.
    pub done_cents: Cents,
    /// What the ones still open are expected at.
    pub open_cents: Cents,
    pub skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CategoryReport {
    /// None: those without one.
    pub category: Option<String>,
    pub kind: ItemKind,
    pub totals: ReportTotals,
}

/// What went out besides the bills over the month's days the balance's
/// updates cover (each update's share of its days).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct OutsideSpending {
    pub cents: Cents,
    pub days: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct MonthTotals {
    /// YYYY-MM
    pub month: String,
    /// What the bills paid came to, and the income received.
    pub bills_cents: Cents,
    pub income_cents: Cents,
    /// TaskMint's withdrawals that reached the bank.
    pub withdrawals_cents: Cents,
}

/// A bill paid after it was due.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PaidLate {
    pub item_id: String,
    pub name: String,
    pub due: NaiveDate,
    pub paid_on: NaiveDate,
    pub cents: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReportView {
    /// YYYY-MM
    pub month: String,
    pub today: NaiveDate,
    /// Before what BudgetMint reads of what was paid: some may be missing.
    pub partial: bool,
    /// The month's still to come, in part or whole.
    pub unfinished: bool,
    pub bills: ReportTotals,
    pub income: ReportTotals,
    /// TaskMint's withdrawals that reached the bank in the month (as far
    /// back as TaskMint lists them: three months).
    pub withdrawals_cents: Cents,
    /// Income received and TaskMint's, less the bills paid.
    pub net_cents: Cents,
    /// By kind, then category (none first).
    pub categories: Vec<CategoryReport>,
    /// Bills paid after they were due, soonest due first.
    pub paid_late: Vec<PaidLate>,
    pub outside: Option<OutsideSpending>,
    /// The everyday spending the forecast assumes for the month's days so
    /// far: what "left over" is before.
    pub spending_assumed_cents: Cents,
    /// The months up to this one, oldest first.
    pub months: Vec<MonthTotals>,
}

/// The first and last days of `month` (YYYY-MM), when it's one in the calendar.
pub(crate) fn month_days(month: &str) -> Option<(NaiveDate, NaiveDate)> {
    let first = NaiveDate::parse_from_str(&format!("{}-01", month), "%Y-%m-%d")
        .ok()
        .filter(|first| in_calendar(*first))?;
    let last = first + Duration::days(i64::from(days_in_month(first.year(), first.month())) - 1);
    Some((first, last))
}

/// What counts as paid: one marked so, at what it came to; one on autopay
/// that's come due, or one the balance has taken in (due by its day), at
/// what was expected. None: still open.
fn paid_cents(occurrence: &Occurrence<'_>, today: NaiveDate, settled: NaiveDate) -> Option<Cents> {
    match occurrence.status {
        OccStatus::Done { amount_cents, .. } => Some(amount_cents),
        _ if (occurrence.item.autopay && occurrence.due <= today) || occurrence.due <= settled => {
            Some(occurrence.expected_cents)
        }
        _ => None,
    }
}

fn add(
    totals: &mut ReportTotals,
    occurrence: &Occurrence<'_>,
    today: NaiveDate,
    settled: NaiveDate,
) {
    if occurrence.status == OccStatus::Skipped {
        totals.skipped += 1;
        return;
    }
    totals.count += 1;
    totals.expected_cents += occurrence.expected_cents;
    match paid_cents(occurrence, today, settled) {
        Some(cents) => totals.done_cents += cents,
        None => totals.open_cents += occurrence.expected_cents,
    }
}

/// TaskMint's recorded withdrawals reaching the bank in [first, last].
fn withdrawals_in(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    ctx: &Ctx,
    first: NaiveDate,
    last: NaiveDate,
) -> Cents {
    let settings = snapshot.settings();
    taskmint
        .filter(|_| settings.taskmint.use_forecast)
        .map(|forecast| recorded_arrivals(forecast, &settings.taskmint, ctx))
        .unwrap_or_default()
        .into_iter()
        .filter(|(date, _)| *date >= first && *date <= last)
        .map(|(_, cents)| cents)
        .sum()
}

/// The bills and income due in [first, last] (open ones of archived items
/// aside: they stopped).
fn totals(
    snapshot: &Snapshot,
    first: NaiveDate,
    last: NaiveDate,
    today: NaiveDate,
) -> (ReportTotals, ReportTotals) {
    let settled = settled_through(&snapshot.settings(), today);
    let (mut bills, mut income) = (ReportTotals::default(), ReportTotals::default());
    for occurrence in occurrences(snapshot, first, last, true)
        .iter()
        .filter(|o| !o.item.archived || o.status != OccStatus::Open)
    {
        let totals = match occurrence.item.kind {
            ItemKind::Bill => &mut bills,
            ItemKind::Income => &mut income,
        };
        add(totals, occurrence, today, settled);
    }
    (bills, income)
}

/// The report for `month` (YYYY-MM): None when it isn't one.
pub fn report(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    month: &str,
    ctx: &Ctx,
) -> Option<ReportView> {
    let (first, last) = month_days(month)?;
    let today = ctx.today();
    let settled = settled_through(&snapshot.settings(), today);
    let all = occurrences(snapshot, first, last, true);
    let counted: Vec<_> = all
        .iter()
        .filter(|o| !o.item.archived || o.status != OccStatus::Open)
        .collect();

    // A category is one whatever its letters' case ("Utilities", "utilities"), named as first spelled
    let mut by_category: BTreeMap<(ItemKind, Option<String>), (Option<String>, ReportTotals)> =
        BTreeMap::new();
    let mut paid_late = Vec::new();
    for occurrence in &counted {
        let category = occurrence.item.category.clone();
        let key = (
            occurrence.item.kind,
            category.as_ref().map(|name| name.to_lowercase()),
        );
        add(
            &mut by_category
                .entry(key)
                .or_insert((category, ReportTotals::default()))
                .1,
            occurrence,
            today,
            settled,
        );
        if let OccStatus::Done { on, amount_cents } = occurrence.status {
            if occurrence.item.kind == ItemKind::Bill && on > occurrence.due {
                paid_late.push(PaidLate {
                    item_id: occurrence.item.id.clone(),
                    name: occurrence.item.name.clone(),
                    due: occurrence.due,
                    paid_on: on,
                    cents: amount_cents,
                });
            }
        }
    }
    let (bills, income) = totals(snapshot, first, last, today);
    let withdrawals_cents = withdrawals_in(snapshot, taskmint, ctx, first, last);

    // Each update's share of the month's days it covers
    let mut outside = OutsideSpending { cents: 0, days: 0 };
    for check in snapshot
        .settings()
        .checks
        .iter()
        .filter(|check| check.days() > 0)
    {
        let from = (check.from + Duration::days(1)).max(first);
        let to = check.to.min(last);
        let days = (to - from).num_days() + 1;
        if days > 0 {
            outside.days += days as u32;
            outside.cents += check.spent_outside_cents() * days / check.days();
        }
    }

    let mut months = Vec::new();
    for back in (0..TREND_MONTHS).rev() {
        let start = first
            .checked_sub_months(Months::new(back))
            .filter(|start| in_calendar(*start));
        let Some((from, to)) =
            start.and_then(|start| month_days(&start.format("%Y-%m").to_string()))
        else {
            continue;
        };
        let (bills, income) = totals(snapshot, from, to, today);
        months.push(MonthTotals {
            month: from.format("%Y-%m").to_string(),
            bills_cents: bills.done_cents,
            income_cents: income.done_cents,
            withdrawals_cents: withdrawals_in(snapshot, taskmint, ctx, from, to),
        });
    }

    let mut categories: Vec<CategoryReport> = by_category
        .into_iter()
        .map(|((kind, _), (category, totals))| CategoryReport {
            category,
            kind,
            totals,
        })
        .collect();
    // Bills first, then income
    categories.sort_by_key(|c| (c.kind != ItemKind::Bill, c.category.clone()));
    Some(ReportView {
        month: first.format("%Y-%m").to_string(),
        today,
        partial: first < today - Duration::days(KEPT_DAYS),
        unfinished: last >= today,
        net_cents: income.done_cents + withdrawals_cents - bills.done_cents,
        spending_assumed_cents: spending_between(
            snapshot.settings().spending_weekly_cents,
            first - Duration::days(1),
            last.min(today),
        ),
        bills,
        income,
        withdrawals_cents,
        categories,
        paid_late,
        outside: (outside.days > 0).then_some(outside),
        months,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::forecast::contract::{Amount, Taken};
    use crate::model::{Balance, BalanceCheck, Repeat, Settings};
    use crate::occur::tests::{d, item, over, put_item, put_over};
    use crate::time::DAY_MS;

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 100_000,
                as_of: d(2026, 11, 1),
            }),
            checks: vec![BalanceCheck {
                // From the end of Sep 21 to Oct 11: 20 days; $200 besides the bills
                from: d(2026, 9, 21),
                to: d(2026, 10, 11),
                expected_cents: 50_000,
                actual_cents: 35_000,
                assumed_spending_cents: 5_000,
            }],
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        let mut rent = item(
            "rent",
            ItemKind::Bill,
            d(2026, 6, 1),
            Repeat::Months { n: 1, day: 1 },
            100_000,
        );
        rent.category = Some("Home".into());
        put_item(&mut s, rent);
        let mut power = item(
            "power",
            ItemKind::Bill,
            d(2026, 6, 20),
            Repeat::Months { n: 1, day: 20 },
            8_000,
        );
        // The same category, spelled another way (before core kept one spelling)
        power.category = Some("home".into());
        put_item(&mut s, power);
        put_item(
            &mut s,
            item(
                "gym",
                ItemKind::Bill,
                d(2026, 6, 5),
                Repeat::Months { n: 1, day: 5 },
                3_000,
            ),
        );
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 6, 15),
                Repeat::Months { n: 1, day: 15 },
                250_000,
            ),
        );
        let mut old = item("old", ItemKind::Bill, d(2026, 10, 9), Repeat::Once, 999);
        old.archived = true;
        put_item(&mut s, old);
        // October: rent paid late on the 3rd, power paid at $91.50, the gym skipped, pay received
        let paid = |on, cents| OccStatus::Done {
            on,
            amount_cents: cents,
        };
        put_over(
            &mut s,
            over("rent", d(2026, 10, 1), paid(d(2026, 10, 3), 100_000)),
        );
        put_over(
            &mut s,
            over("power", d(2026, 10, 20), paid(d(2026, 10, 20), 9_150)),
        );
        put_over(&mut s, over("gym", d(2026, 10, 5), OccStatus::Skipped));
        put_over(
            &mut s,
            over("pay", d(2026, 10, 15), paid(d(2026, 10, 15), 250_000)),
        );
        put_over(
            &mut s,
            over("rent", d(2026, 9, 1), paid(d(2026, 9, 1), 100_000)),
        );
        s
    }

    fn forecast() -> PayoutForecast {
        let now = ctx().now_ms();
        PayoutForecast {
            schema: 1,
            as_of_ms: now,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: Some(now),
            cutoff: None,
            // Oct 12 and Oct 30 (in the bank a day later), and Sep 2
            recent_withdrawals: vec![
                Taken {
                    taken_at_ms: now - 11 * DAY_MS,
                    amount_cents: 4_000,
                },
                Taken {
                    taken_at_ms: now - 29 * DAY_MS,
                    amount_cents: 6_000,
                },
                Taken {
                    taken_at_ms: now - 69 * DAY_MS,
                    amount_cents: 1_000,
                },
            ],
            next_allowed_at_ms: None,
            scheduled: None,
            carried: Amount::default(),
            carried_days: vec![],
            steps: vec![],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        }
    }

    #[test]
    fn says_what_everyday_spending_the_month_assumes_so_far() {
        let mut s = Snapshot::default();
        let settings = Settings {
            spending_weekly_cents: 7_000,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        // Ten days of November so far, all of October
        let spent = |month: &str| {
            report(&s, None, month, &ctx())
                .unwrap()
                .spending_assumed_cents
        };
        assert_eq!(spent("2026-11"), 10_000);
        assert_eq!(spent("2026-10"), 31_000);
    }

    #[test]
    fn looks_back_on_a_month() {
        let s = budget();
        let f = forecast();
        let october = report(&s, Some(&f), "2026-10", &ctx()).unwrap();
        assert_eq!(october.month, "2026-10");
        assert!(!october.partial && !october.unfinished);
        assert_eq!(
            october.bills,
            ReportTotals {
                count: 2,
                expected_cents: 108_000,
                done_cents: 109_150,
                open_cents: 0,
                skipped: 1,
            }
        );
        assert_eq!(october.income.done_cents, 250_000);
        assert_eq!(october.withdrawals_cents, 10_000);
        assert_eq!(october.net_cents, 250_000 + 10_000 - 109_150);
        let home = &october.categories[1];
        assert_eq!(
            (home.kind, home.category.as_deref()),
            (ItemKind::Bill, Some("Home"))
        );
        assert_eq!(home.totals.done_cents, 109_150);
        assert_eq!(october.categories[0].category, None);
        assert_eq!(october.categories[0].totals.skipped, 1);
        assert_eq!(october.categories[2].kind, ItemKind::Income);
        let late: Vec<&str> = october
            .paid_late
            .iter()
            .map(|o| o.item_id.as_str())
            .collect();
        assert_eq!(late, vec!["rent"]);
        // 11 of the check's 20 days (Sep 22 to Oct 11) are October's: that share of its $200
        assert_eq!(
            october.outside,
            Some(OutsideSpending {
                cents: 11_000,
                days: 11
            })
        );
        // June to October, side by side
        let months: Vec<(&str, Cents)> = october
            .months
            .iter()
            .map(|m| (m.month.as_str(), m.bills_cents))
            .collect();
        // Before the balance's day, the open ones are in it: paid at what was expected
        assert_eq!(
            months,
            vec![
                ("2026-05", 0),
                ("2026-06", 111_000),
                ("2026-07", 111_000),
                ("2026-08", 111_000),
                ("2026-09", 111_000),
                ("2026-10", 109_150)
            ]
        );
        assert_eq!(october.months[4].withdrawals_cents, 1_000);
    }

    #[test]
    fn counts_autopay_come_due_as_paid() {
        let mut s = budget();
        let mut gym = item(
            "gym2",
            ItemKind::Bill,
            d(2026, 11, 5),
            Repeat::Months { n: 1, day: 5 },
            3_000,
        );
        gym.autopay = true;
        gym.category = Some("Health".into());
        put_item(&mut s, gym);
        let november = report(&s, None, "2026-11", &ctx()).unwrap();
        let health = november
            .categories
            .iter()
            .find(|c| c.category.as_deref() == Some("Health"))
            .unwrap();
        assert_eq!(
            (health.totals.done_cents, health.totals.open_cents),
            (3_000, 0)
        );
        // December's isn't due yet
        let december = report(&s, None, "2026-12", &ctx()).unwrap();
        assert_eq!(december.bills.done_cents, 0);
    }

    #[test]
    fn a_month_still_going_and_one_long_gone() {
        let s = budget();
        let november = report(&s, None, "2026-11", &ctx()).unwrap();
        assert!(november.unfinished);
        // Rent, due on the balance's day, is in it; the gym and power are still to pay
        assert_eq!(november.bills.open_cents, 11_000);
        assert_eq!(november.bills.done_cents, 100_000);
        assert_eq!(november.withdrawals_cents, 0);
        assert_eq!(november.outside, None);
        let long_ago = report(&s, None, "2025-09", &ctx()).unwrap();
        assert!(long_ago.partial);
        assert_eq!(long_ago.bills.count, 0);
        // The calendar's first month: the months before it aren't there
        assert_eq!(report(&s, None, "1900-03", &ctx()).unwrap().months.len(), 3);
        assert_eq!(report(&s, None, "1899-12", &ctx()), None);
        assert_eq!(report(&s, None, "nope", &ctx()), None);
    }
}
