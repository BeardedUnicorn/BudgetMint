//! The dates a schedule puts an item on. Each date is worked out from the
//! segment's first date, never from the one before, so a bill on the 31st
//! is on Feb 28 and then on Mar 31 again (not the 28th from then on).

use crate::model::{Item, Repeat, Segment};
use chrono::{Datelike, Duration, Months, NaiveDate};

/// No schedule yields more dates than this in one window (a daily item over
/// a year and a bit).
const MAX_DATES: usize = 1000;

/// Days in `month` of `year`.
pub fn days_in_month(year: i32, month: u32) -> u32 {
    (28..=31)
        .rev()
        .find(|day| NaiveDate::from_ymd_opt(year, month, *day).is_some())
        .unwrap_or(28)
}

/// `day` of the month `months` months after `start`'s, clamped to its last day.
fn month_day(start: NaiveDate, months: u32, day: u8) -> Option<NaiveDate> {
    let first = (start - Duration::days(i64::from(start.day0())))
        .checked_add_months(Months::new(months))?;
    let day = u32::from(day).clamp(1, days_in_month(first.year(), first.month()));
    first.with_day(day)
}

/// The segment's dates in [from, to], ending before `next` (the following
/// segment's first date) when there is one.
pub fn segment_dates(
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

    let mut dates = Vec::new();
    match segment.repeat {
        Repeat::Once => dates.extend(Some(start).filter(in_window)),
        Repeat::Days { n } => step_days(start, i64::from(n.max(1)), first, last, &mut dates),
        Repeat::Weeks { n } => step_days(start, 7 * i64::from(n.max(1)), first, last, &mut dates),
        Repeat::Months { n, day } => {
            let n = u32::from(n.max(1));
            // Start from the window's month (less one cycle, for clamping)
            let months_in =
                (first.year() - start.year()) * 12 + first.month() as i32 - start.month() as i32;
            let mut k = (months_in.max(0) as u32 / n).saturating_sub(1);
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

    fn seg(from: NaiveDate, repeat: Repeat) -> Segment {
        Segment {
            from,
            until: None,
            repeat,
            amount_cents: 100,
        }
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
            segment_dates(&daily, None, d(2020, 1, 1), d(2030, 1, 1)).len(),
            MAX_DATES
        );
        let monthly = seg(d(1900, 1, 1), Repeat::Months { n: 1, day: 1 });
        assert_eq!(
            segment_dates(&monthly, None, d(1900, 1, 1), d(2100, 1, 1)).len(),
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
}
