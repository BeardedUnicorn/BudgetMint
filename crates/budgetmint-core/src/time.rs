//! When and where a command runs. Core never reads the clock: the client
//! passes the time and its IANA zone with every call, and budget dates are
//! calendar dates in that zone.

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveTime, Offset, TimeZone, Utc, Weekday,
};
use chrono_tz::Tz;

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// The years core's calendar covers. A date outside them is a mistake (a
/// year typed with a digit too many): refused when given, unreadable when
/// stored. That keeps every date core works out well within what chrono
/// can hold, so its date arithmetic can't overflow.
pub const FIRST_YEAR: i32 = 1900;
pub const LAST_YEAR: i32 = 2199;
/// 2200-01-01T00:00:00Z: no instant core takes as now, or reads from
/// TaskMint, comes later.
pub const MAX_MS: i64 = 7_258_118_400_000;

/// Whether `date` is in core's calendar.
pub fn in_calendar(date: NaiveDate) -> bool {
    (FIRST_YEAR..=LAST_YEAR).contains(&date.year())
}

/// `date`, or the calendar's nearer end when it's outside it.
pub fn into_calendar(date: NaiveDate) -> NaiveDate {
    let first = NaiveDate::from_ymd_opt(FIRST_YEAR, 1, 1).expect("the calendar's first day");
    let last = NaiveDate::from_ymd_opt(LAST_YEAR, 12, 31).expect("the calendar's last day");
    date.clamp(first, last)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ctx {
    pub now: DateTime<Utc>,
    pub zone: Tz,
}

impl Ctx {
    /// At `now_ms`, in `zone` (UTC when it isn't a zone core knows). A
    /// clock before 1970 or after 2199 is taken as the nearer end of that.
    pub fn new(now_ms: i64, zone: &str) -> Ctx {
        Ctx {
            now: instant(now_ms.clamp(0, MAX_MS)),
            zone: zone.parse().unwrap_or(Tz::UTC),
        }
    }

    pub fn now_ms(&self) -> i64 {
        self.now.timestamp_millis()
    }

    /// Today's date where the user is.
    pub fn today(&self) -> NaiveDate {
        self.day_of(self.now_ms())
    }

    /// The local date of the instant `ms`.
    pub fn day_of(&self, ms: i64) -> NaiveDate {
        instant(ms).with_timezone(&self.zone).date_naive()
    }

    /// The local weekday and hour of the instant `ms`.
    pub fn weekday_hour(&self, ms: i64) -> (Weekday, u32) {
        let local = instant(ms).with_timezone(&self.zone);
        (local.weekday(), chrono::Timelike::hour(&local))
    }

    /// The instant of `time` on `date` here. One the clocks repeat (falling
    /// back) is the first; one they skip (springing forward) is read with
    /// the offset from before the change, so it's as much later as the
    /// clocks jumped (2:30 in an hour's gap is 3:30).
    pub fn at(&self, date: NaiveDate, time: NaiveTime) -> i64 {
        let local = date.and_time(time);
        match self.zone.from_local_datetime(&local) {
            LocalResult::Single(at) | LocalResult::Ambiguous(at, _) => at.timestamp_millis(),
            LocalResult::None => {
                // Changes are months apart: a day before, the old offset holds
                let before = self
                    .zone
                    .offset_from_utc_datetime(&(local - Duration::days(1)))
                    .fix();
                (local - before).and_utc().timestamp_millis()
            }
        }
    }

    /// The same local time `days` calendar days after the instant `ms` (as
    /// TaskMint's releases are worked out: by the calendar, not 24-hour days).
    pub fn add_days(&self, ms: i64, days: i64) -> i64 {
        let local = instant(ms).with_timezone(&self.zone).naive_local();
        self.at(local.date() + Duration::days(days), local.time())
    }
}

/// The instant `ms` (clamped to what chrono can hold).
pub fn instant(ms: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(ms).unwrap_or(if ms < 0 {
        DateTime::<Utc>::MIN_UTC
    } else {
        DateTime::<Utc>::MAX_UTC
    })
}

/// The hour `hour`:00, as a time of day (midnight for one out of range).
pub fn hour(hour: u8) -> NaiveTime {
    NaiveTime::from_hms_opt(u32::from(hour), 0, 0).unwrap_or(NaiveTime::MIN)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn today_is_where_the_user_is() {
        // 2026-03-02T03:00:00Z: still the 1st in New York
        let ctx = Ctx::new(1_772_420_400_000, "America/New_York");
        assert_eq!(ctx.today(), date(2026, 3, 1));
        assert_eq!(ctx.now_ms(), 1_772_420_400_000);
        assert_eq!(Ctx::new(1_772_420_400_000, "Mars/Olympus").zone, Tz::UTC);
        assert_eq!(ctx.weekday_hour(1_772_420_400_000), (Weekday::Sun, 22));
    }

    #[test]
    fn local_times_survive_daylight_saving() {
        let ctx = Ctx::new(0, "America/New_York");
        // 2026-03-08 02:30 doesn't exist there: 03:30 EDT
        let gap = ctx.at(date(2026, 3, 8), NaiveTime::from_hms_opt(2, 30, 0).unwrap());
        assert_eq!(instant(gap).to_rfc3339(), "2026-03-08T07:30:00+00:00");
        // 2026-11-01 01:30 happens twice: the first (EDT)
        let twice = ctx.at(
            date(2026, 11, 1),
            NaiveTime::from_hms_opt(1, 30, 0).unwrap(),
        );
        assert_eq!(instant(twice).to_rfc3339(), "2026-11-01T05:30:00+00:00");
        // 9:00 a week on keeps 9:00 across the change (not 168 hours)
        let before = ctx.at(date(2026, 3, 5), hour(9));
        let after = ctx.add_days(before, 7);
        assert_eq!(instant(after).to_rfc3339(), "2026-03-12T13:00:00+00:00");
        assert_eq!(after - before, 7 * DAY_MS - HOUR_MS);
    }

    #[test]
    fn clamps_what_it_cant_hold() {
        assert_eq!(instant(i64::MAX), DateTime::<Utc>::MAX_UTC);
        assert_eq!(instant(i64::MIN), DateTime::<Utc>::MIN_UTC);
        assert_eq!(hour(25), NaiveTime::MIN);
        // A clock far off is taken as the calendar's nearer end
        assert_eq!(Ctx::new(i64::MAX, "UTC").today(), date(2200, 1, 1));
        assert_eq!(Ctx::new(-1, "UTC").now_ms(), 0);
        assert!(in_calendar(date(1900, 1, 1)) && in_calendar(date(2199, 12, 31)));
        assert!(!in_calendar(date(1899, 12, 31)) && !in_calendar(date(2200, 1, 1)));
        assert_eq!(instant(MAX_MS).to_rfc3339(), "2200-01-01T00:00:00+00:00");
        assert_eq!(into_calendar(NaiveDate::MIN), date(1900, 1, 1));
        assert_eq!(into_calendar(NaiveDate::MAX), date(2199, 12, 31));
        assert_eq!(into_calendar(date(2026, 11, 11)), date(2026, 11, 11));
    }

    #[test]
    fn a_skipped_time_is_as_much_later_as_the_clocks_jump() {
        // Berlin springs forward at 2:00 local (east of UTC)
        let berlin = Ctx::new(0, "Europe/Berlin");
        let gap = berlin.at(
            date(2026, 3, 29),
            NaiveTime::from_hms_opt(2, 30, 0).unwrap(),
        );
        assert_eq!(instant(gap).to_rfc3339(), "2026-03-29T01:30:00+00:00");
        // Troll jumps two hours, from UTC to UTC+2, at 1:00 UTC
        let troll = Ctx::new(0, "Antarctica/Troll");
        let deep = troll.at(date(2026, 3, 29), NaiveTime::from_hms_opt(2, 0, 0).unwrap());
        assert_eq!(instant(deep).to_rfc3339(), "2026-03-29T02:00:00+00:00");
    }
}
