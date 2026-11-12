//! What each page shows, worked out here so every app shows the same: the
//! overview, a month of the calendar, the forecast, the bills and income
//! lists, and an item's history. Amounts are cents and dates calendar dates;
//! the client formats them.

use crate::docs::Snapshot;
use crate::earn::{earn_to_cover, EarnToCover};
use crate::forecast::contract::PayoutForecast;
use crate::forecast::series::ProjectedWithdrawal;
use crate::forecast::ForecastStatus;
use crate::model::{
    Balance, Cents, Item, ItemKind, OccStatus, Repeat, Segment, Settings, TaskMintPlan,
};
use crate::occur::{estimate, item_occurrences, occurrences, Estimate, Occurrence};
use crate::project::{
    open_settled_through, project, recorded_arrivals, settled_through, DayRow, FlowKind,
    FlowStatus, Projection,
};
use crate::time::{in_calendar, into_calendar, Ctx};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// How many days ahead the overview's lists look.
pub const UPCOMING_DAYS: i64 = 14;
/// "Due this week": today and the six days after.
pub const WEEK_DAYS: i64 = 7;
/// How far back the overview asks what autopay bills that vary came to.
pub const NEEDS_AMOUNT_DAYS: i64 = 45;

/// One occurrence of an item, as the pages list it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceView {
    pub item_id: String,
    pub name: String,
    pub kind: ItemKind,
    pub category: Option<String>,
    pub autopay: bool,
    /// Which occurrence: the schedule's date.
    pub scheduled: NaiveDate,
    pub due: NaiveDate,
    pub expected_cents: Cents,
    /// The expected amount is the average of the last few paid (its amount varies).
    pub estimated: bool,
    /// Its item's amount varies: what it came to is asked, not assumed.
    pub varies: bool,
    pub status: OccStatus,
    /// Still open after its due day, not on autopay, and not settled by the
    /// balance (which has taken what was due by its day as paid).
    pub late: bool,
    /// This time's amount, when the user set one (else the schedule's).
    pub amount_cents: Option<Cents>,
    /// The user changed something about this one (moved, amount, note).
    pub changed: bool,
    pub note: Option<String>,
}

/// `settled`: the last day whose open occurrences the balance has settled
/// (project::open_settled_through).
pub(crate) fn occurrence_view(
    occurrence: &Occurrence<'_>,
    today: NaiveDate,
    settled: NaiveDate,
) -> OccurrenceView {
    let item = occurrence.item;
    OccurrenceView {
        item_id: item.id.clone(),
        name: item.name.clone(),
        kind: item.kind,
        category: item.category.clone(),
        autopay: item.autopay,
        scheduled: occurrence.scheduled,
        due: occurrence.due,
        expected_cents: occurrence.expected_cents,
        estimated: occurrence.estimated,
        varies: item.varies,
        status: occurrence.status.clone(),
        late: occurrence.status == OccStatus::Open
            && !item.autopay
            && occurrence.due < today
            && occurrence.due > settled,
        amount_cents: occurrence.over.and_then(|over| over.amount_cents),
        changed: occurrence.over.is_some_and(|over| {
            over.moved_to.is_some() || over.amount_cents.is_some() || over.note.is_some()
        }),
        note: occurrence.over.and_then(|over| over.note.clone()),
    }
}

/// A balance on a day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DayBalance {
    pub date: NaiveDate,
    pub cents: Cents,
}

/// A day of the overview's upcoming list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDay {
    pub date: NaiveDate,
    pub occurrences: Vec<OccurrenceView>,
    /// TaskMint's money reaching the bank that day.
    pub withdrawal_cents: Cents,
    /// Of it, estimated or assumed.
    pub withdrawal_uncertain_cents: Cents,
    pub closing_cents: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub count: u32,
    pub cents: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub today: NaiveDate,
    /// The balance the user set; null until they do.
    pub balance: Option<Balance>,
    /// The balance by the end of today.
    pub today_cents: Cents,
    /// The lowest the balance gets within the horizon.
    pub lowest: DayBalance,
    /// The first day it goes below zero.
    pub first_short: Option<DayBalance>,
    /// The first day it goes below the low mark (or zero).
    pub first_low: Option<DayBalance>,
    pub low_balance_cents: Cents,
    pub horizon_days: u16,
    /// Bills due today and the six days after.
    pub due_this_week: Totals,
    /// Money coming in over the next 14 days, TaskMint's included.
    pub income_ahead_cents: Cents,
    pub next_withdrawal: Option<ProjectedWithdrawal>,
    /// The next bill still to pay, within the upcoming days (the tray names it).
    pub next_bill: Option<OccurrenceView>,
    /// Bills past due, still owed.
    pub overdue: Vec<OccurrenceView>,
    /// Income past due, not yet in.
    pub late_income: Vec<OccurrenceView>,
    /// Autopay items whose amount varies, due in the last NEEDS_AMOUNT_DAYS
    /// and taken at their estimate: what they really came to is asked, so
    /// the estimate learns from it.
    pub needs_amount: Vec<OccurrenceView>,
    /// The next 14 days with something on them.
    pub upcoming: Vec<UpcomingDay>,
    pub taskmint: ForecastStatus,
    /// TaskMint's withdrawals are counted.
    pub uses_taskmint: bool,
    /// What can be spent today, beyond the everyday spending, and the balance
    /// still stay above the low mark (or zero) to the horizon, leaving what's
    /// set aside for bills alone.
    pub safe_to_spend: SafeToSpend,
    /// Set aside for bills by the end of today (crate::goals).
    pub set_aside_cents: Cents,
    /// When it goes short or low: what more TaskMint would have to earn, and by when.
    pub earn_to_cover: Option<EarnToCover>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SafeToSpend {
    pub cents: Cents,
    /// The day that holds it to that: its balance, less what's set aside then.
    pub tightest: DayBalance,
    /// The horizon's last day: what it's safe through.
    pub through: NaiveDate,
    /// The everyday spending the cash flow takes out already (a week's).
    pub spending_weekly_cents: Cents,
}

