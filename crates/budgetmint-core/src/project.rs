//! The cash flow: from the balance the user set (what the account held at
//! the end of its as-of day), every day's money in and out, and the balance
//! it leaves.
//!
//! What counts, and on which day:
//! - Skipped: nothing.
//! - Paid (or received) on a day after the balance's: that day. On or before
//!   it, the balance has it already.
//! - On autopay, due after the balance's day: its due day.
//! - Still open and due after today: its due day.
//! - A bill still open, due after the balance's day and by today, is
//!   overdue: it's counted today (it's still owed). Income that late is only
//!   flagged: it can't be counted on.
//! - TaskMint's withdrawals: the ones it recorded on the day they reach the
//!   bank (after the arrival delay), and the projected ones too (forecast).
//! - Everyday spending (the settings' weekly amount): a day's share of it
//!   each day after the balance's.
//! - A transfer between two of the user's accounts: out of the one, into
//!   the other, on the days a bill and income would be. One still open and
//!   past due counts today on both sides: it's the user's money wherever it
//!   is, so the accounts together hold the same until it's marked moved.
//!
//! Without a balance set, the cash flow starts at zero from yesterday's end,
//! and bills open in the last month count as overdue.
//!
//! Each bank account has a cash flow of its own, from its own balance and
//! day ([`project_account`]): its bills and income, and its side of each
//! transfer. TaskMint's withdrawals and the everyday spending are the main
//! account's. [`project`] is the main account's; [`combined`] puts several
//! side by side as one.

