//! The budget as a file of the user's own: a backup (JSON) that restores
//! it, and a spreadsheet (CSV) of its occurrences. The cloud is the only
//! other copy, so this is the one that survives a mistake there.
//!
//! A backup holds what core holds: the settings, every item, and what was
//! said about the occurrences the client reads (a year and a bit back). It
//! reads only when it's BudgetMint's, from this version or an older one,
//! with every document as the cloud would take it (crate::docs).

use crate::docs::{valid_id, Snapshot, Versioned, BASE_SCHEMA};
use crate::error::{invalid, CoreError};
use crate::model::{Item, ItemKind, OccStatus, Override, Settings};
use crate::occur::occurrences;
use crate::time::Ctx;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// What a backup says it is.
pub const BACKUP_FORMAT: &str = "budgetmint-backup";
/// The newest backup version this BudgetMint reads. It writes the newest
/// schema any of the backup's documents needs (crate::docs::Versioned), so
/// a backup with nothing newer still restores in an older BudgetMint.
pub const BACKUP_VERSION: u32 = 3;
/// How far back the spreadsheet starts: a year.
pub const CSV_DAYS_BACK: i64 = 366;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    #[serde(default)]
    pub settings: Option<Settings>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub occurrences: Vec<Override>,
}

/// The budget's files, for the client to save.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct BudgetExport {
    /// The backup, as JSON: restore_budget takes it back.
    pub backup: String,
    /// The occurrences from a year back to the forecast's end, a row each.
    pub csv: String,
    /// What to call the files: "budgetmint-2026-11-11".
    pub file_stem: String,
}

/// The budget's backup and spreadsheet, as of `ctx`.
pub fn export(snapshot: &Snapshot, ctx: &Ctx) -> BudgetExport {
    let backup = Backup {
        format: BACKUP_FORMAT.into(),
        version: snapshot
            .items
            .values()
            .map(Versioned::schema)
            .fold(BASE_SCHEMA, u32::max),
        exported_at: ctx.now,
        settings: snapshot.settings.clone(),
        items: snapshot.items.values().cloned().collect(),
        occurrences: snapshot.overrides.values().cloned().collect(),
    };
    BudgetExport {
        backup: serde_json::to_string_pretty(&backup).expect("a backup is plain data"),
        csv: csv(snapshot, ctx),
        file_stem: format!("budgetmint-{}", ctx.today().format("%Y-%m-%d")),
    }
}

/// What a backup restores: the settings, the items and the occurrences, by id.
#[derive(Debug, Default)]
pub struct Restored {
    pub settings: Option<Settings>,
    pub items: BTreeMap<String, Item>,
    pub overrides: BTreeMap<(String, chrono::NaiveDate), Override>,
}

/// `json` read as a backup, every part of it checked as the documents are
/// when they're read: refused whole when any part isn't one BudgetMint
/// could have written.
pub fn read_backup(json: &str) -> Result<Restored, CoreError> {
    let not_one = || invalid("That file isn't a BudgetMint backup");
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| not_one())?;
    if value.get("format").and_then(|format| format.as_str()) != Some(BACKUP_FORMAT) {
        return Err(not_one());
    }
    if value
        .get("version")
        .and_then(|version| version.as_u64())
        .is_some_and(|version| version > u64::from(BACKUP_VERSION))
    {
        return Err(invalid(
            "That backup is from a newer BudgetMint. Update BudgetMint to restore it.",
        ));
    }
    let backup: Backup = serde_json::from_value(value).map_err(|_| damaged())?;
    let mut restored = Restored {
        settings: backup.settings,
        ..Restored::default()
    };
    if !restored
        .settings
        .as_ref()
        .is_none_or(|settings| settings.in_calendar())
    {
        return Err(damaged());
    }
    for item in backup.items {
        if !valid_id(&item.id) || item.schedule.is_empty() || !item.in_calendar() {
            return Err(damaged());
        }
        restored.items.insert(item.id.clone(), item);
    }
    for over in backup.occurrences {
        // Each is one of the backup's own items'
        if !restored.items.contains_key(&over.item_id) || !over.in_calendar() {
            return Err(damaged());
        }
        restored
            .overrides
            .insert((over.item_id.clone(), over.date), over);
    }
    Ok(restored)
}

fn damaged() -> CoreError {
    invalid("That backup is damaged: part of it doesn't read. Nothing was changed.")
}

/// `cents` as a plain amount for a spreadsheet: "-12.50".
fn amount(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    format!("{}{}.{:02}", sign, cents.abs() / 100, cents.abs() % 100)
}