/// What's free to spend today: the least, from today to the end, that the
/// balance less what's set aside gets to, above the mark it's kept over.
pub fn safe_to_spend(ahead: &[DayRow], settings: &Settings) -> SafeToSpend {
    let tightest = ahead
        .iter()
        .min_by_key(|day| day.closing_cents - day.set_aside_cents)
        .map(|day| DayBalance {
            date: day.date,
            cents: day.closing_cents - day.set_aside_cents,
        })
        .expect("the projection covers today");
    SafeToSpend {
        cents: (tightest.cents - settings.low_balance_cents.max(0)).max(0),
        tightest,
        through: ahead.last().expect("the projection covers today").date,
        spending_weekly_cents: settings.spending_weekly_cents.max(0),
    }
}

/// The horizon's last day.
fn horizon_end(settings: &Settings, today: NaiveDate) -> NaiveDate {
    today + Duration::days(i64::from(settings.horizon_days))
}

/// Views of an occurrence the projection names as late.
fn late_views(
    snapshot: &Snapshot,
    late: &[crate::project::Late],
    today: NaiveDate,
) -> Vec<OccurrenceView> {
    let settled = open_settled_through(&snapshot.settings(), today);
    late.iter()
        .filter_map(|late| {
            // The projection names only items that are there
            let item = &snapshot.items[&late.item_id];
            item_occurrences(snapshot, item, late.scheduled - Duration::days(62), today)
                .iter()
                .find(|occurrence| occurrence.scheduled == late.scheduled)
                .map(|occurrence| occurrence_view(occurrence, today, settled))
        })
        .collect()
}

pub fn overview(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    status: &ForecastStatus,
    ctx: &Ctx,
) -> Overview {
    let settings = snapshot.settings();
    let today = ctx.today();
    let settled = open_settled_through(&settings, today);
    let projection = project(snapshot, taskmint, ctx, horizon_end(&settings, today));
    let ahead = projection.ahead();
    let lowest = ahead
        .iter()
        .min_by_key(|day| day.closing_cents)
        .map(|day| DayBalance {
            date: day.date,
            cents: day.closing_cents,
        })
        .expect("the projection covers today");
    let first = |test: &dyn Fn(&DayRow) -> bool| {
        ahead.iter().find(|day| test(day)).map(|day| DayBalance {
            date: day.date,
            cents: day.closing_cents,
        })
    };

    let week_end = today + Duration::days(WEEK_DAYS - 1);
    let upcoming_end = today + Duration::days(UPCOMING_DAYS - 1);
    let mut due_this_week = Totals { count: 0, cents: 0 };
    let mut income_ahead_cents = 0;
    let mut upcoming = Vec::new();
    let all = occurrences(snapshot, today, upcoming_end, false);
    for day in ahead.iter().take_while(|day| day.date <= upcoming_end) {
        for flow in &day.flows {
            if flow.kind == FlowKind::Bill
                && flow.status != FlowStatus::Done
                && day.date <= week_end
            {
                due_this_week.count += 1;
                due_this_week.cents -= flow.amount_cents;
            }
            if flow.amount_cents > 0 && flow.status != FlowStatus::Done {
                income_ahead_cents += flow.amount_cents;
            }
        }
        let occurrences: Vec<OccurrenceView> = all
            .iter()
            .filter(|occurrence| occurrence.due == day.date)
            .map(|occurrence| occurrence_view(occurrence, today, settled))
            .collect();
        let withdrawals = day
            .flows
            .iter()
            .filter(|flow| flow.kind == FlowKind::Withdrawal);
        let withdrawal_cents = withdrawals.clone().map(|flow| flow.amount_cents).sum();
        if occurrences.is_empty() && withdrawal_cents == 0 {
            continue;
        }
        upcoming.push(UpcomingDay {
            date: day.date,
            occurrences,
            withdrawal_cents,
            withdrawal_uncertain_cents: withdrawals.map(|flow| flow.uncertain_cents).sum(),
            closing_cents: day.closing_cents,
        });
    }

    Overview {
        today,
        balance: settings.balance,
        today_cents: projection.today_row().closing_cents,
        lowest,
        first_short: first(&|day| day.closing_cents < 0),
        first_low: first(&|day| day.closing_cents < settings.low_balance_cents.max(0)),
        low_balance_cents: settings.low_balance_cents,
        horizon_days: settings.horizon_days,
        due_this_week,
        income_ahead_cents,
        next_withdrawal: projection.withdrawals.first().cloned(),
        next_bill: upcoming
            .iter()
            .flat_map(|day| &day.occurrences)
            .find(|o| o.kind == ItemKind::Bill && o.status == OccStatus::Open)
            .cloned(),
        overdue: late_views(snapshot, &projection.overdue, today),
        late_income: late_views(snapshot, &projection.late_income, today),
        needs_amount: occurrences(
            snapshot,
            today - Duration::days(NEEDS_AMOUNT_DAYS),
            today,
            false,
        )
        .iter()
        .filter(|occurrence| {
            occurrence.item.autopay
                && occurrence.item.varies
                && occurrence.status == OccStatus::Open
                && occurrence.due <= today
                // This time's own amount is already what it is
                && occurrence.over.and_then(|over| over.amount_cents).is_none()
        })
        .map(|occurrence| occurrence_view(occurrence, today, settled))
        .collect(),
        upcoming,
        taskmint: status.clone(),
        uses_taskmint: settings.taskmint.use_forecast,
        safe_to_spend: safe_to_spend(ahead, &settings),
        set_aside_cents: projection.today_row().set_aside_cents,
        earn_to_cover: earn_to_cover(taskmint, ctx, &settings, ahead),
    }
}