use crate::docs::Snapshot;
use crate::forecast::contract::PayoutForecast;
use crate::forecast::curve::live_curve;
use crate::forecast::earned::{unwithdrawn, Unwithdrawn};
use crate::forecast::series::{project_withdrawals, ProjectedWithdrawal};
use crate::model::{Account, Balance, Cents, ItemKind, Leg, OccStatus, Settings, TaskMintPlan};
use crate::occur::{occurrences, paid_outside, MOVE_DAYS};
use crate::time::{Ctx, HOUR_MS};
use chrono::{Datelike, Duration, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

/// Without a balance, how far back an open bill still counts as overdue.
pub const OVERDUE_DAYS_WITHOUT_BALANCE: i64 = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum FlowKind {
    Bill,
    Income,
    /// A TaskMint withdrawal reaching the bank.
    Withdrawal,
    /// A day's share of the everyday spending.
    Spending,
    /// Money moved between two of the user's accounts: out of this one below zero, into it above.
    Transfer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum FlowStatus {
    /// Due then, still open.
    Scheduled,
    /// Due then, paid (or received) on its own.
    Autopay,
    /// A bill past due and still owed, or a transfer past due and still to make: counted today.
    Overdue,
    /// Marked paid (or received) then.
    Done,
    /// A withdrawal TaskMint recorded: on its way or arrived.
    Recorded,
    /// A withdrawal ahead.
    Projected,
    /// Everyday spending: assumed, not a bill.
    Assumed,
}

/// One amount of money moving on a day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    pub date: NaiveDate,
    pub kind: FlowKind,
    pub status: FlowStatus,
    /// Into the account (income, withdrawals) above zero, out below.
    pub amount_cents: Cents,
    /// The item, for bills and income.
    pub item_id: Option<String>,
    /// The item's name; empty for withdrawals.
    pub name: String,
    /// The schedule's date (which occurrence), for bills and income.
    pub scheduled: Option<NaiveDate>,
    /// Of a withdrawal: how much is estimated (tracked, not imported) or assumed.
    pub uncertain_cents: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DayRow {
    pub date: NaiveDate,
    pub opening_cents: Cents,
    pub in_cents: Cents,
    pub out_cents: Cents,
    pub closing_cents: Cents,
    /// Below zero by the end of the day.
    pub short: bool,
    /// Below the low mark (and not short).
    pub low: bool,
    pub flows: Vec<Flow>,
    /// Of the closing balance, what's set aside for bills (crate::goals).
    pub set_aside_cents: Cents,
}

/// An occurrence that's late: which one, and when it was due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Late {
    pub item_id: String,
    pub scheduled: NaiveDate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    pub today: NaiveDate,
    /// The last day the starting balance covers.
    pub base: NaiveDate,
    pub has_balance: bool,
    pub start_cents: Cents,
    /// From the day after `base` (today, at the latest) to the end.
    pub days: Vec<DayRow>,
    /// TaskMint's withdrawals ahead, made by the end.
    pub withdrawals: Vec<ProjectedWithdrawal>,
    /// What each work day earned in TaskMint that no withdrawal has taken yet.
    pub unwithdrawn: Vec<Unwithdrawn>,
    pub overdue: Vec<Late>,
    pub late_income: Vec<Late>,
}

impl Projection {
    /// The day's row, when the projection covers it.
    pub fn day(&self, date: NaiveDate) -> Option<&DayRow> {
        // It always covers today, so it has a first day
        let index = usize::try_from((date - self.days[0].date).num_days()).ok()?;
        self.days.get(index)
    }

    /// Today's row (always there).
    pub fn today_row(&self) -> &DayRow {
        self.day(self.today)
            .expect("the projection always covers today")
    }

    /// The rows from today on.
    pub fn ahead(&self) -> &[DayRow] {
        let index = self
            .days
            .iter()
            .position(|day| day.date == self.today)
            .unwrap_or(0);
        &self.days[index..]
    }
}

/// The last day whose occurrences, open or not, the starting balance has
/// settled: the balance's day, or without one, a month back (older open
/// bills are taken as paid).
pub fn settled_through(balance: Option<Balance>, today: NaiveDate) -> NaiveDate {
    balance.filter(|balance| balance.as_of <= today).map_or(
        today - Duration::days(OVERDUE_DAYS_WITHOUT_BALANCE),
        |balance| balance.as_of,
    )
}

/// The last day whose open occurrences, not on autopay, the balance is taken
/// to have settled: the day before its own. One due on the balance's day and
/// never marked may have been still to pay when the balance was read, so it
/// stays owed until it's marked (and says then whether the balance had it:
/// plan::moved_balance) or the next balance asks about it.
pub fn open_settled_through(balance: Option<Balance>, today: NaiveDate) -> NaiveDate {
    balance
        .filter(|balance| balance.as_of <= today)
        .map_or_else(
            || settled_through(balance, today),
            |balance| balance.as_of - Duration::days(1),
        )
}

/// TaskMint's recorded withdrawals and the day each reaches the bank (after
/// the arrival delay), newest first.
pub fn recorded_arrivals(
    forecast: &PayoutForecast,
    plan: &TaskMintPlan,
    ctx: &Ctx,
) -> Vec<(NaiveDate, Cents)> {
    let delay = i64::from(plan.arrival_delay_hours) * HOUR_MS;
    forecast
        .taken()
        .iter()
        .map(|taken| {
            let date = ctx.day_of(taken.taken_at_ms.saturating_add(delay));
            (date, taken.amount_cents)
        })
        .collect()
}

/// The main account's cash flow up to `end` (today at the earliest): the
/// whole budget's, while it has only that account.
pub fn project(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    ctx: &Ctx,
    end: NaiveDate,
) -> Projection {
    project_account(snapshot, &snapshot.main_account(), taskmint, ctx, end)
}

/// `account`'s cash flow up to `end` (today at the earliest), from its own
/// balance and day.
pub fn project_account(
    snapshot: &Snapshot,
    account: &Account,
    taskmint: Option<&PayoutForecast>,
    ctx: &Ctx,
    end: NaiveDate,
) -> Projection {
    let settings: Settings = snapshot.settings();
    let today = ctx.today();
    let end = end.max(today);
    let balance = account.balance.filter(|balance| balance.as_of <= today);
    let base = balance.map_or(today - Duration::days(1), |balance| balance.as_of);
    let overdue_after = open_settled_through(account.balance, today);

    let mut flows: Vec<Flow> = Vec::new();
    let mut overdue = Vec::new();
    let mut late_income = Vec::new();
    let earliest = overdue_after.min(base) - Duration::days(MOVE_DAYS);
    // With the ones paid far from their due date: the money still moved
    let paid_far = paid_outside(snapshot, earliest, end);
    for occurrence in occurrences(snapshot, earliest, end, true)
        .into_iter()
        .chain(paid_far)
    {
        let item = occurrence.item;
        // An archived item has stopped, but what was paid on it was paid
        if item.archived && !matches!(occurrence.status, OccStatus::Done { .. }) {
            continue;
        }
        // This account's side of it: what's all in other accounts isn't its money
        let Some(leg) = item.leg(&account.id) else {
            continue;
        };
        let kind = match item.kind {
            ItemKind::Bill => FlowKind::Bill,
            ItemKind::Income => FlowKind::Income,
            ItemKind::Transfer => FlowKind::Transfer,
        };
        let flow = |date, status, cents: Cents| Flow {
            date,
            kind,
            status,
            amount_cents: leg.sign() * cents,
            item_id: Some(item.id.clone()),
            name: item.name.clone(),
            scheduled: Some(occurrence.scheduled),
            uncertain_cents: 0,
        };
        let due = occurrence.due;
        match occurrence.status {
            OccStatus::Skipped => {}
            OccStatus::Done { on, amount_cents } => {
                if on > base && on <= end {
                    flows.push(flow(on, FlowStatus::Done, amount_cents));
                }
            }
            OccStatus::Open if item.autopay => {
                if due > base {
                    flows.push(flow(due, FlowStatus::Autopay, occurrence.expected_cents));
                }
            }
            OccStatus::Open if due > today => {
                flows.push(flow(due, FlowStatus::Scheduled, occurrence.expected_cents));
            }
            OccStatus::Open if due > overdue_after => {
                let late = Late {
                    item_id: item.id.clone(),
                    scheduled: occurrence.scheduled,
                };
                // Still owed (a bill), or still to move (a transfer, into this account or out
                // of it); income not in yet can't be counted on
                if leg == Leg::Out || item.kind == ItemKind::Transfer {
                    flows.push(flow(today, FlowStatus::Overdue, occurrence.expected_cents));
                    overdue.push(late);
                } else {
                    late_income.push(late);
                }
            }
            OccStatus::Open => {}
        }
    }

    let mut withdrawals = Vec::new();
    let mut earned = Vec::new();
    // TaskMint pays into the main account, and the everyday spending comes out of it
    let main = account.is_main();
    if let Some(forecast) = taskmint.filter(|_| settings.taskmint.use_forecast && main) {
        let plan = &settings.taskmint;
        let delay = i64::from(plan.arrival_delay_hours) * HOUR_MS;
        for (date, cents) in recorded_arrivals(forecast, plan, ctx) {
            if date > base && date <= end {
                flows.push(withdrawal_flow(date, FlowStatus::Recorded, cents, 0));
            }
        }
        // To the end of `end`, however long that day is (clock changes)
        let until = ctx.at(end + Duration::days(1), NaiveTime::MIN) - 1 - delay;
        let curve = live_curve(forecast, ctx, plan, until);
        withdrawals = project_withdrawals(forecast, &curve, ctx, plan, until);
        earned = unwithdrawn(&curve, &withdrawals);
        for projected in &withdrawals {
            let uncertain = projected.money.estimated_cents + projected.money.assumed_cents;
            flows.push(withdrawal_flow(
                projected.arrives_on,
                FlowStatus::Projected,
                projected.total_cents,
                uncertain,
            ));
        }
    }
    let weekly = if main {
        settings.spending_weekly_cents.max(0)
    } else {
        0
    };
    let mut date = base + Duration::days(1);
    while weekly > 0 && date <= end {
        flows.push(Flow {
            date,
            kind: FlowKind::Spending,
            status: FlowStatus::Assumed,
            amount_cents: -day_spending(weekly, date),
            item_id: None,
            name: String::new(),
            scheduled: None,
            uncertain_cents: 0,
        });
        date += Duration::days(1);
    }
    flows.sort_by_key(|flow| flow.date);

    let first = (base + Duration::days(1)).min(today);
    // What's set aside for a bill is in the account the bill is paid from
    let savings = crate::goals::savings(snapshot, ctx, first, end, Some(&account.id));
    let start_cents = balance.map_or(0, |balance| balance.cents);
    let mut running = start_cents;
    let mut days = Vec::new();
    let mut pending = flows.into_iter().peekable();
    let mut date = first;
    while date <= end {
        let opening = running;
        let mut today_flows = Vec::new();
        while let Some(flow) = pending.next_if(|flow| flow.date <= date) {
            today_flows.push(flow);
        }
        let in_cents: Cents = today_flows.iter().map(|f| f.amount_cents.max(0)).sum();
        let out_cents: Cents = today_flows.iter().map(|f| (-f.amount_cents).max(0)).sum();
        running += in_cents - out_cents;
        days.push(DayRow {
            date,
            opening_cents: opening,
            in_cents,
            out_cents,
            closing_cents: running,
            short: running < 0,
            low: running >= 0 && running < account.low_balance_cents,
            flows: today_flows,
            set_aside_cents: crate::goals::set_aside_on(&savings, date),
        });
        date += Duration::days(1);
    }

    Projection {
        today,
        base,
        has_balance: balance.is_some(),
        start_cents,
        days,
        withdrawals,
        unwithdrawn: earned,
        overdue,
        late_income,
    }
}

/// A balance older than this isn't gone by when accounts are added up.
pub const STALE_BALANCE_DAYS: i64 = 45;

/// One account's cash flow, among the accounts in use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountFlow {
    pub account: Account,
    pub projection: Projection,
    /// Its balance is older than STALE_BALANCE_DAYS.
    pub stale: bool,
    /// It counts in the accounts' total: it has a balance, and not a stale
    /// one. The only account in use always does.
    pub counted: bool,
}

