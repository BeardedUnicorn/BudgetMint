//! Occurrences: each date an item's schedule puts it on, with what the user
//! said about it (crate::model::Override), when it's due (it may have been
//! moved) and what it's expected to be.

use crate::docs::Snapshot;
use crate::model::{Cents, Item, OccStatus, Override};
use crate::recur::item_dates;
use chrono::{Duration, NaiveDate};

/// How far an occurrence may be moved from its date (either way).
pub const MOVE_DAYS: i64 = 62;

#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence<'a> {
    pub item: &'a Item,
    /// The schedule's date: which occurrence it is.
    pub scheduled: NaiveDate,
    /// When it's due: the schedule's date, or where it was moved.
    pub due: NaiveDate,
    pub expected_cents: Cents,
    pub status: OccStatus,
    pub over: Option<&'a Override>,
}

/// The item's occurrences due in [from, to], soonest first. A paid one the
/// schedule no longer has (it changed since) still counts: the money moved.
pub fn item_occurrences<'a>(
    snapshot: &'a Snapshot,
    item: &'a Item,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<Occurrence<'a>> {
    let wide_from = from - Duration::days(MOVE_DAYS);
    let wide_to = to + Duration::days(MOVE_DAYS);
    let overrides = snapshot
        .overrides
        .range((item.id.clone(), wide_from)..=(item.id.clone(), wide_to));

    let mut found: Vec<Occurrence<'a>> = Vec::new();
    let dates = item_dates(item, wide_from, wide_to);
    for (date, segment) in &dates {
        let over = snapshot.overrides.get(&(item.id.clone(), *date));
        found.push(Occurrence {
            item,
            scheduled: *date,
            due: over.and_then(|over| over.moved_to).unwrap_or(*date),
            expected_cents: over
                .and_then(|over| over.amount_cents)
                .unwrap_or(segment.amount_cents),
            status: over.map_or(OccStatus::Open, |over| over.status.clone()),
            over,
        });
    }
    for (_, over) in overrides {
        let paid = matches!(over.status, OccStatus::Done { .. });
        if paid && !dates.iter().any(|(date, _)| *date == over.date) {
            found.push(Occurrence {
                item,
                scheduled: over.date,
                due: over.moved_to.unwrap_or(over.date),
                expected_cents: over.amount_cents.unwrap_or(0),
                status: over.status.clone(),
                over: Some(over),
            });
        }
    }
    found.retain(|occurrence| occurrence.due >= from && occurrence.due <= to);
    found.sort_by_key(|occurrence| (occurrence.due, occurrence.scheduled));
    found
}

/// Every item's occurrences due in [from, to] (archived items' only with
/// `archived`), by due date, then name.
pub fn occurrences(
    snapshot: &Snapshot,
    from: NaiveDate,
    to: NaiveDate,
    archived: bool,
) -> Vec<Occurrence<'_>> {
    let mut all: Vec<Occurrence<'_>> = snapshot
        .items
        .values()
        .filter(|item| archived || !item.archived)
        .flat_map(|item| item_occurrences(snapshot, item, from, to))
        .collect();
    all.sort_by(|a, b| {
        (a.due, &a.item.name, &a.item.id, a.scheduled).cmp(&(
            b.due,
            &b.item.name,
            &b.item.id,
            b.scheduled,
        ))
    });
    all
}