/// A day of the calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub date: NaiveDate,
    /// Everything due that day, paid or not (skipped ones too).
    pub occurrences: Vec<OccurrenceView>,
    /// What the day's bills come to: paid ones at what was paid, skipped ones not at all.
    pub bills_cents: Cents,
    /// What its income comes to, likewise.
    pub income_cents: Cents,
    /// TaskMint's money reaching the bank (recorded or projected).
    pub withdrawal_cents: Cents,
    pub withdrawal_uncertain_cents: Cents,
    /// The withdrawal is still ahead (not one TaskMint recorded).
    pub withdrawal_projected: bool,
    /// What the day's work earned in TaskMint that no withdrawal has taken
    /// yet (it's in no balance until one does).
    pub earned_cents: Cents,
    /// Of it, estimated or assumed.
    pub earned_uncertain_cents: Cents,
    /// When the last of it reaches the bank; null when no withdrawal ahead takes it.
    pub earned_arrives_on: Option<NaiveDate>,
    /// The everyday spending the cash flow takes out that day.
    pub spending_cents: Cents,
    /// The balance at the day's end, where the cash flow covers the day.
    pub closing_cents: Option<Cents>,
    pub short: bool,
    pub low: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct MonthView {
    /// YYYY-MM
    pub month: String,
    pub today: NaiveDate,
    pub days: Vec<CalendarDay>,
    /// The month's bills and income, each still to come or done.
    pub bills_cents: Cents,
    pub income_cents: Cents,
    /// TaskMint's money in the month.
    pub withdrawals_cents: Cents,
}

/// The longest the calendar projects ahead.
const MAX_MONTH_DAYS_AHEAD: i64 = 400;

/// The month `month` (YYYY-MM): None when it isn't one.
pub fn month(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    month: &str,
    ctx: &Ctx,
) -> Option<MonthView> {
    let first = NaiveDate::parse_from_str(&format!("{}-01", month), "%Y-%m-%d")
        .ok()
        .filter(|first| in_calendar(*first))?;
    let last = first
        + Duration::days(i64::from(crate::recur::days_in_month(first.year(), first.month())) - 1);
    let today = ctx.today();
    let settled = open_settled_through(&snapshot.settings(), today);
    let settings = snapshot.settings();
    let end = last
        .max(horizon_end(&settings, today))
        .min(today + Duration::days(MAX_MONTH_DAYS_AHEAD));
    let projection: Projection = project(snapshot, taskmint, ctx, end);
    let all = occurrences(snapshot, first, last, true);
    // Before the cash flow starts its balance has TaskMint's withdrawals, but
    // the days still show them (as far back as TaskMint lists: 92 days, 12 at most)
    let starts = projection.days[0].date;
    let recorded_before: Vec<(NaiveDate, Cents)> = taskmint
        .filter(|_| settings.taskmint.use_forecast)
        .map(|forecast| recorded_arrivals(forecast, &settings.taskmint, ctx))
        .unwrap_or_default()
        .into_iter()
        .filter(|(date, _)| *date < starts)
        .collect();

    let mut view = MonthView {
        month: first.format("%Y-%m").to_string(),
        today,
        days: Vec::new(),
        bills_cents: 0,
        income_cents: 0,
        withdrawals_cents: 0,
    };
    let mut date = first;
    while date <= last {
        let row = projection.day(date);
        let occurrences: Vec<OccurrenceView> = all
            .iter()
            .filter(|occurrence| occurrence.due == date)
            .filter(|occurrence| !occurrence.item.archived || occurrence.status != OccStatus::Open)
            .map(|occurrence| occurrence_view(occurrence, today, settled))
            .collect();
        let (mut bills_cents, mut income_cents) = (0, 0);
        for occurrence in occurrences
            .iter()
            .filter(|o| o.status != OccStatus::Skipped)
        {
            let cents = match &occurrence.status {
                OccStatus::Done { amount_cents, .. } => *amount_cents,
                _ => occurrence.expected_cents,
            };
            match occurrence.kind {
                ItemKind::Bill => bills_cents += cents,
                ItemKind::Income => income_cents += cents,
            }
        }
        view.bills_cents += bills_cents;
        view.income_cents += income_cents;
        let withdrawals: Vec<_> = row
            .into_iter()
            .flat_map(|row| &row.flows)
            .filter(|flow| flow.kind == FlowKind::Withdrawal)
            .collect();
        let withdrawal_cents: Cents = withdrawals
            .iter()
            .map(|flow| flow.amount_cents)
            .sum::<Cents>()
            + recorded_before
                .iter()
                .filter(|(on, _)| *on == date)
                .map(|(_, cents)| cents)
                .sum::<Cents>();
        view.withdrawals_cents += withdrawal_cents;
        let earned = projection.unwithdrawn.iter().find(|day| day.day == date);
        view.days.push(CalendarDay {
            date,
            occurrences,
            bills_cents,
            income_cents,
            withdrawal_cents,
            withdrawal_uncertain_cents: withdrawals.iter().map(|flow| flow.uncertain_cents).sum(),
            withdrawal_projected: withdrawals
                .iter()
                .any(|flow| flow.status == FlowStatus::Projected),
            earned_cents: earned.map_or(0, |earned| earned.money.total()),
            earned_uncertain_cents: earned.map_or(0, |earned| {
                earned.money.estimated_cents + earned.money.assumed_cents
            }),
            earned_arrives_on: earned.and_then(|earned| earned.arrives_on),
            spending_cents: row.map_or(0, |row| {
                -row.flows
                    .iter()
                    .filter(|flow| flow.kind == FlowKind::Spending)
                    .map(|flow| flow.amount_cents)
                    .sum::<Cents>()
            }),
            closing_cents: row.map(|row| row.closing_cents),
            short: row.is_some_and(|row| row.short),
            low: row.is_some_and(|row| row.low),
        });
        date += Duration::days(1);
    }
    Some(view)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ForecastView {
    pub today: NaiveDate,
    pub balance: Option<Balance>,
    /// Today to the horizon's end.
    pub days: Vec<DayRow>,
    pub withdrawals: Vec<ProjectedWithdrawal>,
    pub low_balance_cents: Cents,
    pub plan: TaskMintPlan,
    /// What a day is assumed to earn, when earnings ahead are assumed.
    pub assumed_per_day_cents: Cents,
    pub taskmint: ForecastStatus,
    /// The everyday spending taken out, a week's.
    pub spending_weekly_cents: Cents,
}

pub fn forecast(
    snapshot: &Snapshot,
    taskmint: Option<&PayoutForecast>,
    status: &ForecastStatus,
    ctx: &Ctx,
) -> ForecastView {
    let settings = snapshot.settings();
    let today = ctx.today();
    let projection = project(snapshot, taskmint, ctx, horizon_end(&settings, today));
    ForecastView {
        today,
        balance: settings.balance,
        days: projection.ahead().to_vec(),
        withdrawals: projection.withdrawals.clone(),
        low_balance_cents: settings.low_balance_cents,
        plan: settings.taskmint,
        assumed_per_day_cents: taskmint
            .filter(|_| settings.taskmint.use_forecast)
            .map_or(0, |forecast| {
                crate::forecast::curve::assumed_per_day(forecast, ctx, &settings.taskmint)
            }),
        taskmint: status.clone(),
        spending_weekly_cents: settings.spending_weekly_cents.max(0),
    }
}

/// An item, as the bills and income pages list it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    pub item: Item,
    /// The next one still open (from today on, or a late one).
    pub next: Option<OccurrenceView>,
    /// The last one done.
    pub last_done: Option<OccurrenceView>,
    /// What it comes to a month, on average (its current schedule, at
    /// its estimate when its amount varies).
    pub monthly_cents: Cents,
    /// Its amount varies: what the ones to come are expected at, once one's paid.
    pub estimate: Option<Estimate>,
    /// The part of its schedule in force today (its first, before it starts).
    pub current: Segment,
    /// Its schedule has begun: a change to it applies from a date, and what's before stays.
    pub started: bool,
    /// Nothing more to come or to pay: a one-off that's done, a schedule that's ended.
    pub finished: bool,
}