/// The cash flow of every account in use (never none: the main one is), in
/// their order, each up to `end`.
pub fn project_accounts(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    ctx: &Ctx,
    end: NaiveDate,
) -> Vec<AccountFlow> {
    let today = ctx.today();
    let mut flows: Vec<AccountFlow> = snapshot
        .live_accounts()
        .into_iter()
        .map(|account| {
            let projection = project_account(snapshot, &account, taskmint, ctx, end);
            let stale = account
                .balance
                .is_some_and(|balance| balance.as_of < today - Duration::days(STALE_BALANCE_DAYS));
            AccountFlow {
                counted: projection.has_balance && !stale,
                stale,
                account,
                projection,
            }
        })
        .collect();
    // With nothing to go by anywhere (or one account only), what there is counts
    if flows.len() == 1 || flows.iter().all(|flow| !flow.counted) {
        for flow in &mut flows {
            flow.counted = true;
        }
    }
    flows
}

/// Several accounts' cash flows as one, from the first day they all cover:
/// every account's money in and out, and the balances of the ones that
/// count added up. A day is short (or low) when any account is. A transfer
/// still to make counts on both sides, and is only listed once.
pub fn combined(flows: &[AccountFlow]) -> Projection {
    if let [only] = flows {
        return only.projection.clone();
    }
    let first = &flows[0].projection;
    let (today, end) = (first.today, first.days[first.days.len() - 1].date);
    let mut date = flows
        .iter()
        .map(|flow| flow.projection.days[0].date)
        .fold(first.days[0].date, NaiveDate::max);
    let base = date - Duration::days(1);
    let mut days = Vec::new();
    while date <= end {
        let mut row = DayRow {
            date,
            opening_cents: 0,
            in_cents: 0,
            out_cents: 0,
            closing_cents: 0,
            short: false,
            low: false,
            flows: Vec::new(),
            set_aside_cents: 0,
        };
        for flow in flows {
            let day = flow
                .projection
                .day(date)
                .expect("each covers its first day to the end");
            row.in_cents += day.in_cents;
            row.out_cents += day.out_cents;
            row.flows.extend(day.flows.iter().cloned());
            let counted = Cents::from(flow.counted);
            row.opening_cents += counted * day.opening_cents;
            row.closing_cents += counted * day.closing_cents;
            row.set_aside_cents += counted * day.set_aside_cents;
            row.short |= flow.counted && day.short;
            row.low |= flow.counted && day.low;
        }
        days.push(row);
        date += Duration::days(1);
    }
    let all = |pick: fn(&Projection) -> &Vec<Late>| -> Vec<Late> {
        flows
            .iter()
            .flat_map(|flow| pick(&flow.projection).iter().cloned())
            .collect()
    };
    // (A transfer between two of them is in both accounts' lists)
    let mut overdue: Vec<Late> = Vec::new();
    for late in all(|projection| &projection.overdue) {
        if !overdue.contains(&late) {
            overdue.push(late);
        }
    }
    let late_income = all(|projection| &projection.late_income);
    Projection {
        today,
        base,
        has_balance: flows
            .iter()
            .any(|flow| flow.counted && flow.projection.has_balance),
        start_cents: days[0].opening_cents,
        days,
        withdrawals: flows
            .iter()
            .flat_map(|flow| flow.projection.withdrawals.iter().cloned())
            .collect(),
        unwithdrawn: flows
            .iter()
            .flat_map(|flow| flow.projection.unwithdrawn.iter().cloned())
            .collect(),
        overdue,
        late_income,
    }
}