/// The paid occurrences due outside [from, to], whenever they were paid:
/// paid early or late enough, the money moved far from the due date.
pub fn paid_outside(snapshot: &Snapshot, from: NaiveDate, to: NaiveDate) -> Vec<Occurrence<'_>> {
    let mut found = Vec::new();
    for over in snapshot.overrides.values() {
        let due = over.moved_to.unwrap_or(over.date);
        let paid = matches!(over.status, OccStatus::Done { .. });
        let item = snapshot.items.get(&over.item_id);
        if let Some(item) = item.filter(|_| paid && (due < from || due > to)) {
            found.push(Occurrence {
                item,
                scheduled: over.date,
                due,
                expected_cents: over.amount_cents.unwrap_or(0),
                status: over.status.clone(),
                over: Some(over),
            });
        }
    }
    found
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::model::{ItemKind, Repeat, Segment};
    use chrono::DateTime;

    pub fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    pub fn item(id: &str, kind: ItemKind, from: NaiveDate, repeat: Repeat, cents: Cents) -> Item {
        Item {
            id: id.into(),
            kind,
            name: id.to_uppercase(),
            category: None,
            schedule: vec![Segment {
                from,
                until: None,
                repeat,
                amount_cents: cents,
            }],
            autopay: false,
            reminder: None,
            archived: false,
            note: None,
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
        }
    }

    pub fn over(item_id: &str, date: NaiveDate, status: OccStatus) -> Override {
        Override {
            item_id: item_id.into(),
            date,
            status,
            amount_cents: None,
            moved_to: None,
            note: None,
            updated_at: DateTime::UNIX_EPOCH,
        }
    }

    pub fn put_item(snapshot: &mut Snapshot, item: Item) {
        snapshot.write(DocKey::Item(item.id.clone()), Some(&item));
    }

    pub fn put_over(snapshot: &mut Snapshot, over: Override) {
        let key = DocKey::Occ {
            date: over.date,
            item_id: over.item_id.clone(),
        };
        snapshot.write(key, Some(&over));
    }

    #[test]
    fn says_what_each_occurrence_is_and_when_its_due() {
        let mut snapshot = Snapshot::default();
        let monthly = Repeat::Months { n: 1, day: 1 };
        put_item(
            &mut snapshot,
            item("rent", ItemKind::Bill, d(2026, 11, 1), monthly, 1000),
        );
        // December's moved into November; January's amount changes; October's paid, though
        // the schedule starts in November
        put_over(
            &mut snapshot,
            Override {
                moved_to: Some(d(2026, 11, 28)),
                ..over("rent", d(2026, 12, 1), OccStatus::Open)
            },
        );
        put_over(
            &mut snapshot,
            Override {
                amount_cents: Some(1500),
                ..over("rent", d(2027, 1, 1), OccStatus::Open)
            },
        );
        let paid = OccStatus::Done {
            on: d(2026, 10, 2),
            amount_cents: 900,
        };
        put_over(&mut snapshot, over("rent", d(2026, 10, 1), paid.clone()));
        // Skipped and open overrides off the schedule are nothing
        put_over(
            &mut snapshot,
            over("rent", d(2026, 11, 15), OccStatus::Skipped),
        );

        let rent = &snapshot.items["rent"];
        let found = item_occurrences(&snapshot, rent, d(2026, 10, 1), d(2027, 1, 31));
        let summary: Vec<_> = found
            .iter()
            .map(|o| (o.scheduled, o.due, o.expected_cents, o.over.is_some()))
            .collect();
        assert_eq!(
            summary,
            vec![
                (d(2026, 10, 1), d(2026, 10, 1), 0, true),
                (d(2026, 11, 1), d(2026, 11, 1), 1000, false),
                (d(2026, 12, 1), d(2026, 11, 28), 1000, true),
                (d(2027, 1, 1), d(2027, 1, 1), 1500, true),
            ]
        );
        assert_eq!(found[0].status, paid);
        // Moved out of the window: not in it
        assert_eq!(
            item_occurrences(&snapshot, rent, d(2026, 12, 1), d(2026, 12, 31)).len(),
            0
        );
    }

    #[test]
    fn lists_every_items_by_date_then_name_and_leaves_archived_ones_out() {
        let mut snapshot = Snapshot::default();
        let weekly = Repeat::Weeks { n: 1 };
        put_item(
            &mut snapshot,
            item("b", ItemKind::Bill, d(2026, 11, 2), weekly, 1),
        );
        put_item(
            &mut snapshot,
            item("a", ItemKind::Income, d(2026, 11, 2), weekly, 2),
        );
        let mut old = item("c", ItemKind::Bill, d(2026, 11, 2), weekly, 3);
        old.archived = true;
        put_item(&mut snapshot, old);
        let found = occurrences(&snapshot, d(2026, 11, 1), d(2026, 11, 10), false);
        let ids: Vec<_> = found.iter().map(|o| (o.item.id.as_str(), o.due)).collect();
        assert_eq!(
            ids,
            vec![
                ("a", d(2026, 11, 2)),
                ("b", d(2026, 11, 2)),
                ("a", d(2026, 11, 9)),
                ("b", d(2026, 11, 9))
            ]
        );
        assert_eq!(
            occurrences(&snapshot, d(2026, 11, 1), d(2026, 11, 10), true).len(),
            6
        );
    }

    #[test]
    fn finds_the_paid_ones_due_outside_a_window() {
        let mut snapshot = Snapshot::default();
        put_item(
            &mut snapshot,
            item("tax", ItemKind::Bill, d(2027, 3, 15), Repeat::Once, 500),
        );
        let paid = OccStatus::Done {
            on: d(2026, 11, 10),
            amount_cents: 450,
        };
        put_over(&mut snapshot, over("tax", d(2027, 3, 15), paid.clone()));
        // Open ones, and ones whose item is gone, are nothing
        put_over(&mut snapshot, over("tax", d(2027, 6, 15), OccStatus::Open));
        put_over(&mut snapshot, over("gone", d(2027, 3, 15), paid.clone()));

        let found = paid_outside(&snapshot, d(2026, 11, 1), d(2027, 1, 9));
        let summary: Vec<_> = found.iter().map(|o| (o.scheduled, &o.status)).collect();
        assert_eq!(summary, vec![(d(2027, 3, 15), &paid)]);
        // Due inside the window: the window's own occurrences have it
        assert_eq!(
            paid_outside(&snapshot, d(2027, 3, 1), d(2027, 3, 31)).len(),
            0
        );
        assert_eq!(
            paid_outside(&snapshot, d(2027, 4, 1), d(2027, 4, 30)).len(),
            1
        );
    }
}