/// The part of `item`'s schedule in force on `today`: the latest that has
/// begun, or its first before any has.
fn current_segment(item: &Item, today: NaiveDate) -> Option<&Segment> {
    item.schedule
        .iter()
        .rev()
        .find(|segment| segment.from <= today)
        .or(item.schedule.first())
}

/// What `item`'s current schedule comes to a month, on average, each time
/// at `each` (its estimate) when given.
fn monthly_cents(item: &Item, today: NaiveDate, each: Option<Cents>) -> Cents {
    use crate::model::Repeat;
    let Some(segment) = current_segment(item, today) else {
        return 0;
    };
    // Ended: nothing more comes round
    if segment.until.is_some_and(|until| until < today) {
        return 0;
    }
    let cents = i128::from(each.unwrap_or(segment.amount_cents));
    let per_month = match segment.repeat {
        Repeat::Once => 0,
        Repeat::Days { n } => cents * 3044 / (100 * i128::from(n.max(1))),
        Repeat::Weeks { n } => cents * 3044 / (700 * i128::from(n.max(1))),
        Repeat::Months { n, .. } | Repeat::MonthWeekday { n, .. } => cents / i128::from(n.max(1)),
        Repeat::TwiceMonthly { .. } => cents * 2,
        Repeat::Years { n } => cents / (12 * i128::from(n.max(1))),
    };
    per_month as Cents
}

pub fn items(snapshot: &Snapshot, ctx: &Ctx) -> Vec<ItemView> {
    let today = ctx.today();
    let settled = open_settled_through(&snapshot.settings(), today);
    // Autopay went by itself: the balance has its own day's too
    let in_balance = settled_through(&snapshot.settings(), today);
    let mut views: Vec<ItemView> = snapshot
        .items
        .values()
        // (Every item read has a schedule: docs refuses one without)
        .filter_map(|item| {
            let current = current_segment(item, today)?.clone();
            let back = today - Duration::days(400);
            let ahead = today + Duration::days(400);
            let all = item_occurrences(snapshot, item, back, ahead);
            let next = all
                .iter()
                // Open, and not settled by the balance: late ones too, unless on autopay
                .find(|o| {
                    o.status == OccStatus::Open
                        && o.due > if item.autopay { in_balance } else { settled }
                        && (o.due >= today || !item.autopay)
                })
                .map(|o| occurrence_view(o, today, settled));
            let last_done = all
                .iter()
                .filter_map(|o| match o.status {
                    OccStatus::Done { on, .. } => Some((on, o)),
                    _ => None,
                })
                .max_by_key(|(on, _)| *on)
                .map(|(_, o)| occurrence_view(o, today, settled));
            let estimate = estimate(snapshot, item);
            // Its schedule may go on past what's read here (a one-off years ahead)
            let goes_on = item.schedule.iter().any(|segment| {
                segment.from > today
                    || (segment.repeat != Repeat::Once
                        && segment.until.is_none_or(|until| until > today))
            });
            let finished = next.is_none() && !goes_on && all.iter().all(|o| o.due <= today);
            Some(ItemView {
                item: item.clone(),
                next,
                last_done,
                monthly_cents: monthly_cents(item, today, estimate.map(|e| e.cents)),
                estimate,
                started: item.schedule[0].from <= today,
                finished,
                current,
            })
        })
        .collect();
    views.sort_by(|a, b| {
        let due = |view: &ItemView| view.next.as_ref().map(|next| next.due);
        (a.item.archived, due(a).is_none(), due(a), &a.item.name).cmp(&(
            b.item.archived,
            due(b).is_none(),
            due(b),
            &b.item.name,
        ))
    });
    views
}