/// `date`'s share of `weekly` everyday spending: a seventh, the cents left
/// over spread so that each week, Monday to Sunday, comes to `weekly`.
pub fn day_spending(weekly: Cents, date: NaiveDate) -> Cents {
    let day = i64::from(date.weekday().num_days_from_monday());
    (day + 1) * weekly / 7 - day * weekly / 7
}

/// The everyday spending the cash flow takes out over the days after
/// `after` up to `to`.
pub fn spending_between(weekly: Cents, after: NaiveDate, to: NaiveDate) -> Cents {
    let mut total = 0;
    let mut date = after + Duration::days(1);
    while weekly > 0 && date <= to {
        total += day_spending(weekly, date);
        date += Duration::days(1);
    }
    total
}

fn withdrawal_flow(date: NaiveDate, status: FlowStatus, cents: Cents, uncertain: Cents) -> Flow {
    Flow {
        date,
        kind: FlowKind::Withdrawal,
        status,
        amount_cents: cents,
        item_id: None,
        name: String::new(),
        scheduled: None,
        uncertain_cents: uncertain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::forecast::contract::{Amount, Taken};
    use crate::model::{Balance, ItemKind, Repeat};
    use crate::occur::tests::{d, item, over, put_item, put_over};
    use crate::time::DAY_MS;

    /// Nov 10, 2026, noon in Chicago.
    fn ctx() -> Ctx {
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn with_balance(snapshot: &mut Snapshot, cents: Cents, as_of: NaiveDate, low: Cents) {
        let settings = Settings {
            balance: Some(Balance { cents, as_of }),
            low_balance_cents: low,
            ..Settings::default()
        };
        snapshot.write(DocKey::Settings, Some(&settings));
    }

    fn row(projection: &Projection, date: NaiveDate) -> (Cents, Cents, bool, bool) {
        let day = projection.day(date).unwrap();
        (day.opening_cents, day.closing_cents, day.short, day.low)
    }

    #[test]
    fn counts_each_occurrence_on_the_day_it_moves_money() {
        let ctx = ctx();
        assert_eq!(ctx.today(), d(2026, 11, 10));
        let mut s = Snapshot::default();
        with_balance(&mut s, 100_000, d(2026, 11, 5), 20_000);
        let monthly = |day| Repeat::Months { n: 1, day };
        // Rent on the 7th: still open, so overdue (today)
        put_item(
            &mut s,
            item("rent", ItemKind::Bill, d(2026, 10, 7), monthly(7), 50_000),
        );
        // Phone on the 3rd: before the balance, so in it already
        put_item(
            &mut s,
            item("phone", ItemKind::Bill, d(2026, 10, 3), monthly(3), 5_000),
        );
        // Power on the 12th, paid early on the 6th (after the balance): the 6th
        put_item(
            &mut s,
            item("power", ItemKind::Bill, d(2026, 10, 12), monthly(12), 7_000),
        );
        put_over(
            &mut s,
            over(
                "power",
                d(2026, 11, 12),
                OccStatus::Done {
                    on: d(2026, 11, 6),
                    amount_cents: 6_500,
                },
            ),
        );
        // Gym on autopay on the 8th, and skipped on Dec 8
        let mut gym = item("gym", ItemKind::Bill, d(2026, 10, 8), monthly(8), 3_000);
        gym.autopay = true;
        put_item(&mut s, gym);
        put_over(&mut s, over("gym", d(2026, 12, 8), OccStatus::Skipped));
        // Pay on the 9th not yet in: late, not counted; and on the 20th: counted then
        put_item(
            &mut s,
            item("pay", ItemKind::Income, d(2026, 10, 9), monthly(9), 40_000),
        );
        put_item(
            &mut s,
            item(
                "bonus",
                ItemKind::Income,
                d(2026, 11, 20),
                Repeat::Once,
                90_000,
            ),
        );

        let p = project(&s, None, &ctx, d(2026, 12, 10));
        assert!(p.has_balance);
        assert_eq!(p.base, d(2026, 11, 5));
        assert_eq!(p.days.first().unwrap().date, d(2026, 11, 6));
        assert_eq!(row(&p, d(2026, 11, 6)), (100_000, 93_500, false, false));
        assert_eq!(row(&p, d(2026, 11, 8)), (93_500, 90_500, false, false));
        // Today: rent, overdue
        assert_eq!(row(&p, d(2026, 11, 10)), (90_500, 40_500, false, false));
        assert_eq!(p.today_row().flows[0].status, FlowStatus::Overdue);
        assert_eq!(
            p.overdue,
            vec![Late {
                item_id: "rent".into(),
                scheduled: d(2026, 11, 7)
            }]
        );
        assert_eq!(
            p.late_income,
            vec![Late {
                item_id: "pay".into(),
                scheduled: d(2026, 11, 9)
            }]
        );
        // The 12th's power was paid on the 6th: nothing more then
        assert_eq!(row(&p, d(2026, 11, 12)), (40_500, 40_500, false, false));
        assert_eq!(row(&p, d(2026, 11, 20)), (40_500, 130_500, false, false));
        // December: phone, rent, pay; the gym skipped
        assert_eq!(row(&p, d(2026, 12, 3)), (130_500, 125_500, false, false));
        assert_eq!(row(&p, d(2026, 12, 7)), (125_500, 75_500, false, false));
        assert_eq!(row(&p, d(2026, 12, 8)), (75_500, 75_500, false, false));
        assert_eq!(row(&p, d(2026, 12, 9)), (75_500, 115_500, false, false));
        assert_eq!(p.ahead().first().unwrap().date, d(2026, 11, 10));
        assert!(p.day(d(2026, 11, 5)).is_none());
        assert!(p.day(d(2027, 1, 1)).is_none());
    }

    #[test]
    fn an_archived_items_payments_still_count() {
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 1_000, d(2026, 11, 9), 0);
        let mut old = item(
            "old",
            ItemKind::Bill,
            d(2026, 11, 12),
            Repeat::Months { n: 1, day: 12 },
            300,
        );
        old.archived = true;
        put_item(&mut s, old);
        put_over(
            &mut s,
            over(
                "old",
                d(2026, 11, 12),
                OccStatus::Done {
                    on: d(2026, 11, 10),
                    amount_cents: 300,
                },
            ),
        );
        let p = project(&s, None, &ctx, d(2026, 12, 31));
        assert_eq!(p.days.last().unwrap().closing_cents, 700);
    }

    #[test]
    fn flags_short_and_low_days() {
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 10_000, d(2026, 11, 10), 5_000);
        put_item(
            &mut s,
            item("a", ItemKind::Bill, d(2026, 11, 11), Repeat::Once, 6_000),
        );
        put_item(
            &mut s,
            item("b", ItemKind::Bill, d(2026, 11, 12), Repeat::Once, 6_000),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 13));
        // As of today: today's row holds the balance, and nothing moves today
        assert_eq!(p.days.first().unwrap().date, d(2026, 11, 10));
        assert_eq!(row(&p, d(2026, 11, 10)), (10_000, 10_000, false, false));
        assert_eq!(row(&p, d(2026, 11, 11)), (10_000, 4_000, false, true));
        assert_eq!(row(&p, d(2026, 11, 12)), (4_000, -2_000, true, false));
    }

    #[test]
    fn a_bill_due_on_the_balances_day_and_never_marked_is_still_owed() {
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 10_000, d(2026, 11, 10), 0);
        // Due today, the balance's day: one by hand, one on autopay, and pay by hand
        put_item(
            &mut s,
            item("net", ItemKind::Bill, d(2026, 11, 10), Repeat::Once, 6_500),
        );
        let mut auto = item("gym", ItemKind::Bill, d(2026, 11, 10), Repeat::Once, 2_000);
        auto.autopay = true;
        put_item(&mut s, auto);
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 11, 10),
                Repeat::Once,
                50_000,
            ),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 12));
        // The bill by hand comes off today; autopay's is in the balance; pay isn't counted till it's in
        assert_eq!(row(&p, d(2026, 11, 10)), (10_000, 3_500, false, false));
        assert_eq!(p.overdue.len(), 1);
        assert_eq!(p.overdue[0].item_id, "net");
        assert_eq!(p.late_income.len(), 1);

        // The day before the balance's: taken as in it, as ever
        put_item(
            &mut s,
            item("old", ItemKind::Bill, d(2026, 11, 9), Repeat::Once, 1_000),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 12));
        assert_eq!(p.overdue.len(), 1);

        // Marked paid that day: the forecast leaves it out (the balance says whether it had it)
        put_over(
            &mut s,
            over(
                "net",
                d(2026, 11, 10),
                OccStatus::Done {
                    on: d(2026, 11, 10),
                    amount_cents: 6_500,
                },
            ),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 12));
        assert_eq!(row(&p, d(2026, 11, 10)), (10_000, 10_000, false, false));
        assert!(p.overdue.is_empty());
    }

    #[test]
    fn without_a_balance_starts_from_nothing_and_still_finds_overdue_bills() {
        let ctx = ctx();
        let mut s = Snapshot::default();
        put_item(
            &mut s,
            item("old", ItemKind::Bill, d(2026, 9, 1), Repeat::Once, 1),
        );
        put_item(
            &mut s,
            item("late", ItemKind::Bill, d(2026, 10, 20), Repeat::Once, 2_000),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 1));
        assert!(!p.has_balance);
        assert_eq!(p.days.len(), 1);
        assert_eq!(row(&p, d(2026, 11, 10)), (0, -2_000, true, false));
        assert_eq!(p.overdue.len(), 1);
        // A balance dated in the future (a clock change) isn't one yet
        with_balance(&mut s, 5, d(2026, 11, 11), 0);
        assert!(!project(&s, None, &ctx, d(2026, 11, 1)).has_balance);
    }

    #[test]
    fn counts_taskmints_withdrawals_when_they_reach_the_bank() {
        let ctx = ctx();
        let now = ctx.now_ms();
        let mut s = Snapshot::default();
        with_balance(&mut s, 0, d(2026, 11, 8), 0);
        let forecast = PayoutForecast {
            schema: 1,
            as_of_ms: now - DAY_MS,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            // Taken yesterday at noon: arrives today at noon. Taken on the 7th: in the balance
            cutoff: Some(Taken {
                taken_at_ms: now - DAY_MS,
                amount_cents: 700,
            }),
            recent_withdrawals: vec![
                Taken {
                    taken_at_ms: now - DAY_MS,
                    amount_cents: 700,
                },
                Taken {
                    taken_at_ms: now - 3 * DAY_MS,
                    amount_cents: 900,
                },
            ],
            next_allowed_at_ms: Some(now + 2 * DAY_MS),
            scheduled: None,
            carried: Amount {
                actual_cents: 100,
                estimated_cents: 0,
                past_due_cents: 0,
            },
            carried_days: vec![],
            steps: vec![crate::forecast::contract::Step {
                at_ms: now + DAY_MS,
                day: None,
                actual_cents: 200,
                estimated_cents: 50,
                past_due_cents: 0,
                open: None,
            }],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        };
        let p = project(&s, Some(&forecast), &ctx, d(2026, 11, 30));
        assert_eq!(row(&p, d(2026, 11, 10)), (0, 700, false, false));
        // Made on the 12th at noon, in the bank on the 13th
        assert_eq!(p.withdrawals.len(), 1);
        assert_eq!(p.withdrawals[0].total_cents, 350);
        assert_eq!(row(&p, d(2026, 11, 13)), (700, 1050, false, false));
        let flow = &p.day(d(2026, 11, 13)).unwrap().flows[0];
        assert_eq!(
            (flow.kind, flow.status, flow.uncertain_cents),
            (FlowKind::Withdrawal, FlowStatus::Projected, 50)
        );

        // Not counting TaskMint: none of it
        let mut off = s.settings();
        off.taskmint.use_forecast = false;
        s.write(DocKey::Settings, Some(&off));
        let p = project(&s, Some(&forecast), &ctx, d(2026, 11, 30));
        assert!(p.withdrawals.is_empty());
        // One taken just now reaches the bank tomorrow: past a projection that ends today
        let mut on = s.settings();
        on.taskmint.use_forecast = true;
        s.write(DocKey::Settings, Some(&on));
        let mut now_taken = forecast.clone();
        now_taken.recent_withdrawals = vec![Taken {
            taken_at_ms: now,
            amount_cents: 5,
        }];
        let p = project(&s, Some(&now_taken), &ctx, d(2026, 11, 10));
        assert_eq!(p.days.last().unwrap().closing_cents, 0);
        assert_eq!(p.days.last().unwrap().closing_cents, 0);
        // A projection that would end before today ends today
        assert_eq!(
            project(&s, None, &ctx, d(2026, 1, 1))
                .days
                .last()
                .unwrap()
                .date,
            d(2026, 11, 10)
        );
    }

    #[test]
    fn counts_what_was_paid_far_from_its_due_date() {
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 200_000, d(2026, 11, 9), 0);
        // Insurance due in March, paid today; an old bill from June, paid today too
        for (id, due, cents) in [
            ("insurance", d(2027, 3, 15), 120_000),
            ("old", d(2026, 6, 1), 10_000),
        ] {
            put_item(&mut s, item(id, ItemKind::Bill, due, Repeat::Once, cents));
            let paid = OccStatus::Done {
                on: d(2026, 11, 10),
                amount_cents: cents,
            };
            put_over(&mut s, over(id, due, paid));
        }
        let p = project(&s, None, &ctx, d(2027, 1, 9));
        assert_eq!(row(&p, d(2026, 11, 10)), (200_000, 70_000, false, false));
        // The month it was due in says the same
        let march = project(&s, None, &ctx, d(2027, 3, 31));
        assert_eq!(
            row(&march, d(2026, 11, 10)),
            (200_000, 70_000, false, false)
        );
        assert_eq!(row(&march, d(2027, 3, 15)), (70_000, 70_000, false, false));
    }

    #[test]
    fn a_short_day_takes_no_withdrawal_arriving_the_day_after() {
        // Mar 13, 2027, noon in Chicago: the clocks go forward that night, so the 14th has 23 hours
        let ctx = Ctx::new(1_804_960_800_000, "America/Chicago");
        let mut s = Snapshot::default();
        with_balance(&mut s, 0, d(2027, 3, 12), 0);
        let forecast = PayoutForecast {
            schema: 1,
            as_of_ms: ctx.now_ms(),
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            // The last one three days before it opens again: in the balance already
            cutoff: Some(Taken {
                taken_at_ms: 1_805_002_200_000 - 3 * DAY_MS,
                amount_cents: 1,
            }),
            recent_withdrawals: vec![],
            // Open at 11:30 pm on the 13th: in the bank a day later, half past midnight on the 15th
            next_allowed_at_ms: Some(1_805_002_200_000),
            scheduled: None,
            carried: Amount {
                actual_cents: 500,
                estimated_cents: 0,
                past_due_cents: 0,
            },
            carried_days: vec![],
            steps: vec![],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        };
        let through = |end| project(&s, Some(&forecast), &ctx, end);
        assert!(through(d(2027, 3, 14)).withdrawals.is_empty());
        let next_day = through(d(2027, 3, 15));
        assert_eq!(next_day.withdrawals[0].arrives_on, d(2027, 3, 15));
        assert_eq!(row(&next_day, d(2027, 3, 15)), (0, 500, false, false));
    }

    #[test]
    fn a_transfer_leaves_the_main_account_or_reaches_it_and_another_accounts_money_isnt_its() {
        use crate::occur::tests::{in_account, put_account, transfer};
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 100_000, d(2026, 11, 5), 0);
        put_account(&mut s, "savings", None);
        put_account(&mut s, "card", None);
        let once = Repeat::Once;
        // To savings on the 12th, back from it on the 14th
        put_item(
            &mut s,
            transfer(
                "put",
                (None, Some("savings")),
                d(2026, 11, 12),
                once,
                30_000,
            ),
        );
        put_item(
            &mut s,
            transfer(
                "take",
                (Some("savings"), None),
                d(2026, 11, 14),
                once,
                5_000,
            ),
        );
        // Paid from savings, and moved between two other accounts: none of the main one's money
        put_item(
            &mut s,
            in_account(
                item("fee", ItemKind::Bill, d(2026, 11, 13), once, 700),
                "savings",
            ),
        );
        put_item(
            &mut s,
            transfer(
                "pay-card",
                (Some("savings"), Some("card")),
                d(2026, 11, 13),
                once,
                900,
            ),
        );
        // Still open and past due: the money is the user's either way, so both count today
        put_item(
            &mut s,
            transfer(
                "late-out",
                (None, Some("savings")),
                d(2026, 11, 7),
                once,
                2_000,
            ),
        );
        put_item(
            &mut s,
            transfer(
                "late-in",
                (Some("savings"), None),
                d(2026, 11, 8),
                once,
                4_000,
            ),
        );
        let p = project(&s, None, &ctx, d(2026, 11, 20));
        assert_eq!(row(&p, d(2026, 11, 10)), (100_000, 102_000, false, false));
        let owed = &p.today_row().flows[0];
        assert_eq!(
            (owed.kind, owed.status, owed.amount_cents),
            (FlowKind::Transfer, FlowStatus::Overdue, -2_000)
        );
        let ids = |late: &[Late]| -> Vec<String> {
            late.iter().map(|late| late.item_id.clone()).collect()
        };
        let arriving = &p.today_row().flows[1];
        assert_eq!(
            (arriving.kind, arriving.status, arriving.amount_cents),
            (FlowKind::Transfer, FlowStatus::Overdue, 4_000)
        );
        assert_eq!(ids(&p.overdue), ["late-out", "late-in"]);
        assert!(p.late_income.is_empty());
        assert_eq!(row(&p, d(2026, 11, 12)), (102_000, 72_000, false, false));
        assert_eq!(row(&p, d(2026, 11, 13)), (72_000, 72_000, false, false));
        assert_eq!(row(&p, d(2026, 11, 14)), (72_000, 77_000, false, false));
        let back = &p.day(d(2026, 11, 14)).unwrap().flows[0];
        assert_eq!((back.kind, back.amount_cents), (FlowKind::Transfer, 5_000));
    }

    fn account(id: &str, cents: Cents, as_of: NaiveDate, low: Cents) -> Account {
        Account {
            id: id.into(),
            name: id.to_uppercase(),
            order: 1,
            balance: Some(Balance { cents, as_of }),
            low_balance_cents: low,
            checks: Vec::new(),
            archived: false,
        }
    }

    fn put(s: &mut Snapshot, account: &Account) {
        s.write(DocKey::Account(account.id.clone()), Some(account));
    }

    #[test]
    fn each_account_has_a_cash_flow_of_its_own_from_its_own_balance() {
        use crate::occur::tests::{in_account, transfer};
        let ctx = ctx();
        let now = ctx.now_ms();
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 100_000,
                as_of: d(2026, 11, 5),
            }),
            spending_weekly_cents: 7_000,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        // Savings, as of the 8th, flagged low below $450
        let savings = account("savings", 50_000, d(2026, 11, 8), 45_000);
        put(&mut s, &savings);
        let once = Repeat::Once;
        // Moved to savings on the 7th: after the main account's balance (it comes off it), and
        // before savings' (which has it already)
        put_item(
            &mut s,
            transfer("put", (None, Some("savings")), d(2026, 11, 7), once, 10_000),
        );
        put_over(
            &mut s,
            over(
                "put",
                d(2026, 11, 7),
                OccStatus::Done {
                    on: d(2026, 11, 7),
                    amount_cents: 10_000,
                },
            ),
        );
        put_item(
            &mut s,
            in_account(
                item("fee", ItemKind::Bill, d(2026, 11, 12), once, 700),
                "savings",
            ),
        );
        put_item(
            &mut s,
            transfer(
                "take",
                (Some("savings"), None),
                d(2026, 11, 14),
                once,
                5_000,
            ),
        );
        // TaskMint pays into the main account only
        let forecast = PayoutForecast {
            schema: 1,
            as_of_ms: now - DAY_MS,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * DAY_MS,
            last_import_ms: None,
            cutoff: None,
            recent_withdrawals: vec![Taken {
                taken_at_ms: now - DAY_MS,
                amount_cents: 900,
            }],
            next_allowed_at_ms: None,
            scheduled: None,
            carried: Amount {
                actual_cents: 0,
                estimated_cents: 0,
                past_due_cents: 0,
            },
            carried_days: vec![],
            steps: vec![],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        };
        let end = d(2026, 11, 20);
        let main = project(&s, Some(&forecast), &ctx, end);
        let other = project_account(&s, &savings, Some(&forecast), &ctx, end);
        let kinds = |p: &Projection| -> Vec<FlowKind> {
            let mut kinds: Vec<FlowKind> = p
                .days
                .iter()
                .flat_map(|day| day.flows.iter().map(|flow| flow.kind))
                .collect();
            kinds.dedup();
            kinds
        };
        // The main account: from the 6th, with the transfer out, TaskMint's money and the spending
        assert_eq!(main.days[0].date, d(2026, 11, 6));
        assert_eq!(main.day(d(2026, 11, 7)).unwrap().out_cents, 11_000);
        assert!(kinds(&main).contains(&FlowKind::Withdrawal));
        assert!(kinds(&main).contains(&FlowKind::Spending));
        // Savings: from the 9th, its balance untouched by what came before it, and nothing of TaskMint's
        assert_eq!(
            (other.base, other.days[0].date),
            (d(2026, 11, 8), d(2026, 11, 9))
        );
        assert_eq!(kinds(&other), [FlowKind::Bill, FlowKind::Transfer]);
        assert_eq!(row(&other, d(2026, 11, 10)), (50_000, 50_000, false, false));
        assert_eq!(row(&other, d(2026, 11, 12)), (50_000, 49_300, false, false));
        // By its own low mark
        assert_eq!(row(&other, d(2026, 11, 14)), (49_300, 44_300, false, true));
        let fourteenth = main.day(d(2026, 11, 14)).unwrap();
        assert_eq!(fourteenth.in_cents, 5_000);
        assert!(!fourteenth.low);

        // Together, from the first day both cover: the balances add up, and a transfer nets to nothing
        let flows = project_accounts(&s, Some(&forecast), &ctx, end);
        let ids: Vec<_> = flows
            .iter()
            .map(|f| (f.account.id.as_str(), f.counted, f.stale))
            .collect();
        assert_eq!(ids, [("main", true, false), ("savings", true, false)]);
        let both = combined(&flows);
        assert_eq!(
            (both.base, both.days[0].date),
            (d(2026, 11, 8), d(2026, 11, 9))
        );
        assert!(both.has_balance);
        assert_eq!(
            both.start_cents,
            main.day(d(2026, 11, 9)).unwrap().opening_cents + 50_000
        );
        let day = both.day(d(2026, 11, 14)).unwrap();
        assert_eq!(day.closing_cents, fourteenth.closing_cents + 44_300);
        assert_eq!((day.in_cents, day.out_cents), (5_000, 6_000));
        assert_eq!(day.closing_cents - day.opening_cents, -1_000);
        // Low when either is
        assert!(day.low && !day.short);
        assert_eq!(both.withdrawals, main.withdrawals);
        assert_eq!(both.days.last().unwrap().date, end);
    }

    #[test]
    fn accounts_together_leave_out_a_balance_that_isnt_there_or_is_old() {
        use crate::occur::tests::{in_account, put_account, transfer};
        let ctx = ctx();
        let mut s = Snapshot::default();
        // Only the main account, and no balance: it counts all the same, as its own cash flow
        let alone = project_accounts(&s, None, &ctx, d(2026, 11, 12));
        assert!(alone.len() == 1 && alone[0].counted && !alone[0].projection.has_balance);
        assert_eq!(combined(&alone), project(&s, None, &ctx, d(2026, 11, 12)));
        // Two accounts and no balance anywhere: both count, from nothing
        put_account(&mut s, "card", None);
        let neither = project_accounts(&s, None, &ctx, d(2026, 11, 12));
        assert!(neither.iter().all(|flow| flow.counted));
        assert!(!combined(&neither).has_balance);

        with_balance(&mut s, 10_000, d(2026, 11, 9), 0);
        // An old balance (Sep 1), and one not set
        put(&mut s, &account("old", 70_000, d(2026, 9, 1), 0));
        let once = Repeat::Once;
        put_item(
            &mut s,
            in_account(
                item("fee", ItemKind::Bill, d(2026, 11, 11), once, 300),
                "card",
            ),
        );
        // Still to move, and past due: out of the main account and into the card; listed once
        put_item(
            &mut s,
            in_account(
                item("refund", ItemKind::Income, d(2026, 11, 9), once, 500),
                "card",
            ),
        );
        put_item(
            &mut s,
            transfer("late", (None, Some("card")), d(2026, 11, 9), once, 1_000),
        );
        // The main balance is as of the 9th: what was due that day and never marked is still owed
        let flows = project_accounts(&s, None, &ctx, d(2026, 11, 12));
        let summary: Vec<_> = flows
            .iter()
            .map(|f| (f.account.id.as_str(), f.counted, f.stale))
            .collect();
        assert_eq!(
            summary,
            [
                ("main", true, false),
                ("card", false, false),
                ("old", false, true)
            ]
        );
        let all = combined(&flows);
        // Only the main account's balance, though the card's bill is among the day's money out
        let eleventh = all.day(d(2026, 11, 11)).unwrap();
        assert_eq!(
            (eleventh.opening_cents, eleventh.closing_cents),
            (9_000, 9_000)
        );
        assert_eq!(eleventh.out_cents, 300);
        assert!(!eleventh.short);
        let ids = |late: &[Late]| -> Vec<String> {
            late.iter().map(|late| late.item_id.clone()).collect()
        };
        assert_eq!(ids(&all.overdue), ["late"]);
        assert_eq!(ids(&all.late_income), ["refund"]);
    }

    #[test]
    fn a_transfer_still_to_make_leaves_what_the_accounts_hold_together_as_it_is() {
        use crate::occur::tests::transfer;
        let ctx = ctx();
        let mut s = Snapshot::default();
        with_balance(&mut s, 10_000, d(2026, 11, 8), 0);
        let savings = account("savings", 50_000, d(2026, 11, 8), 0);
        put(&mut s, &savings);
        // Due yesterday and not marked moved: out of the one today, and into the other
        put_item(
            &mut s,
            transfer(
                "late",
                (None, Some("savings")),
                d(2026, 11, 9),
                Repeat::Once,
                1_000,
            ),
        );
        let end = d(2026, 11, 12);
        assert_eq!(
            project(&s, None, &ctx, end).today_row().closing_cents,
            9_000
        );
        let other = project_account(&s, &savings, None, &ctx, end);
        assert_eq!(other.today_row().closing_cents, 51_000);
        assert!(other.late_income.is_empty());
        let all = combined(&project_accounts(&s, None, &ctx, end));
        let today = all.today_row();
        assert_eq!((today.opening_cents, today.closing_cents), (60_000, 60_000));
        assert_eq!((today.in_cents, today.out_cents), (1_000, 1_000));
        // Still to do, and listed once
        assert_eq!(all.overdue.len(), 1);
        assert_eq!(all.overdue[0].item_id, "late");
    }
}
