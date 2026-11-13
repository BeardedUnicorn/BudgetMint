//! The dates a schedule puts an item on. Each date is worked out from the
//! segment's first date, never from the one before, so a bill on the 31st
//! is on Feb 28 and then on Mar 31 again (not the 28th from then on). A
//! segment that moves weekend dates moves each one last: the schedule's
//! date is where it moved to.

use crate::model::{Item, Repeat, Segment, Weekends};
use chrono::{Datelike, Duration, Months, NaiveDate, Weekday};

/// No schedule yields more dates than this in one window: a daily item over
/// ten years and a bit, far past any window the views or the cash flow ask
/// for (even from a balance left for years).
const MAX_DATES: usize = 4000;

/// The most dates `first_dates` gives: ten years of weekly ones.
pub const MAX_FIRST_DATES: usize = 520;

/// The furthest a weekend moves a date: Saturday to Monday.
const WEEKEND_DAYS: i64 = 2;

/// Days in `month` of `year`.
pub fn days_in_month(year: i32, month: u32) -> u32 {
    (28..=31)
        .rev()
        .find(|day| NaiveDate::from_ymd_opt(year, month, *day).is_some())
        .unwrap_or(28)
}

/// The first day of the month `months` months after `start`'s.
fn month_start(start: NaiveDate, months: u32) -> Option<NaiveDate> {
    (start - Duration::days(i64::from(start.day0()))).checked_add_months(Months::new(months))
}

/// `day` of the month `months` months after `start`'s, clamped to its last day.
fn month_day(start: NaiveDate, months: u32, day: u8) -> Option<NaiveDate> {
    let first = month_start(start, months)?;
    let day = u32::from(day).clamp(1, days_in_month(first.year(), first.month()));
    first.with_day(day)
}

/// The `weekday` (0 Monday … 6 Sunday) of `first`'s month's `week`th week
/// (1–4; 5, or more, is its last): `first` is the month's first day.
fn month_weekday(first: NaiveDate, week: u8, weekday: u8) -> Option<NaiveDate> {
    let want = u32::from(weekday % 7);
    if week >= 5 {
        let last = first
            .with_day(days_in_month(first.year(), first.month()))
            .expect("a month has its last day");
        let back = (7 + last.weekday().num_days_from_monday() - want) % 7;
        return last.checked_sub_signed(Duration::days(i64::from(back)));
    }
    let ahead = (7 + want - first.weekday().num_days_from_monday()) % 7;
    first.checked_add_signed(Duration::days(
        i64::from(ahead) + 7 * i64::from(week.max(1) - 1),
    ))
}

/// Where `date` goes under `weekends`.
pub fn move_weekend(date: NaiveDate, weekends: Weekends) -> NaiveDate {
    let days = match (weekends, date.weekday()) {
        (Weekends::Before, Weekday::Sat) => -1,
        (Weekends::Before, Weekday::Sun) => -2,
        (Weekends::After, Weekday::Sat) => 2,
        (Weekends::After, Weekday::Sun) => 1,
        _ => 0,
    };
    date.checked_add_signed(Duration::days(days))
        .unwrap_or(date)
}

/// A schedule's first `count` dates from `from` (at most MAX_FIRST_DATES):
/// each as the schedule has it, and where a weekend moves it. What the item
/// form shows of a schedule before it's saved (its first date, its last
/// after so many).
pub fn first_dates(
    from: NaiveDate,
    repeat: Repeat,
    weekends: Weekends,
    count: usize,
) -> Vec<(NaiveDate, NaiveDate)> {
    let count = count.min(MAX_FIRST_DATES);
    let segment = Segment {
        from,
        until: None,
        repeat,
        amount_cents: 0,
        weekends: Weekends::Keep,
    };
    // Wide enough for `count` of them at the most days apart this repeat goes
    let apart = match repeat {
        Repeat::Once => 0,
        Repeat::Days { n } => i64::from(n),
        Repeat::Weeks { n } => 7 * i64::from(n),
        Repeat::Months { n, .. } | Repeat::MonthWeekday { n, .. } => 31 * i64::from(n),
        Repeat::TwiceMonthly { .. } => 31,
        Repeat::Years { n } => 366 * i64::from(n),
    };
    let to = from
        .checked_add_signed(Duration::days(apart * count as i64 + 31))
        .unwrap_or(NaiveDate::MAX);
    schedule_dates(&segment, None, from, to)
        .into_iter()
        .take(count)
        .map(|date| (date, move_weekend(date, weekends)))
        .collect()
}