/// The item's occurrences in [from, to], newest first: its history.
pub fn history(
    snapshot: &Snapshot,
    item_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    ctx: &Ctx,
) -> Option<Vec<OccurrenceView>> {
    let item = snapshot.items.get(item_id)?;
    let today = ctx.today();
    let settled = open_settled_through(&snapshot.settings(), today);
    let (from, to) = (into_calendar(from), into_calendar(to));
    let mut found: Vec<OccurrenceView> = item_occurrences(snapshot, item, from, to)
        .iter()
        .map(|occurrence| occurrence_view(occurrence, today, settled))
        .collect();
    found.reverse();
    Some(found)
}

/// The days of the week, Monday first, as the calendar heads its columns.
pub fn monday_first(date: NaiveDate) -> u32 {
    date.weekday().num_days_from_monday()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::forecast::TaskMint;
    use crate::model::{Repeat, Segment};
    use crate::occur::tests::{d, item, over, put_item, put_over};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 50_000,
                as_of: d(2026, 11, 8),
            }),
            low_balance_cents: 10_000,
            horizon_days: 30,
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 10, 9),
                Repeat::Months { n: 1, day: 9 },
                45_000,
            ),
        );
        put_item(
            &mut s,
            item(
                "phone",
                ItemKind::Bill,
                d(2026, 10, 14),
                Repeat::Months { n: 1, day: 14 },
                6_000,
            ),
        );
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 11, 20),
                Repeat::Weeks { n: 2 },
                30_000,
            ),
        );
        put_item(
            &mut s,
            item(
                "late-pay",
                ItemKind::Income,
                d(2026, 11, 9),
                Repeat::Once,
                5_000,
            ),
        );
        s
    }

    #[test]
    fn the_overview_asks_what_autopay_bills_that_vary_came_to() {
        let mut s = budget();
        // Electric on autopay, varying: Sep 22 (too long ago), Oct 22 (taken
        // at its estimate), Nov 22 (still ahead); water on autopay but not
        // varying; gas varying, not on autopay; heat's Oct 24 has its own amount
        let mut electric = item(
            "electric",
            ItemKind::Bill,
            d(2026, 9, 22),
            Repeat::Months { n: 1, day: 22 },
            9_000,
        );
        electric.autopay = true;
        electric.varies = true;
        let mut heat = electric.clone();
        heat.id = "heat".into();
        heat.schedule[0].repeat = Repeat::Months { n: 1, day: 24 };
        let mut water = electric.clone();
        water.id = "water".into();
        water.varies = false;
        let mut gas = electric.clone();
        gas.id = "gas".into();
        gas.autopay = false;
        for one in [electric, heat, water, gas] {
            put_item(&mut s, one);
        }
        let mut own = over("heat", d(2026, 10, 24), OccStatus::Open);
        own.amount_cents = Some(12_000);
        put_over(&mut s, own);
        let status = TaskMint::default().status;
        let asked = |s: &Snapshot| {
            overview(s, None, &status, &ctx())
                .needs_amount
                .iter()
                .map(|view| (view.item_id.clone(), view.scheduled))
                .collect::<Vec<_>>()
        };
        assert_eq!(asked(&s), [("electric".to_string(), d(2026, 10, 22))]);
        let view = overview(&s, None, &status, &ctx());
        assert!(view.needs_amount[0].varies);
        // Once it's said, it isn't asked again
        put_over(
            &mut s,
            over(
                "electric",
                d(2026, 10, 22),
                OccStatus::Done {
                    on: d(2026, 10, 22),
                    amount_cents: 11_250,
                },
            ),
        );
        assert!(asked(&s).is_empty());
    }

    #[test]
    fn the_overview_says_where_the_balance_goes() {
        let s = budget();
        let status = TaskMint::default().status;
        let view = overview(&s, None, &status, &ctx());
        // Rent (the 9th) is overdue: counted today
        assert_eq!(view.today_cents, 5_000);
        assert_eq!(view.overdue.len(), 1);
        assert_eq!(view.overdue[0].item_id, "rent");
        assert!(view.overdue[0].late);
        assert_eq!(view.late_income[0].item_id, "late-pay");
        // Phone on the 14th takes it below zero
        assert_eq!(
            view.first_short,
            Some(DayBalance {
                date: d(2026, 11, 14),
                cents: -1_000
            })
        );
        assert_eq!(
            view.first_low,
            Some(DayBalance {
                date: d(2026, 11, 10),
                cents: 5_000
            })
        );
        assert_eq!(view.lowest.cents, -1_000);
        assert_eq!(
            view.due_this_week,
            Totals {
                count: 2,
                cents: 51_000
            }
        );
        assert_eq!(view.income_ahead_cents, 30_000);
        let dates: Vec<_> = view.upcoming.iter().map(|day| day.date).collect();
        assert_eq!(dates, vec![d(2026, 11, 14), d(2026, 11, 20)]);
        assert!(view.next_withdrawal.is_none());
        assert!(view.uses_taskmint);
        assert_eq!(view.horizon_days, 30);
    }

    #[test]
    fn the_calendar_shows_a_month_with_its_balances() {
        let mut s = budget();
        put_over(
            &mut s,
            over(
                "phone",
                d(2026, 11, 14),
                OccStatus::Done {
                    on: d(2026, 11, 12),
                    amount_cents: 5_500,
                },
            ),
        );
        put_over(&mut s, over("pay", d(2026, 12, 4), OccStatus::Skipped));
        let view = month(&s, None, "2026-11", &ctx()).unwrap();
        assert_eq!(view.month, "2026-11");
        assert_eq!(view.days.len(), 30);
        let day = |n: usize| &view.days[n - 1];
        // Before the cash flow starts: no balance
        assert_eq!(day(8).closing_cents, None);
        let due_9th: Vec<_> = day(9)
            .occurrences
            .iter()
            .map(|o| o.item_id.as_str())
            .collect();
        assert_eq!(due_9th, vec!["late-pay", "rent"]);
        assert_eq!(day(12).closing_cents, Some(-500));
        assert!(day(12).short);
        assert_eq!(
            day(14).occurrences[0].status,
            OccStatus::Done {
                on: d(2026, 11, 12),
                amount_cents: 5_500
            }
        );
        assert_eq!(view.bills_cents, 45_000 + 5_500);
        assert_eq!(view.income_cents, 30_000 + 5_000);
        // December: skipped pay, and the balance projected past the horizon
        let december = month(&s, None, "2026-12", &ctx()).unwrap();
        assert!(december.days[30].closing_cents.is_some());
        assert_eq!(december.income_cents, 30_000);
        assert!(month(&s, None, "2026-13", &ctx()).is_none());
        assert!(month(&s, None, "nope", &ctx()).is_none());
        // Outside core's calendar (a year typed with a digit too many)
        assert!(month(&s, None, "1899-12", &ctx()).is_none());
        // Far ahead: occurrences, but no balance past what's projected
        let far = month(&s, None, "2029-01", &ctx()).unwrap();
        assert!(far.days[0].closing_cents.is_none());
        assert_eq!(far.days[8].occurrences[0].item_id, "rent");
    }

    #[test]
    fn lists_items_with_their_next_and_last_and_history() {
        let mut s = budget();
        put_over(
            &mut s,
            over(
                "rent",
                d(2026, 10, 9),
                OccStatus::Done {
                    on: d(2026, 10, 9),
                    amount_cents: 45_000,
                },
            ),
        );
        put_over(
            &mut s,
            crate::model::Override {
                note: Some("asked for a week".into()),
                amount_cents: Some(4_321),
                ..over("phone", d(2026, 11, 14), OccStatus::Open)
            },
        );
        let mut old = item("old", ItemKind::Bill, d(2026, 1, 1), Repeat::Once, 1);
        old.archived = true;
        put_item(&mut s, old);
        let views = items(&s, &ctx());
        let names: Vec<_> = views.iter().map(|view| view.item.id.as_str()).collect();
        // Soonest next first; nothing next after; archived last
        assert_eq!(names, vec!["late-pay", "rent", "phone", "pay", "old"]);
        assert_eq!(views[1].next.as_ref().unwrap().due, d(2026, 11, 9));
        assert_eq!(
            views[1].last_done.as_ref().unwrap().scheduled,
            d(2026, 10, 9)
        );
        assert_eq!(views[1].monthly_cents, 45_000);
        assert!(views[2].next.as_ref().unwrap().changed);
        // This time's own amount is told apart from the schedule's
        assert_eq!(views[2].next.as_ref().unwrap().amount_cents, Some(4_321));
        assert_eq!(views[1].next.as_ref().unwrap().amount_cents, None);
        assert_eq!(
            views[2].next.as_ref().unwrap().note.as_deref(),
            Some("asked for a week")
        );
        assert_eq!(views[3].monthly_cents, 30_000 * 3044 / 1400);
        assert!(views[4].next.is_none());

        let rent = history(&s, "rent", d(2026, 10, 1), d(2026, 11, 30), &ctx()).unwrap();
        assert_eq!(rent.len(), 2);
        assert_eq!(rent[0].scheduled, d(2026, 11, 9));
        assert!(history(&s, "nope", d(2026, 10, 1), d(2026, 11, 30), &ctx()).is_none());
        // A window past the calendar's ends is taken to them
        let all = history(&s, "rent", NaiveDate::MIN, NaiveDate::MAX, &ctx()).unwrap();
        assert!(all.len() >= rent.len());
    }

    #[test]
    fn says_which_items_are_finished() {
        let mut s = Snapshot::default();
        // A one-off paid, one still to pay, one due ahead; a loan ended; rent going on
        put_item(
            &mut s,
            item("paid", ItemKind::Bill, d(2026, 11, 2), Repeat::Once, 100),
        );
        put_over(
            &mut s,
            over(
                "paid",
                d(2026, 11, 2),
                OccStatus::Done {
                    on: d(2026, 11, 2),
                    amount_cents: 100,
                },
            ),
        );
        put_item(
            &mut s,
            item("owed", ItemKind::Bill, d(2026, 11, 2), Repeat::Once, 100),
        );
        put_item(
            &mut s,
            item("ahead", ItemKind::Bill, d(2026, 12, 2), Repeat::Once, 100),
        );
        put_item(
            &mut s,
            item("far", ItemKind::Bill, d(2030, 1, 1), Repeat::Once, 100),
        );
        let mut loan = item(
            "loan",
            ItemKind::Bill,
            d(2026, 1, 15),
            Repeat::Months { n: 1, day: 15 },
            100,
        );
        loan.autopay = true;
        loan.schedule[0].until = Some(d(2026, 10, 15));
        put_item(&mut s, loan);
        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 1, 1),
                Repeat::Months { n: 1, day: 1 },
                100,
            ),
        );
        let finished: Vec<(String, bool)> = items(&s, &ctx())
            .into_iter()
            .map(|view| (view.item.id, view.finished))
            .collect();
        for (id, done) in [
            ("paid", true),
            ("owed", false),
            ("ahead", false),
            ("far", false),
            ("loan", true),
            ("rent", false),
        ] {
            assert!(finished.contains(&(id.to_string(), done)), "{}", id);
        }
    }

    #[test]
    fn works_out_what_each_schedule_comes_to_a_month() {
        let today = d(2026, 11, 10);
        let mut every = item(
            "x",
            ItemKind::Bill,
            d(2026, 1, 1),
            Repeat::Days { n: 1 },
            100,
        );
        assert_eq!(monthly_cents(&every, today, None), 3044);
        every.schedule[0].repeat = Repeat::Years { n: 1 };
        assert_eq!(monthly_cents(&every, today, None), 8);
        every.schedule[0].repeat = Repeat::Once;
        assert_eq!(monthly_cents(&every, today, None), 0);
        // The segment in force today, or the first one before any starts
        every.schedule = vec![
            Segment {
                from: d(2026, 1, 1),
                until: None,
                repeat: Repeat::Months { n: 1, day: 1 },
                amount_cents: 100,
                weekends: crate::model::Weekends::Keep,
            },
            Segment {
                from: d(2026, 6, 1),
                until: None,
                repeat: Repeat::Months { n: 2, day: 1 },
                amount_cents: 300,
                weekends: crate::model::Weekends::Keep,
            },
            Segment {
                from: d(2027, 1, 1),
                until: None,
                repeat: Repeat::Months { n: 1, day: 1 },
                amount_cents: 999,
                weekends: crate::model::Weekends::Keep,
            },
        ];
        assert_eq!(monthly_cents(&every, today, None), 150);
        assert_eq!(monthly_cents(&every, d(2025, 1, 1), None), 100);
        // At its estimate, when its amount varies
        assert_eq!(monthly_cents(&every, d(2025, 1, 1), Some(250)), 250);
        every.schedule[0].repeat = Repeat::TwiceMonthly {
            first: 1,
            second: 15,
        };
        assert_eq!(monthly_cents(&every, d(2025, 1, 1), None), 200);
        every.schedule[0].repeat = Repeat::MonthWeekday {
            n: 2,
            week: 1,
            weekday: 4,
        };
        assert_eq!(monthly_cents(&every, d(2025, 1, 1), None), 50);
        // Ended (a loan paid off): nothing a month, until then as before
        every.schedule[2].until = Some(d(2027, 3, 1));
        assert_eq!(monthly_cents(&every, d(2027, 3, 1), None), 999);
        assert_eq!(monthly_cents(&every, d(2027, 3, 2), None), 0);
        every.schedule.clear();
        assert_eq!(monthly_cents(&every, today, None), 0);
        assert_eq!(monday_first(d(2026, 11, 9)), 0);
    }

    #[test]
    fn shows_taskmints_money_and_what_was_paid_on_archived_bills() {
        use crate::forecast::contract::Amount;
        use crate::model::FutureEarnings;
        let mut s = budget();
        let mut settings = s.settings();
        settings.taskmint.future = FutureEarnings::Weekly { cents: 7_000 };
        s.write(DocKey::Settings, Some(&settings));
        let mut old = item(
            "old",
            ItemKind::Bill,
            d(2026, 11, 3),
            Repeat::Months { n: 1, day: 3 },
            100,
        );
        old.archived = true;
        put_item(&mut s, old);
        put_over(
            &mut s,
            over(
                "old",
                d(2026, 11, 3),
                OccStatus::Done {
                    on: d(2026, 11, 3),
                    amount_cents: 100,
                },
            ),
        );
        let forecast_doc = PayoutForecast {
            schema: 1,
            as_of_ms: ctx().now_ms(),
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * crate::time::DAY_MS,
            last_import_ms: None,
            cutoff: None,
            recent_withdrawals: vec![],
            next_allowed_at_ms: None,
            scheduled: None,
            carried: Amount {
                actual_cents: 2_000,
                ..Amount::default()
            },
            carried_days: vec![],
            steps: vec![],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        };
        let view = month(&s, Some(&forecast_doc), "2026-11", &ctx()).unwrap();
        assert_eq!(view.days[2].occurrences[0].item_id, "old");
        // Withdrawn now, in the bank tomorrow
        let tomorrow = &view.days[10];
        assert_eq!(
            (tomorrow.withdrawal_cents, tomorrow.withdrawal_projected),
            (2_000, true)
        );
        // The archived bill's open ones don't show
        let december = month(&s, Some(&forecast_doc), "2026-12", &ctx()).unwrap();
        assert!(december.days[2].occurrences.is_empty());

        let status = TaskMint::default().status;
        let view = forecast(&s, Some(&forecast_doc), &status, &ctx());
        assert_eq!(view.assumed_per_day_cents, 1_000);
        assert_eq!(view.withdrawals[0].total_cents, 2_000);
    }

    #[test]
    fn the_calendar_shows_each_work_days_earnings_and_the_withdrawals_before_the_balance() {
        use crate::forecast::contract::{Amount, CarriedDay, Step, Taken};
        let mut s = budget();
        let now = ctx().now_ms();
        let cents = |actual_cents| Amount {
            actual_cents,
            ..Amount::default()
        };
        // Taken on Nov 7 (in the bank on the 8th, the balance's day) and on Oct 20
        let last = Taken {
            taken_at_ms: now - 3 * crate::time::DAY_MS,
            amount_cents: 2_500,
        };
        let forecast_doc = PayoutForecast {
            schema: 1,
            as_of_ms: now,
            funds_release_days: 7,
            withdrawal_interval_ms: 3 * crate::time::DAY_MS,
            last_import_ms: None,
            cutoff: Some(last),
            recent_withdrawals: vec![
                last,
                Taken {
                    taken_at_ms: now - 21 * crate::time::DAY_MS,
                    amount_cents: 1_800,
                },
            ],
            next_allowed_at_ms: Some(now),
            scheduled: None,
            // The 3rd's and 4th's work released already, the 5th's on the 12th
            carried: cents(1_500),
            carried_days: vec![
                CarriedDay {
                    day: Some(d(2026, 11, 3)),
                    amount: cents(1_000),
                },
                CarriedDay {
                    day: Some(d(2026, 11, 4)),
                    amount: Amount {
                        estimated_cents: 200,
                        ..cents(300)
                    },
                },
            ],
            steps: vec![Step {
                at_ms: now + 2 * crate::time::DAY_MS - 3 * crate::time::HOUR_MS,
                day: Some(d(2026, 11, 5)),
                actual_cents: 700,
                estimated_cents: 0,
                past_due_cents: 0,
                open: None,
            }],
            recent_days: vec![],
            zone: "America/Chicago".into(),
        };
        let view = month(&s, Some(&forecast_doc), "2026-11", &ctx()).unwrap();
        let day = |n: usize| &view.days[n - 1];
        // Each work day's money, until the withdrawal that takes it: today's (in the bank
        // tomorrow), then the one on the 13th (in on the 14th)
        let earned = |n| {
            let day = day(n);
            (
                day.earned_cents,
                day.earned_uncertain_cents,
                day.earned_arrives_on,
            )
        };
        assert_eq!(earned(3), (1_000, 0, Some(d(2026, 11, 11))));
        assert_eq!(earned(4), (500, 200, Some(d(2026, 11, 11))));
        assert_eq!(earned(5), (700, 0, Some(d(2026, 11, 14))));
        assert_eq!(earned(6), (0, 0, None));
        assert_eq!(
            (day(11).withdrawal_cents, day(14).withdrawal_cents),
            (1_500, 700)
        );
        // Released on the 12th, it's in no balance until it arrives
        assert_eq!(day(12).closing_cents, day(11).closing_cents);
        // The one in the bank on the balance's day shows, recorded, before the cash flow starts
        assert_eq!(
            (
                day(8).withdrawal_cents,
                day(8).withdrawal_projected,
                day(8).closing_cents
            ),
            (2_500, false, None)
        );
        assert_eq!(view.withdrawals_cents, 2_500 + 1_500 + 700);
        // And October's
        let october = month(&s, Some(&forecast_doc), "2026-10", &ctx()).unwrap();
        assert_eq!(october.days[20].withdrawal_cents, 1_800);
        assert_eq!(october.withdrawals_cents, 1_800);

        // Not counting TaskMint: none of it
        let mut off = s.settings();
        off.taskmint.use_forecast = false;
        s.write(DocKey::Settings, Some(&off));
        let view = month(&s, Some(&forecast_doc), "2026-11", &ctx()).unwrap();
        assert_eq!((view.withdrawals_cents, view.days[2].earned_cents), (0, 0));
    }

    #[test]
    fn the_forecast_lists_each_day_ahead() {
        let s = budget();
        let status = TaskMint::default().status;
        let view = forecast(&s, None, &status, &ctx());
        assert_eq!(view.days.len(), 31);
        assert_eq!(view.days[0].date, d(2026, 11, 10));
        assert_eq!(view.assumed_per_day_cents, 0);
        assert_eq!(view.low_balance_cents, 10_000);
    }

    #[test]
    fn a_bill_the_balance_settled_isnt_late() {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 10_000,
                as_of: d(2026, 11, 5),
            }),
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        // Never ticked off: the 3rd's is in the balance already, the 7th's is still owed,
        // and so is the one due on the balance's own day
        for (id, day) in [("phone", 3), ("net", 5), ("rent", 7)] {
            let on = Repeat::Months { n: 1, day };
            put_item(
                &mut s,
                item(id, ItemKind::Bill, d(2026, 11, day.into()), on, 100),
            );
        }
        let november = month(&s, None, "2026-11", &ctx()).unwrap();
        let late = |day: usize| november.days[day - 1].occurrences[0].late;
        assert!(!late(3));
        assert!(late(5));
        assert!(late(7));
        let phone = history(&s, "phone", d(2026, 11, 1), d(2026, 11, 30), &ctx()).unwrap();
        assert!(!phone[0].late);
    }

    #[test]
    fn says_what_the_pages_would_otherwise_work_out() {
        let mut s = Snapshot::default();
        let settings = Settings {
            balance: Some(Balance {
                cents: 100_000,
                as_of: d(2026, 11, 9),
            }),
            ..Settings::default()
        };
        s.write(DocKey::Settings, Some(&settings));
        let monthly = |day| Repeat::Months { n: 1, day };
        // Rent: $500 until January, $600 from then; the 12th's is paid for $480
        let mut rent = item("rent", ItemKind::Bill, d(2026, 10, 12), monthly(12), 50_000);
        rent.schedule.push(Segment {
            from: d(2027, 1, 12),
            until: None,
            repeat: monthly(12),
            amount_cents: 60_000,
            weekends: crate::model::Weekends::Keep,
        });
        put_item(&mut s, rent);
        let paid = OccStatus::Done {
            on: d(2026, 11, 10),
            amount_cents: 48_000,
        };
        put_over(&mut s, over("rent", d(2026, 11, 12), paid));
        // Power on the 12th too, skipped; pay that day; a gym that hasn't started
        put_item(
            &mut s,
            item("power", ItemKind::Bill, d(2026, 10, 12), monthly(12), 7_000),
        );
        put_over(&mut s, over("power", d(2026, 11, 12), OccStatus::Skipped));
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 10, 12),
                monthly(12),
                90_000,
            ),
        );
        put_item(
            &mut s,
            item("gym", ItemKind::Bill, d(2026, 11, 20), monthly(20), 3_000),
        );
        // An item without a schedule can't be read; one put there anyway is left out
        let mut none = item("none", ItemKind::Bill, d(2026, 11, 1), Repeat::Once, 1);
        none.schedule.clear();
        s.items.insert("none".into(), none);

        // A day's totals: the paid one at what was paid, the skipped one not at all
        let november = month(&s, None, "2026-11", &ctx()).unwrap();
        let twelfth = &november.days[11];
        assert_eq!(
            (twelfth.bills_cents, twelfth.income_cents),
            (48_000, 90_000)
        );
        assert_eq!(
            (november.days[0].bills_cents, november.days[0].income_cents),
            (0, 0)
        );

        // The schedule in force today, and whether it has begun
        let views = items(&s, &ctx());
        let view = |id: &str| views.iter().find(|view| view.item.id == id).unwrap();
        assert_eq!(view("rent").current.amount_cents, 50_000);
        assert!(view("rent").started);
        assert_eq!(view("gym").current.from, d(2026, 11, 20));
        assert!(!view("gym").started);
        assert!(views.iter().all(|view| view.item.id != "none"));

        // The next bill still to pay: the gym (rent's is paid, the power's skipped)
        let status = TaskMint::default().status;
        let overview = overview(&s, None, &status, &ctx());
        assert_eq!(overview.next_bill.unwrap().item_id, "gym");
    }
}