/// A spreadsheet cell: quoted when it must be, and never read as a formula.
fn cell(text: &str) -> String {
    let text = if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{}", text)
    } else {
        text.to_string()
    };
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

fn csv(snapshot: &Snapshot, ctx: &Ctx) -> String {
    let today = ctx.today();
    let to = today + Duration::days(i64::from(snapshot.settings().horizon_days));
    csv_between(snapshot, today - Duration::days(CSV_DAYS_BACK), to)
}

/// A month's bills and income, as a spreadsheet: what Reports looks back on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct MonthExport {
    pub csv: String,
    /// What to call the file: "budgetmint-2026-11".
    pub file_stem: String,
}

/// `month`'s (YYYY-MM) occurrences as a CSV; None when it isn't a month.
pub fn month_csv(snapshot: &Snapshot, month: &str) -> Option<MonthExport> {
    let (first, last) = crate::report::month_days(month)?;
    Some(MonthExport {
        csv: csv_between(snapshot, first, last),
        file_stem: format!("budgetmint-{}", month),
    })
}

/// The occurrences due in [from, to], archived items' too, a row each.
fn csv_between(snapshot: &Snapshot, from: NaiveDate, to: NaiveDate) -> String {
    let mut lines =
        vec!["Due,Name,Kind,Category,Expected,Status,Done on,Amount done,Note".to_string()];
    for occurrence in occurrences(snapshot, from, to, true) {
        let item = occurrence.item;
        let bill = item.kind == ItemKind::Bill;
        let (status, on, done) = match &occurrence.status {
            OccStatus::Open => ("Open", String::new(), String::new()),
            OccStatus::Skipped => ("Skipped", String::new(), String::new()),
            OccStatus::Done { on, amount_cents } => (
                if bill { "Paid" } else { "Received" },
                on.format("%Y-%m-%d").to_string(),
                amount(*amount_cents),
            ),
        };
        let note = occurrence
            .over
            .and_then(|over| over.note.as_deref())
            .unwrap_or("");
        lines.push(
            [
                occurrence.due.format("%Y-%m-%d").to_string(),
                cell(&item.name),
                (if bill { "Bill" } else { "Income" }).to_string(),
                cell(item.category.as_deref().unwrap_or("")),
                amount(occurrence.expected_cents),
                status.to_string(),
                on,
                done,
                cell(note),
            ]
            .join(","),
        );
    }
    lines.join("\r\n") + "\r\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::IncomingDoc;
    use crate::model::Repeat;
    use crate::occur::tests::{d, item, put_item};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        let mut rent = item(
            "rent",
            ItemKind::Bill,
            d(2026, 10, 1),
            Repeat::Months { n: 1, day: 1 },
            120_000,
        );
        rent.name = "Rent, flat \"A\"".into();
        rent.category = Some("=Home".into());
        put_item(&mut s, rent);
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 11, 13),
                Repeat::Once,
                80_000,
            ),
        );
        let paid = Override {
            item_id: "rent".into(),
            date: d(2026, 11, 1),
            status: OccStatus::Done {
                on: d(2026, 10, 30),
                amount_cents: 120_050,
            },
            amount_cents: None,
            moved_to: None,
            note: Some("late fee\nwaived".into()),
            updated_at: DateTime::UNIX_EPOCH,
        };
        let received = Override {
            item_id: "pay".into(),
            date: d(2026, 11, 13),
            status: OccStatus::Done {
                on: d(2026, 11, 10),
                amount_cents: 80_000,
            },
            note: None,
            ..paid.clone()
        };
        s.apply(vec![
            IncomingDoc {
                doc_id: "occ~2026-11-01~rent".into(),
                json: Some(serde_json::to_string(&paid).unwrap()),
                schema: 1,
            },
            IncomingDoc {
                doc_id: "occ~2026-11-13~pay".into(),
                json: Some(serde_json::to_string(&received).unwrap()),
                schema: 1,
            },
        ]);
        s
    }

    #[test]
    fn writes_a_newer_backup_only_when_it_holds_a_newer_document() {
        let mut s = Snapshot::default();
        let mut goal = item("trip", ItemKind::Bill, d(2027, 5, 1), Repeat::Once, 100_000);
        put_item(&mut s, goal.clone());
        let version = |s: &Snapshot| {
            serde_json::from_str::<serde_json::Value>(&export(s, &ctx()).backup).unwrap()["version"]
                .clone()
        };
        assert_eq!(version(&s), 2);
        goal.save_up = Some(crate::model::SaveUp {
            since: d(2026, 11, 10),
            saved_cents: Some(30_000),
        });
        put_item(&mut s, goal);
        assert_eq!(version(&s), 3);
        // And this BudgetMint restores it
        let restored = read_backup(&export(&s, &ctx()).backup).unwrap();
        assert_eq!(
            restored.items["trip"].save_up.unwrap().saved_cents,
            Some(30_000)
        );
    }

    #[test]
    fn writes_a_months_bills_and_income_as_a_spreadsheet() {
        let mut s = Snapshot::default();
        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 10, 1),
                Repeat::Months { n: 1, day: 1 },
                120_000,
            ),
        );
        let november = month_csv(&s, "2026-11").unwrap();
        assert_eq!(november.file_stem, "budgetmint-2026-11");
        let lines: Vec<&str> = november.csv.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[1].starts_with("2026-11-01,RENT,Bill,"));
        assert!(month_csv(&s, "13").is_none());
        assert!(month_csv(&s, "9999-01").is_none());
    }

    #[test]
    fn exports_a_backup_that_reads_back_and_a_spreadsheet() {
        let s = budget();
        let files = export(&s, &ctx());
        assert_eq!(files.file_stem, "budgetmint-2026-11-10");
        let restored = read_backup(&files.backup).unwrap();
        assert_eq!(restored.items, s.items);
        assert_eq!(restored.overrides, s.overrides);
        assert_eq!(restored.settings, None);

        let rows: Vec<&str> = files.csv.split("\r\n").collect();
        assert_eq!(
            rows[0],
            "Due,Name,Kind,Category,Expected,Status,Done on,Amount done,Note"
        );
        assert_eq!(
            rows[1],
            "2026-10-01,\"Rent, flat \"\"A\"\"\",Bill,'=Home,1200.00,Open,,,"
        );
        assert_eq!(
            rows[2],
            "2026-11-01,\"Rent, flat \"\"A\"\"\",Bill,'=Home,1200.00,Paid,2026-10-30,1200.50,\"late fee\nwaived\""
        );
        assert!(rows.contains(&"2026-11-13,PAY,Income,,800.00,Received,2026-11-10,800.00,"));
        assert_eq!(rows.last(), Some(&""));
        assert_eq!(amount(-1250), "-12.50");
        assert_eq!(cell("plain"), "plain");
    }

    #[test]
    fn reads_only_a_whole_backup_from_this_version_or_an_older_one() {
        let good: serde_json::Value =
            serde_json::from_str(&export(&budget(), &ctx()).backup).unwrap();
        let with = |change: &dyn Fn(&mut serde_json::Value)| {
            let mut value = good.clone();
            change(&mut value);
            read_backup(&value.to_string())
                .map(|_| ())
                .unwrap_err()
                .to_string()
        };
        let not_one = "That file isn't a BudgetMint backup";
        let damaged = "That backup is damaged: part of it doesn't read. Nothing was changed.";
        assert_eq!(read_backup("{").unwrap_err().to_string(), not_one);
        assert_eq!(with(&|v| v["format"] = "taskmint".into()), not_one);
        assert_eq!(
            with(&|v| v["version"] = (BACKUP_VERSION + 1).into()),
            "That backup is from a newer BudgetMint. Update BudgetMint to restore it."
        );
        assert_eq!(with(&|v| v["items"] = 7.into()), damaged);
        assert_eq!(with(&|v| v["items"][0]["id"] = "a b".into()), damaged);
        assert_eq!(
            with(&|v| v["items"][0]["schedule"] = serde_json::json!([])),
            damaged
        );
        assert_eq!(
            with(&|v| v["items"][0]["schedule"][0]["from"] = "1800-01-01".into()),
            damaged
        );
        assert_eq!(
            with(&|v| v["occurrences"][0]["itemId"] = "gone".into()),
            damaged
        );
        assert_eq!(
            with(&|v| v["occurrences"][0]["movedTo"] = "2300-01-01".into()),
            damaged
        );
        assert_eq!(
            with(&|v| {
                v["settings"] =
                    serde_json::json!({ "balance": { "cents": 1, "asOf": "1800-01-01" } })
            }),
            damaged
        );
        // With settings: read
        let mut with_settings = good.clone();
        with_settings["settings"] = serde_json::json!({ "lowBalanceCents": 500 });
        let restored = read_backup(&with_settings.to_string()).unwrap();
        assert_eq!(restored.settings.unwrap().low_balance_cents, 500);
    }
}