/// The segment's dates in [from, to], ending before `next` (the following
/// segment's first date) when there is one. `from`, `until` and `next`
/// bound the dates as the schedule has them, before a weekend moves them;
/// the window, where they end up.
pub fn segment_dates(
    segment: &Segment,
    next: Option<NaiveDate>,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<NaiveDate> {
    if segment.weekends == Weekends::Keep {
        return schedule_dates(segment, next, from, to);
    }
    let wide = Duration::days(WEEKEND_DAYS);
    let mut dates = schedule_dates(
        segment,
        next,
        from.checked_sub_signed(wide).unwrap_or(from),
        to.checked_add_signed(wide).unwrap_or(to),
    );
    for date in &mut dates {
        *date = move_weekend(*date, segment.weekends);
    }
    // A Friday a Saturday and Sunday moved to as well is one date
    dates.dedup();
    dates.retain(|date| *date >= from && *date <= to);
    dates
}

/// The segment's dates in [from, to], before weekends move them.
fn schedule_dates(
    segment: &Segment,
    next: Option<NaiveDate>,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<NaiveDate> {
    let mut last = to;
    if let Some(until) = segment.until {
        last = last.min(until);
    }
    if let Some(next) = next {
        last = last.min(next.pred_opt().unwrap_or(next));
    }
    let start = segment.from;
    let first = from.max(start);
    if first > last {
        return Vec::new();
    }
    let in_window = |date: &NaiveDate| *date >= first && *date <= last;
    // The months from the window's (less one cycle, for clamping), every `n`
    let months_in =
        (first.year() - start.year()) * 12 + first.month() as i32 - start.month() as i32;
    let first_cycle = |n: u32| (months_in.max(0) as u32 / n).saturating_sub(1);

    let mut dates = Vec::new();
    match segment.repeat {
        Repeat::Once => dates.extend(Some(start).filter(in_window)),
        Repeat::Days { n } => step_days(start, i64::from(n.max(1)), first, last, &mut dates),
        Repeat::Weeks { n } => step_days(start, 7 * i64::from(n.max(1)), first, last, &mut dates),
        Repeat::Months { n, day } => {
            let n = u32::from(n.max(1));
            let mut k = first_cycle(n);
            while let Some(date) = month_day(start, k * n, day) {
                if date > last || dates.len() == MAX_DATES {
                    break;
                }
                if in_window(&date) {
                    dates.push(date);
                }
                k += 1;
            }
        }
        Repeat::TwiceMonthly {
            first: a,
            second: b,
        } => {
            let (a, b) = (a.min(b), a.max(b));
            let mut k = first_cycle(1);
            while let Some(month) = month_start(start, k) {
                if month > last || dates.len() >= MAX_DATES {
                    break;
                }
                let pair = [month_day(start, k, a), month_day(start, k, b)];
                // The 30th and the 31st are one date in February
                for date in pair.into_iter().flatten() {
                    if in_window(&date) && dates.last() != Some(&date) && dates.len() < MAX_DATES {
                        dates.push(date);
                    }
                }
                k += 1;
            }
        }
        Repeat::MonthWeekday { n, week, weekday } => {
            let n = u32::from(n.max(1));
            let mut k = first_cycle(n);
            while let Some(month) = month_start(start, k * n) {
                if month > last || dates.len() == MAX_DATES {
                    break;
                }
                if let Some(date) = month_weekday(month, week, weekday).filter(in_window) {
                    dates.push(date);
                }
                k += 1;
            }
        }
        Repeat::Years { n } => {
            let n = u32::from(n.max(1));
            let years_in = (first.year() - start.year()).max(0) as u32;
            let mut k = (years_in / n).saturating_sub(1);
            while let Some(date) = month_day(start, k * n * 12, start.day() as u8) {
                if date > last || dates.len() == MAX_DATES {
                    break;
                }
                if in_window(&date) {
                    dates.push(date);
                }
                k += 1;
            }
        }
    }
    dates
}

/// Every `n` days from `start`, in [first, last].
fn step_days(
    start: NaiveDate,
    n: i64,
    first: NaiveDate,
    last: NaiveDate,
    out: &mut Vec<NaiveDate>,
) {
    // The first step on or after `first`
    let behind = (first - start).num_days().max(0);
    let mut date = start + Duration::days((behind + n - 1) / n * n);
    while date <= last && out.len() < MAX_DATES {
        out.push(date);
        date += Duration::days(n);
    }
}

/// The item's dates in [from, to], each with the segment it comes from.
pub fn item_dates(item: &Item, from: NaiveDate, to: NaiveDate) -> Vec<(NaiveDate, &Segment)> {
    let mut dates = Vec::new();
    for (index, segment) in item.schedule.iter().enumerate() {
        let next = item.schedule.get(index + 1).map(|next| next.from);
        dates.extend(
            segment_dates(segment, next, from, to)
                .into_iter()
                .map(|date| (date, segment)),
        );
    }
    dates
}

/// Whether the item's schedule puts it on `date`.
pub fn is_item_date(item: &Item, date: NaiveDate) -> bool {
    !item_dates(item, date, date).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn gives_a_schedules_first_dates_and_where_weekends_move_them() {
        let firsts = |from: NaiveDate, repeat: Repeat, count: usize| {
            first_dates(from, repeat, Weekends::Keep, count)
                .into_iter()
                .map(|(date, _)| date)
                .collect::<Vec<_>>()
        };
        // Monthly on the 1st from Nov 11: the first is Dec 1
        assert_eq!(
            firsts(d(2026, 11, 11), Repeat::Months { n: 1, day: 1 }, 2),
            [d(2026, 12, 1), d(2027, 1, 1)]
        );
        // The 14th of a loan's payments
        assert_eq!(
            firsts(d(2026, 11, 15), Repeat::Months { n: 1, day: 15 }, 14).last(),
            Some(&d(2027, 12, 15))
        );
        assert_eq!(firsts(d(2026, 11, 13), Repeat::Once, 3), [d(2026, 11, 13)]);
        assert_eq!(
            firsts(d(2026, 11, 13), Repeat::Days { n: 10 }, 2),
            [d(2026, 11, 13), d(2026, 11, 23)]
        );
        assert_eq!(
            firsts(d(2026, 11, 13), Repeat::Weeks { n: 2 }, 2),
            [d(2026, 11, 13), d(2026, 11, 27)]
        );
        assert_eq!(
            firsts(
                d(2026, 11, 13),
                Repeat::TwiceMonthly {
                    first: 1,
                    second: 15
                },
                2
            ),
            [d(2026, 11, 15), d(2026, 12, 1)]
        );
        assert_eq!(
            firsts(
                d(2026, 11, 1),
                Repeat::MonthWeekday {
                    n: 1,
                    week: 2,
                    weekday: 4
                },
                1
            ),
            [d(2026, 11, 13)]
        );
        assert_eq!(
            firsts(d(2026, 11, 13), Repeat::Years { n: 10 }, 2),
            [d(2026, 11, 13), d(2036, 11, 13)]
        );
        // At most ten years of weekly ones
        assert_eq!(
            firsts(d(2026, 11, 13), Repeat::Weeks { n: 1 }, 1000).len(),
            MAX_FIRST_DATES
        );
        // Sat Nov 14 moves to the Monday after
        assert_eq!(
            first_dates(d(2026, 11, 14), Repeat::Once, Weekends::After, 1),
            [(d(2026, 11, 14), d(2026, 11, 16))]
        );
    }

    fn seg(from: NaiveDate, repeat: Repeat) -> Segment {
        Segment {
            from,
            until: None,
            repeat,
            amount_cents: 100,
            weekends: Weekends::Keep,
        }
    }

    fn moved(segment: Segment, weekends: Weekends) -> Segment {
        Segment {
            weekends,
            ..segment
        }
    }

    #[test]
    fn twice_a_month_on_two_days() {
        let pay = seg(
            d(2026, 11, 1),
            Repeat::TwiceMonthly {
                first: 1,
                second: 15,
            },
        );
        assert_eq!(
            segment_dates(&pay, None, d(2026, 11, 10), d(2027, 1, 5)),
            vec![
                d(2026, 11, 15),
                d(2026, 12, 1),
                d(2026, 12, 15),
                d(2027, 1, 1)
            ]
        );
        // The 15th and the last day, from a first date after the 15th
        let late = seg(
            d(2026, 1, 20),
            Repeat::TwiceMonthly {
                first: 15,
                second: 31,
            },
        );
        assert_eq!(
            segment_dates(&late, None, d(2026, 1, 1), d(2026, 3, 1)),
            vec![d(2026, 1, 31), d(2026, 2, 15), d(2026, 2, 28)]
        );
        // The 30th and 31st are one date in February; days given the wrong way round still read
        let end = seg(
            d(2026, 2, 1),
            Repeat::TwiceMonthly {
                first: 31,
                second: 30,
            },
        );
        assert_eq!(
            segment_dates(&end, None, d(2026, 2, 1), d(2026, 3, 31)),
            vec![d(2026, 2, 28), d(2026, 3, 30), d(2026, 3, 31)]
        );
    }

    #[test]
    fn a_weekday_of_a_week_of_the_month() {
        // The second Friday: Nov 13, Dec 11, Jan 8
        let second_friday = seg(
            d(2026, 11, 1),
            Repeat::MonthWeekday {
                n: 1,
                week: 2,
                weekday: 4,
            },
        );
        assert_eq!(
            segment_dates(&second_friday, None, d(2026, 11, 1), d(2027, 1, 31)),
            vec![d(2026, 11, 13), d(2026, 12, 11), d(2027, 1, 8)]
        );
        // The last Monday, every other month, from mid-month: November's is past already
        let last_monday = seg(
            d(2026, 11, 2),
            Repeat::MonthWeekday {
                n: 2,
                week: 5,
                weekday: 0,
            },
        );
        assert_eq!(
            segment_dates(&last_monday, None, d(2026, 11, 1), d(2027, 3, 31)),
            vec![d(2026, 11, 30), d(2027, 1, 25), d(2027, 3, 29)]
        );
        // The first Sunday, when the month starts on one; week 0 reads as the first
        let first_sunday = seg(
            d(2026, 11, 1),
            Repeat::MonthWeekday {
                n: 0,
                week: 0,
                weekday: 6,
            },
        );
        assert_eq!(
            segment_dates(&first_sunday, None, d(2026, 11, 1), d(2026, 12, 31)),
            vec![d(2026, 11, 1), d(2026, 12, 6)]
        );
        // A first date after this month's: from the next
        let third_tuesday = seg(
            d(2026, 11, 20),
            Repeat::MonthWeekday {
                n: 1,
                week: 3,
                weekday: 1,
            },
        );
        assert_eq!(
            segment_dates(&third_tuesday, None, d(2026, 11, 1), d(2026, 12, 31)),
            vec![d(2026, 12, 15)]
        );
    }

    #[test]
    fn weekends_move_to_the_friday_before_or_the_monday_after() {
        // The 15th: Saturday Aug 15, Tuesday Sep 15, Thursday Oct 15, Sunday Nov 15
        let pay = seg(d(2026, 8, 15), Repeat::Months { n: 1, day: 15 });
        let window = (d(2026, 8, 1), d(2026, 11, 30));
        assert_eq!(
            segment_dates(
                &moved(pay.clone(), Weekends::Before),
                None,
                window.0,
                window.1
            ),
            vec![
                d(2026, 8, 14),
                d(2026, 9, 15),
                d(2026, 10, 15),
                d(2026, 11, 13)
            ]
        );
        assert_eq!(
            segment_dates(
                &moved(pay.clone(), Weekends::After),
                None,
                window.0,
                window.1
            ),
            vec![
                d(2026, 8, 17),
                d(2026, 9, 15),
                d(2026, 10, 15),
                d(2026, 11, 16)
            ]
        );
        assert_eq!(move_weekend(d(2026, 8, 15), Weekends::Keep), d(2026, 8, 15));
        // A first date on a Sunday still counts, on the Friday before it starts
        let before = moved(pay.clone(), Weekends::Before);
        assert_eq!(
            segment_dates(&before, None, d(2026, 11, 13), d(2026, 11, 13)),
            vec![d(2026, 11, 13)]
        );
        // A window just past where a weekend date moved from has it
        let after = moved(pay, Weekends::After);
        assert_eq!(
            segment_dates(&after, None, d(2026, 11, 16), d(2026, 11, 16)),
            vec![d(2026, 11, 16)]
        );
        assert!(segment_dates(&after, None, d(2026, 11, 15), d(2026, 11, 15)).is_empty());
        // Every day, moving weekends to Friday: Friday is one date, not three
        let daily = moved(
            seg(d(2026, 11, 13), Repeat::Days { n: 1 }),
            Weekends::Before,
        );
        assert_eq!(
            segment_dates(&daily, None, d(2026, 11, 13), d(2026, 11, 17)),
            vec![d(2026, 11, 13), d(2026, 11, 16), d(2026, 11, 17)]
        );
        // At the calendar's very ends, a date that can't move stays
        assert_eq!(
            move_weekend(NaiveDate::MAX, Weekends::After),
            NaiveDate::MAX
        );
        let edge = moved(seg(NaiveDate::MIN, Repeat::Days { n: 1 }), Weekends::Before);
        assert_eq!(
            segment_dates(&edge, None, NaiveDate::MIN, NaiveDate::MIN).len(),
            1
        );
        let edge = moved(seg(NaiveDate::MAX, Repeat::Once), Weekends::After);
        assert_eq!(
            segment_dates(&edge, None, NaiveDate::MAX, NaiveDate::MAX).len(),
            1
        );
    }

    #[test]
    fn months_clamp_to_short_months_and_come_back() {
        let rent = seg(d(2026, 1, 31), Repeat::Months { n: 1, day: 31 });
        let dates = segment_dates(&rent, None, d(2026, 1, 1), d(2026, 5, 31));
        assert_eq!(
            dates,
            vec![
                d(2026, 1, 31),
                d(2026, 2, 28),
                d(2026, 3, 31),
                d(2026, 4, 30),
                d(2026, 5, 31)
            ]
        );
        // Two years on, from the anchor: February in a leap year, then back to the 31st
        let later = segment_dates(&rent, None, d(2028, 2, 1), d(2028, 3, 31));
        assert_eq!(later, vec![d(2028, 2, 29), d(2028, 3, 31)]);
        // Every third month on the 15th, starting after the 15th: the first is next cycle's
        let quarterly = seg(d(2026, 1, 20), Repeat::Months { n: 3, day: 15 });
        assert_eq!(
            segment_dates(&quarterly, None, d(2026, 1, 1), d(2026, 12, 31)),
            vec![d(2026, 4, 15), d(2026, 7, 15), d(2026, 10, 15)]
        );
        // A window starting mid-cycle
        assert_eq!(
            segment_dates(&quarterly, None, d(2026, 8, 1), d(2027, 1, 31)),
            vec![d(2026, 10, 15), d(2027, 1, 15)]
        );
    }

    #[test]
    fn days_weeks_and_years_count_from_the_first_date() {
        let biweekly = seg(d(2026, 11, 6), Repeat::Weeks { n: 2 });
        assert_eq!(
            segment_dates(&biweekly, None, d(2026, 11, 10), d(2026, 12, 31)),
            vec![d(2026, 11, 20), d(2026, 12, 4), d(2026, 12, 18)]
        );
        let every10 = seg(d(2026, 11, 1), Repeat::Days { n: 10 });
        assert_eq!(
            segment_dates(&every10, None, d(2026, 11, 1), d(2026, 11, 30)),
            vec![d(2026, 11, 1), d(2026, 11, 11), d(2026, 11, 21)]
        );
        // n = 0 reads as 1
        let daily = seg(d(2026, 11, 1), Repeat::Days { n: 0 });
        assert_eq!(
            segment_dates(&daily, None, d(2026, 11, 2), d(2026, 11, 3)).len(),
            2
        );
        let weekly0 = seg(d(2026, 11, 1), Repeat::Weeks { n: 0 });
        assert_eq!(
            segment_dates(&weekly0, None, d(2026, 11, 1), d(2026, 11, 15)).len(),
            3
        );
        let leap = seg(d(2024, 2, 29), Repeat::Years { n: 1 });
        assert_eq!(
            segment_dates(&leap, None, d(2024, 1, 1), d(2028, 12, 31)),
            vec![
                d(2024, 2, 29),
                d(2025, 2, 28),
                d(2026, 2, 28),
                d(2027, 2, 28),
                d(2028, 2, 29)
            ]
        );
        let every2 = seg(d(2020, 6, 1), Repeat::Years { n: 2 });
        assert_eq!(
            segment_dates(&every2, None, d(2025, 1, 1), d(2028, 12, 31)),
            vec![d(2026, 6, 1), d(2028, 6, 1)]
        );
        let monthly0 = seg(d(2026, 1, 5), Repeat::Months { n: 0, day: 5 });
        assert_eq!(
            segment_dates(&monthly0, None, d(2026, 1, 1), d(2026, 3, 31)).len(),
            3
        );
        let yearly0 = seg(d(2026, 1, 5), Repeat::Years { n: 0 });
        assert_eq!(
            segment_dates(&yearly0, None, d(2026, 1, 1), d(2027, 3, 31)).len(),
            2
        );
    }

    #[test]
    fn segments_end_at_their_until_or_the_next_one() {
        let once = seg(d(2026, 11, 15), Repeat::Once);
        assert_eq!(
            segment_dates(&once, None, d(2026, 11, 1), d(2026, 11, 30)),
            vec![d(2026, 11, 15)]
        );
        assert!(segment_dates(&once, None, d(2026, 11, 16), d(2026, 11, 30)).is_empty());
        let mut weekly = seg(d(2026, 11, 2), Repeat::Weeks { n: 1 });
        weekly.until = Some(d(2026, 11, 16));
        assert_eq!(
            segment_dates(&weekly, None, d(2026, 11, 1), d(2026, 12, 31)).len(),
            3
        );
        assert_eq!(
            segment_dates(
                &weekly,
                Some(d(2026, 11, 9)),
                d(2026, 11, 1),
                d(2026, 12, 31)
            ),
            vec![d(2026, 11, 2)]
        );
        // A window before the segment starts
        assert!(segment_dates(&weekly, None, d(2026, 10, 1), d(2026, 10, 31)).is_empty());
        // The very first representable date as the next segment's start
        assert!(segment_dates(
            &weekly,
            Some(NaiveDate::MIN),
            d(2026, 11, 1),
            d(2026, 12, 31)
        )
        .is_empty());
    }

    #[test]
    fn an_item_runs_its_segments_one_after_another() {
        let item = Item {
            id: "phone".into(),
            kind: crate::model::ItemKind::Bill,
            name: "Phone".into(),
            category: None,
            schedule: vec![
                seg(d(2026, 1, 10), Repeat::Months { n: 1, day: 10 }),
                Segment {
                    amount_cents: 200,
                    ..seg(d(2026, 3, 20), Repeat::Months { n: 1, day: 20 })
                },
            ],
            autopay: false,
            reminder: None,
            archived: false,
            note: None,
            varies: false,
            save_up: None,
            account_id: None,
            to_account_id: None,
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
        };
        let dates: Vec<_> = item_dates(&item, d(2026, 1, 1), d(2026, 4, 30))
            .into_iter()
            .map(|(date, segment)| (date, segment.amount_cents))
            .collect();
        assert_eq!(
            dates,
            vec![
                (d(2026, 1, 10), 100),
                (d(2026, 2, 10), 100),
                (d(2026, 3, 10), 100),
                (d(2026, 3, 20), 200),
                (d(2026, 4, 20), 200)
            ]
        );
        assert!(is_item_date(&item, d(2026, 3, 10)));
        assert!(!is_item_date(&item, d(2026, 4, 10)));
    }

    #[test]
    fn stops_at_a_sane_number_of_dates() {
        let daily = seg(d(2020, 1, 1), Repeat::Days { n: 1 });
        assert_eq!(
            segment_dates(&daily, None, d(2020, 1, 1), d(2040, 1, 1)).len(),
            MAX_DATES
        );
        let monthly = seg(d(1900, 1, 1), Repeat::Months { n: 1, day: 1 });
        assert_eq!(
            segment_dates(&monthly, None, d(1900, 1, 1), d(2300, 1, 1)).len(),
            MAX_DATES
        );
        let yearly = seg(d(-200_000, 1, 1), Repeat::Years { n: 1 });
        assert_eq!(
            segment_dates(&yearly, None, d(-200_000, 1, 1), d(200_000, 1, 1)).len(),
            MAX_DATES
        );
        // A schedule whose dates run off the calendar just ends
        let far = seg(
            NaiveDate::MAX.with_day(1).unwrap(),
            Repeat::Months { n: 1, day: 1 },
        );
        assert_eq!(
            segment_dates(
                &far,
                None,
                NaiveDate::MAX.with_day(1).unwrap(),
                NaiveDate::MAX
            )
            .len(),
            1
        );
        let far_years = seg(NaiveDate::MAX.with_day(1).unwrap(), Repeat::Years { n: 1 });
        assert_eq!(
            segment_dates(
                &far_years,
                None,
                NaiveDate::MAX.with_day(1).unwrap(),
                NaiveDate::MAX
            )
            .len(),
            1
        );
    }

    #[test]
    fn knows_each_months_length() {
        assert_eq!(days_in_month(2026, 2), 28);
        assert_eq!(days_in_month(2028, 2), 29);
        assert_eq!(days_in_month(2026, 12), 31);
        assert_eq!(days_in_month(2026, 4), 30);
    }

    /// Every schedule of each kind from many first dates (leap days and
    /// month ends among them), over windows split at many points: the dates
    /// are the schedule's, in order, and asking for a window in two parts
    /// gives exactly what asking for it whole does (the windows skip ahead
    /// to where they start, so that's where an off-by-one would show).
    #[test]
    fn every_window_agrees_with_the_schedule_and_with_its_parts() {
        let repeats = [
            Repeat::Once,
            Repeat::Days { n: 1 },
            Repeat::Days { n: 3 },
            Repeat::Days { n: 45 },
            Repeat::Weeks { n: 1 },
            Repeat::Weeks { n: 3 },
            Repeat::Months { n: 1, day: 1 },
            Repeat::Months { n: 1, day: 29 },
            Repeat::Months { n: 1, day: 31 },
            Repeat::Months { n: 2, day: 30 },
            Repeat::Months { n: 3, day: 15 },
            Repeat::Months { n: 12, day: 31 },
            Repeat::TwiceMonthly {
                first: 1,
                second: 15,
            },
            Repeat::TwiceMonthly {
                first: 15,
                second: 31,
            },
            Repeat::TwiceMonthly {
                first: 29,
                second: 30,
            },
            Repeat::MonthWeekday {
                n: 1,
                week: 2,
                weekday: 4,
            },
            Repeat::MonthWeekday {
                n: 2,
                week: 5,
                weekday: 0,
            },
            Repeat::MonthWeekday {
                n: 3,
                week: 1,
                weekday: 6,
            },
            Repeat::Years { n: 1 },
            Repeat::Years { n: 4 },
        ];
        let weekends = [Weekends::Keep, Weekends::Before, Weekends::After];
        let window = (d(2026, 1, 1), d(2029, 12, 31));
        let mut checked = 0;
        // First dates from 2023 into 2028, every 37 days and each month's last day
        let mut starts: Vec<NaiveDate> = (0..60)
            .map(|k| d(2023, 1, 5) + Duration::days(37 * k))
            .collect();
        starts.extend((0..72).map(|k| {
            let month = d(2023, 1, 1).checked_add_months(Months::new(k)).unwrap();
            month
                .with_day(days_in_month(month.year(), month.month()))
                .unwrap()
        }));
        starts.push(d(2024, 2, 29));
        for start in starts {
            for (repeat, weekends) in repeats
                .iter()
                .flat_map(|repeat| weekends.iter().map(move |weekends| (*repeat, *weekends)))
            {
                let segment = moved(seg(start, repeat), weekends);
                let whole = segment_dates(&segment, None, window.0, window.1);
                assert!(
                    whole.windows(2).all(|pair| pair[0] < pair[1]),
                    "{:?}",
                    segment
                );
                for date in &whole {
                    assert!(*date >= window.0 && *date <= window.1);
                    // A schedule's date from the first on, or one a weekend moved here
                    let from = (-WEEKEND_DAYS..=WEEKEND_DAYS)
                        .map(|days| *date + Duration::days(days))
                        .filter(|x| *x >= start && move_weekend(*x, weekends) == *date)
                        .find(|x| on_schedule(&segment, *x));
                    assert!(from.is_some(), "{:?} on {}", segment, date);
                    if weekends == Weekends::Keep {
                        assert_eq!(from, Some(*date));
                    }
                }
                // Split anywhere: the same dates
                for split in (0..=1460).step_by(53) {
                    let at = window.0 + Duration::days(split);
                    let mut parts = segment_dates(&segment, None, window.0, at);
                    parts.extend(segment_dates(
                        &segment,
                        None,
                        at + Duration::days(1),
                        window.1,
                    ));
                    assert_eq!(parts, whole, "{:?} split at {}", segment, at);
                    checked += 1;
                }
            }
        }
        assert!(checked > 50_000);
    }

    /// Whether `date` is one of `segment`'s, worked out from its first date
    /// alone (not as segment_dates steps to it).
    fn on_schedule(segment: &Segment, date: NaiveDate) -> bool {
        let start = segment.from;
        let months = |date: NaiveDate| date.year() * 12 + date.month() as i32;
        match segment.repeat {
            Repeat::Once => date == start,
            Repeat::Days { n } => (date - start).num_days() % i64::from(n) == 0,
            Repeat::Weeks { n } => (date - start).num_days() % (7 * i64::from(n)) == 0,
            Repeat::Months { n, day } => {
                let apart = months(date) - months(start);
                apart % i32::from(n) == 0
                    && date.day() == u32::from(day).min(days_in_month(date.year(), date.month()))
            }
            Repeat::TwiceMonthly { first, second } => {
                let last = days_in_month(date.year(), date.month());
                [first, second]
                    .iter()
                    .any(|day| date.day() == u32::from(*day).min(last))
            }
            Repeat::MonthWeekday { n, week, weekday } => {
                let apart = months(date) - months(start);
                let last = days_in_month(date.year(), date.month());
                let in_week = if week == 5 {
                    date.day() + 7 > last
                } else {
                    (date.day() - 1) / 7 == u32::from(week) - 1
                };
                apart % i32::from(n) == 0
                    && date.weekday().num_days_from_monday() == u32::from(weekday)
                    && in_week
            }
            Repeat::Years { n } => {
                let apart = date.year() - start.year();
                date.month() == start.month()
                    && apart % i32::from(n) == 0
                    && date.day() == start.day().min(days_in_month(date.year(), date.month()))
            }
        }
    }

    #[test]
    fn new_schedules_stop_at_a_sane_number_of_dates_too() {
        let twice = seg(
            d(1900, 1, 1),
            Repeat::TwiceMonthly {
                first: 1,
                second: 15,
            },
        );
        assert_eq!(
            segment_dates(&twice, None, d(1900, 1, 1), d(2300, 1, 1)).len(),
            MAX_DATES
        );
        let weekday = seg(
            d(1700, 1, 1),
            Repeat::MonthWeekday {
                n: 1,
                week: 1,
                weekday: 0,
            },
        );
        assert_eq!(
            segment_dates(&weekday, None, d(1700, 1, 1), d(2300, 1, 1)).len(),
            MAX_DATES
        );
        // At the calendar's end they just stop
        let far = NaiveDate::MAX.with_day(1).unwrap();
        for repeat in [
            Repeat::TwiceMonthly {
                first: 1,
                second: 31,
            },
            Repeat::MonthWeekday {
                n: 1,
                week: 5,
                weekday: 2,
            },
        ] {
            assert!(segment_dates(&seg(far, repeat), None, far, NaiveDate::MAX).len() <= 2);
        }
        // The first week's weekday before the calendar's first day isn't there
        let early = NaiveDate::MIN;
        assert!(month_weekday(early, 1, 0).is_some());
    }
}
