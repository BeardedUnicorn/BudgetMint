//! A bank's statement, as the file the bank gives (CSV or OFX), read into
//! its transactions and matched to the bills and income still open: the
//! user picks which to mark paid (crate::balance::settle does it), and can
//! take the statement's closing balance too. The client reads the file and
//! passes its text; nothing here reads anything else.

use crate::docs::Snapshot;
use crate::error::{invalid, CoreError};
use crate::model::{Balance, Cents, ItemKind, OccStatus, MAX_CENTS};
use crate::occur::occurrences;
use crate::project::settled_through;
use crate::time::{in_calendar, Ctx};
use crate::views::{occurrence_view, OccurrenceView};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// The most of a statement read: a few years of a busy account.
pub const MAX_ROWS: usize = 20_000;
/// The largest file taken.
pub const MAX_STATEMENT_BYTES: usize = 5_000_000;
/// How far from its due day a bill's payment may be on the statement.
pub const MATCH_DAYS: i64 = 10;
/// How many rows the header may come after (a bank's own lines first).
const HEADER_WITHIN: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum StatementFormat {
    Csv,
    Ofx,
}

/// One line of the statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct BankTransaction {
    /// Its place among the statement's transactions (0 first).
    pub index: u32,
    pub date: NaiveDate,
    /// Into the account above zero, out below.
    pub amount_cents: Cents,
    pub description: String,
}

/// Which of a CSV's columns (0 first) hold what.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CsvColumns {
    pub date: u32,
    #[serde(default)]
    pub description: Option<u32>,
    /// One column for both ways, out below zero...
    #[serde(default)]
    pub amount: Option<u32>,
    /// ...or one for each.
    #[serde(default)]
    pub debit: Option<u32>,
    #[serde(default)]
    pub credit: Option<u32>,
    /// The balance after each.
    #[serde(default)]
    pub balance: Option<u32>,
}

/// A bill or income the statement shows paid, and the transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct StatementMatch {
    pub transaction: u32,
    pub occurrence: OccurrenceView,
    /// For just what was expected (not only near it).
    pub exact: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct StatementView {
    pub format: StatementFormat,
    /// A CSV's header row (or its first, when none was found), to choose
    /// its columns from.
    pub headers: Vec<String>,
    /// The columns read: found, or as given. None: not found (choose them).
    pub columns: Option<CsvColumns>,
    pub transactions: Vec<BankTransaction>,
    /// Rows that didn't read as a transaction.
    pub skipped_rows: u32,
    /// What the statement says the balance was at its end.
    pub balance: Option<Balance>,
    pub matches: Vec<StatementMatch>,
    /// Transactions for ones marked paid already (that day or near it, for that amount).
    pub already: Vec<u32>,
}

/// `text` as a statement, its transactions matched to the budget.
pub fn read_statement(
    snapshot: &Snapshot,
    text: &str,
    columns: Option<CsvColumns>,
    ctx: &Ctx,
) -> Result<StatementView, CoreError> {
    if text.len() > MAX_STATEMENT_BYTES {
        return Err(invalid(
            "That file is too large: export a few months at a time",
        ));
    }
    let text = text.trim_start_matches('\u{feff}');
    let lower = text.to_ascii_lowercase();
    let mut view = if lower.contains("<ofx>") || lower.trim_start().starts_with("ofxheader") {
        read_ofx(text)
    } else {
        read_csv(text, columns)
    }?;
    (view.matches, view.already) = match_open(snapshot, &view.transactions, ctx);
    Ok(view)
}

fn not_a_statement() -> CoreError {
    invalid("That file isn't a bank statement BudgetMint can read: export it as CSV or OFX")
}

// ---- Reading values ----

/// An amount as banks write them: "$1,234.56", "-12.34", "(12.34)",
/// "12.34-", "1.234,56", "12.34 DR". None when it isn't one (or is too large).
pub fn parse_amount(cell: &str) -> Option<Cents> {
    let cell = cell.trim();
    let upper = cell.to_ascii_uppercase();
    let negative = cell.starts_with('-')
        || cell.ends_with('-')
        || (cell.starts_with('(') && cell.ends_with(')'))
        || upper.ends_with("DR");
    let kept: String = cell
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    if !kept.bytes().any(|b| b.is_ascii_digit()) {
        return None;
    }
    // The decimal mark is the last separator with one or two digits after it
    let (whole, fraction) = match kept.rfind(['.', ',']) {
        Some(at) if (1..=2).contains(&(kept.len() - at - 1)) => (&kept[..at], &kept[at + 1..]),
        _ => (kept.as_str(), ""),
    };
    // The whole number's digits, then the cents' two
    let digits = format!("{}{:0<2}", whole, fraction);
    let mut cents: i64 = 0;
    for digit in digits.bytes().filter(u8::is_ascii_digit) {
        cents = cents
            .checked_mul(10)?
            .checked_add(i64::from(digit - b'0'))?;
    }
    if cents > MAX_CENTS {
        return None;
    }
    Some(if negative { -cents } else { cents })
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// A date as banks write them: 2026-11-10, 20261110, 11/10/2026, 11/10/26,
/// 10.11.2026 (with `day_first`), Nov 10, 2026, 10 Nov 2026; a time after it
/// is left aside.
pub fn parse_date(cell: &str, day_first: bool) -> Option<NaiveDate> {
    let cell = cell.trim();
    let first = cell
        .split(|c: char| c.is_whitespace() || c == 'T')
        .next()
        .unwrap_or_default();
    let date = numeric_date(first, day_first).or_else(|| named_date(cell))?;
    in_calendar(date).then_some(date)
}

fn numeric_date(token: &str, day_first: bool) -> Option<NaiveDate> {
    if token.len() == 8 && token.bytes().all(|b| b.is_ascii_digit()) {
        return NaiveDate::parse_from_str(token, "%Y%m%d").ok();
    }
    let parts: Vec<&str> = token.split(['/', '-', '.']).collect();
    let [a, b, c] = parts[..] else {
        return None;
    };
    let number = |part: &str| part.parse::<u32>().ok();
    let (year, month, day) = if a.len() == 4 {
        (number(a)?, number(b)?, number(c)?)
    } else {
        let year = match c.len() {
            2 => 2000 + number(c)?,
            4 => number(c)?,
            _ => return None,
        };
        let (month, day) = if day_first {
            (number(b)?, number(a)?)
        } else {
            (number(a)?, number(b)?)
        };
        (year, month, day)
    };
    NaiveDate::from_ymd_opt(year as i32, month, day)
}

fn named_date(cell: &str) -> Option<NaiveDate> {
    let lower = cell.to_ascii_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let month = words
        .iter()
        .find_map(|word| MONTHS.iter().position(|name| word.starts_with(name)))?;
    let numbers: Vec<u32> = words.iter().filter_map(|word| word.parse().ok()).collect();
    let year = numbers.iter().find(|n| **n >= 1000)?;
    let day = numbers.iter().find(|n| **n <= 31)?;
    NaiveDate::from_ymd_opt(*year as i32, month as u32 + 1, *day)
}

/// Whether the dates in `cells` put the day first (one has a first number
/// over 12, where months can't be).
fn day_first(cells: &[&str]) -> bool {
    cells.iter().any(|cell| {
        let mut parts = cell.trim().split(['/', '-', '.']);
        let first = parts.next().unwrap_or_default();
        first.len() <= 2 && first.parse::<u32>().is_ok_and(|n| n > 12)
    })
}

// ---- CSV ----

/// The rows of a CSV, its cells unquoted.
fn csv_rows(text: &str) -> Vec<Vec<String>> {
    // The delimiter the first lines have most of (a comma, when none)
    let head: Vec<&str> = text.lines().take(HEADER_WITHIN + 5).collect();
    let delimiter = [';', '\t', ',']
        .into_iter()
        .max_by_key(|d| {
            head.iter()
                .map(|line| line.matches(*d).count())
                .sum::<usize>()
        })
        .expect("three to choose from");
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == delimiter && !quoted => row.push(std::mem::take(&mut cell)),
            '\n' | '\r' if !quoted => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            c => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows.retain(|row| row.iter().any(|cell| !cell.trim().is_empty()));
    rows
}

/// Which of the header's names is the best for a column: the first of
/// `names` any of them is, or contains, in that order.
fn column(headers: &[String], names: &[&str], not: &[&str]) -> Option<u32> {
    let headers: Vec<String> = headers.iter().map(|h| h.trim().to_lowercase()).collect();
    let fits =
        |header: &str, name: &str| header.contains(name) && !not.iter().any(|n| header.contains(n));
    names
        .iter()
        .find_map(|name| headers.iter().position(|header| header == name))
        .or_else(|| {
            names
                .iter()
                .find_map(|name| headers.iter().position(|header| fits(header, name)))
        })
        .map(|at| at as u32)
}

/// The columns a header row names, when it names a date and an amount.
fn find_columns(headers: &[String]) -> Option<CsvColumns> {
    let date = column(
        headers,
        &["date", "transaction date", "posted", "posting date", "date"],
        &[],
    )?;
    let debit = column(
        headers,
        &["debit", "withdrawal", "money out", "paid out", "outflow"],
        &["credit"],
    );
    let credit = column(
        headers,
        &["credit", "deposit", "money in", "paid in", "inflow"],
        &["debit"],
    );
    let amount = column(headers, &["amount", "value"], &["balance"]);
    if amount.is_none() && debit.is_none() && credit.is_none() {
        return None;
    }
    Some(CsvColumns {
        date,
        description: column(
            headers,
            &[
                "description",
                "payee",
                "name",
                "merchant",
                "memo",
                "details",
                "narrative",
                "reference",
            ],
            &["date"],
        ),
        amount,
        debit,
        credit,
        balance: column(headers, &["balance", "running balance"], &[]),
    })
}

fn read_csv(text: &str, given: Option<CsvColumns>) -> Result<StatementView, CoreError> {
    let rows = csv_rows(text);
    if rows.is_empty() {
        return Err(not_a_statement());
    }
    // The header: the first of the first rows that names the columns
    let found = rows
        .iter()
        .take(HEADER_WITHIN)
        .enumerate()
        .find_map(|(at, row)| find_columns(row).map(|columns| (at, columns)));
    let (header_at, columns) = match (given, found) {
        (Some(given), found) => (found.map(|(at, _)| at), Some(given)),
        (None, Some((at, columns))) => (Some(at), Some(columns)),
        (None, None) => (None, None),
    };
    let headers = rows[header_at.unwrap_or(0)].clone();
    let mut view = StatementView {
        format: StatementFormat::Csv,
        headers,
        columns,
        transactions: Vec::new(),
        skipped_rows: 0,
        balance: None,
        matches: Vec::new(),
        already: Vec::new(),
    };
    let Some(columns) = columns else {
        return Ok(view);
    };
    let data = &rows[header_at.map_or(0, |at| at + 1)..];
    fn cell(row: &[String], at: Option<u32>) -> &str {
        at.and_then(|at| row.get(at as usize))
            .map_or("", |cell| cell.as_str())
    }
    let dates: Vec<&str> = data
        .iter()
        .map(|row| cell(row, Some(columns.date)))
        .collect();
    let day_first = day_first(&dates);
    let mut balances: Vec<(NaiveDate, Cents)> = Vec::new();
    for row in data.iter().take(MAX_ROWS) {
        let Some(date) = parse_date(cell(row, Some(columns.date)), day_first) else {
            view.skipped_rows += 1;
            continue;
        };
        let amount = parse_amount(cell(row, columns.amount)).or_else(|| {
            let debit = parse_amount(cell(row, columns.debit)).map(|cents| -cents.abs());
            let credit = parse_amount(cell(row, columns.credit)).map(|cents| cents.abs());
            debit.filter(|cents| *cents != 0).or(credit)
        });
        let Some(amount_cents) = amount else {
            view.skipped_rows += 1;
            continue;
        };
        if let Some(balance) = parse_amount(cell(row, columns.balance)) {
            balances.push((date, balance));
        }
        view.transactions.push(BankTransaction {
            index: view.transactions.len() as u32,
            date,
            amount_cents,
            description: cell(row, columns.description).trim().to_string(),
        });
    }
    // The balance after the latest: the file's last row of that day, or its
    // first when the file runs newest first
    let newest_first = balances
        .first()
        .zip(balances.last())
        .is_some_and(|(a, b)| a.0 > b.0);
    let latest = balances.iter().map(|(date, _)| *date).max();
    let mut on_latest = balances.iter().filter(|(date, _)| Some(*date) == latest);
    let closing = if newest_first {
        on_latest.next()
    } else {
        on_latest.next_back()
    };
    view.balance = closing.map(|(date, cents)| Balance {
        cents: *cents,
        as_of: *date,
    });
    Ok(view)
}

// ---- OFX ----

/// The text after `<tag>` in `block`, up to the next tag: None without one.
fn ofx_value(block: &str, tag: &str) -> Option<String> {
    let lower = block.to_ascii_uppercase();
    let at = lower.find(&format!("<{}>", tag))? + tag.len() + 2;
    let rest = &block[at..];
    let value = rest[..rest.find('<').unwrap_or(rest.len())].trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn read_ofx(text: &str) -> Result<StatementView, CoreError> {
    let upper = text.to_ascii_uppercase();
    let mut view = StatementView {
        format: StatementFormat::Ofx,
        headers: Vec::new(),
        columns: None,
        transactions: Vec::new(),
        skipped_rows: 0,
        balance: None,
        matches: Vec::new(),
        already: Vec::new(),
    };
    let mut from = 0;
    while let Some(start) = upper[from..].find("<STMTTRN>") {
        let start = from + start;
        let end = upper[start..]
            .find("</STMTTRN>")
            .map_or(text.len(), |end| start + end);
        let block = &text[start..end];
        from = end.max(start + 1);
        if view.transactions.len() >= MAX_ROWS {
            break;
        }
        let date =
            ofx_value(block, "DTPOSTED").and_then(|value| parse_date(value.get(..8)?, false));
        let amount = ofx_value(block, "TRNAMT").and_then(|value| parse_amount(&value));
        let (Some(date), Some(amount_cents)) = (date, amount) else {
            view.skipped_rows += 1;
            continue;
        };
        let name = ofx_value(block, "NAME").unwrap_or_default();
        let memo = ofx_value(block, "MEMO").filter(|memo| *memo != name);
        let description = [Some(name), memo]
            .into_iter()
            .flatten()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        view.transactions.push(BankTransaction {
            index: view.transactions.len() as u32,
            date,
            amount_cents,
            description,
        });
    }
    if view.transactions.is_empty() && view.skipped_rows == 0 && !upper.contains("<STMTRS>") {
        return Err(not_a_statement());
    }
    if let Some(ledger) = upper.find("<LEDGERBAL>").map(|at| &text[at..]) {
        let cents = ofx_value(ledger, "BALAMT").and_then(|value| parse_amount(&value));
        let as_of =
            ofx_value(ledger, "DTASOF").and_then(|value| parse_date(value.get(..8)?, false));
        view.balance = cents
            .zip(as_of)
            .map(|(cents, as_of)| Balance { cents, as_of });
    }
    Ok(view)
}

// ---- Matching ----

/// The words of a name worth looking for in a description: three letters or more.
fn words(name: &str) -> Vec<String> {
    name.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() >= 3)
        .map(str::to_string)
        .collect()
}

/// How well `amount` fits what was `expected`: 3 exactly, 2 within 5%, 1
/// within a quarter, 0 not at all.
fn amount_fit(amount: Cents, expected: Cents) -> u8 {
    let off = i128::from((amount - expected).abs());
    let expected = i128::from(expected.max(1));
    if off == 0 {
        3
    } else if off * 20 <= expected {
        2
    } else if off * 4 <= expected {
        1
    } else {
        0
    }
}

/// Each transaction matched to the open bill or income it most likely paid
/// (by its amount, the name in its description and how near its day), and
/// the ones that paid one marked paid already.
fn match_open(
    snapshot: &Snapshot,
    transactions: &[BankTransaction],
    ctx: &Ctx,
) -> (Vec<StatementMatch>, Vec<u32>) {
    let (Some(first), Some(last)) = (
        transactions.iter().map(|t| t.date).min(),
        transactions.iter().map(|t| t.date).max(),
    ) else {
        return (Vec::new(), Vec::new());
    };
    let window = Duration::days(MATCH_DAYS);
    let all = occurrences(snapshot, first - window, last + window, false);
    let today = ctx.today();
    let settled = settled_through(&snapshot.settings(), today);
    let kind_of = |t: &BankTransaction| {
        if t.amount_cents < 0 {
            ItemKind::Bill
        } else {
            ItemKind::Income
        }
    };
    let near = |a: NaiveDate, b: NaiveDate, days: i64| (a - b).num_days().abs() <= days;

    // Paid already: the same amount within a few days of the day it was paid
    let already: Vec<u32> = transactions
        .iter()
        .filter(|t| {
            all.iter().any(|o| match o.status {
                OccStatus::Done { on, amount_cents } => {
                    o.item.kind == kind_of(t)
                        && amount_cents == t.amount_cents.abs()
                        && near(on, t.date, 3)
                }
                _ => false,
            })
        })
        .map(|t| t.index)
        .collect();

    let mut pairs = Vec::new();
    for t in transactions
        .iter()
        .filter(|t| !already.contains(&t.index) && t.amount_cents != 0)
    {
        let description = t.description.to_lowercase();
        for (at, o) in all.iter().enumerate() {
            if o.status != OccStatus::Open
                || o.item.kind != kind_of(t)
                || !near(o.due, t.date, MATCH_DAYS)
            {
                continue;
            }
            let fit = amount_fit(t.amount_cents.abs(), o.expected_cents);
            let named = words(&o.item.name)
                .iter()
                .any(|word| description.contains(word.as_str()));
            let days = (o.due - t.date).num_days().abs();
            let score = u32::from(fit) * 2
                + if named { 4 } else { 0 }
                + match days {
                    0 => 2,
                    1..=3 => 1,
                    _ => 0,
                };
            // Exactly the amount, near it and close in time, or near it with the name
            let likely = fit == 3 || (fit == 2 && days <= 3) || (fit >= 1 && named);
            if likely {
                pairs.push((score, days, t.index, at));
            }
        }
    }
    pairs.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut matches = Vec::new();
    let (mut used_t, mut used_o) = (Vec::new(), Vec::new());
    for (_, _, t, at) in pairs {
        if used_t.contains(&t) || used_o.contains(&at) {
            continue;
        }
        used_t.push(t);
        used_o.push(at);
        let occurrence = &all[at];
        matches.push(StatementMatch {
            transaction: t,
            exact: transactions[t as usize].amount_cents.abs() == occurrence.expected_cents,
            occurrence: occurrence_view(occurrence, today, settled),
        });
    }
    matches.sort_by_key(|m| m.transaction);
    (matches, already)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::model::{Repeat, Settings};
    use crate::occur::tests::{d, item, over, put_item, put_over};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn budget() -> Snapshot {
        let mut s = Snapshot::default();
        s.write(DocKey::Settings, Some(&Settings::default()));
        put_item(
            &mut s,
            item(
                "rent",
                ItemKind::Bill,
                d(2026, 11, 1),
                Repeat::Once,
                120_000,
            ),
        );
        let mut power = item("power", ItemKind::Bill, d(2026, 11, 3), Repeat::Once, 9_000);
        power.name = "City Power".into();
        put_item(&mut s, power);
        put_item(
            &mut s,
            item(
                "pay",
                ItemKind::Income,
                d(2026, 11, 6),
                Repeat::Once,
                250_000,
            ),
        );
        put_item(
            &mut s,
            item("gym", ItemKind::Bill, d(2026, 11, 4), Repeat::Once, 3_000),
        );
        put_over(
            &mut s,
            over(
                "gym",
                d(2026, 11, 4),
                OccStatus::Done {
                    on: d(2026, 11, 4),
                    amount_cents: 3_000,
                },
            ),
        );
        s
    }

    #[test]
    fn reads_amounts_and_dates_as_banks_write_them() {
        for (cell, cents) in [
            ("12.34", Some(1_234)),
            ("-12.34", Some(-1_234)),
            ("$1,234.56", Some(123_456)),
            ("(45.00)", Some(-4_500)),
            ("45.00-", Some(-4_500)),
            ("1.234,56", Some(123_456)),
            ("12,5", Some(1_250)),
            ("1,234", Some(123_400)),
            ("100", Some(10_000)),
            ("12.34 DR", Some(-1_234)),
            ("€ 9,99", Some(999)),
            ("", None),
            ("n/a", None),
            ("99999999999999999999", None),
            ("100000000000.00", None),
            ("92233720368547758.07", None),
            ("92233720368547758.08", None),
        ] {
            assert_eq!(parse_amount(cell), cents, "{:?}", cell);
        }
        for (cell, day_first, date) in [
            ("2026-11-10", false, Some(d(2026, 11, 10))),
            ("20261110", false, Some(d(2026, 11, 10))),
            ("11/10/2026", false, Some(d(2026, 11, 10))),
            ("10/11/2026", true, Some(d(2026, 11, 10))),
            ("11/10/26", false, Some(d(2026, 11, 10))),
            ("10.11.2026", true, Some(d(2026, 11, 10))),
            ("2026/11/10 13:45", false, Some(d(2026, 11, 10))),
            ("2026-11-10T08:00:00", false, Some(d(2026, 11, 10))),
            ("Nov 10, 2026", false, Some(d(2026, 11, 10))),
            ("10 November 2026", false, Some(d(2026, 11, 10))),
            ("11/10/202", false, None),
            ("13/40/2026", false, None),
            ("1/2", false, None),
            ("x/y/2026", false, None),
            ("1/y/2026", true, None),
            ("y/1/2026", false, None),
            ("1/2/zz", false, None),
            ("1/2/zzzz", false, None),
            ("y/1/2026", true, None),
            ("1/y/2026", false, None),
            ("2026/zz/01", false, None),
            ("2026/01/zz", false, None),
            ("abcd/01/01", false, None),
            ("Nov 2026", false, None),
            ("Nov 10", false, None),
            ("Pending", false, None),
            ("3026-01-01", false, None),
        ] {
            assert_eq!(parse_date(cell, day_first), date, "{:?}", cell);
        }
        assert!(day_first(&["25/12/2026", "01/01/2027"]));
        assert!(!day_first(&["12/25/2026", "2026-01-30", ""]));
    }

    #[test]
    fn reads_a_csv_and_matches_it_to_the_bills() {
        let csv = "\u{feff}Account: Checking ...1234\n\
                   Statement date: 11/10/2026\n\
                   Date,Description,Amount,Running Balance\n\
                   11/01/2026,\"RENT, NOV\",-1200.00,800.00\n\
                   11/03/2026,\"CITYPOWER CO \"\"online\"\"\",-91.40,708.60\r\n\
                   11/04/2026,GYM,-30.00,678.60\n\
                   11/06/2026,PAYROLL ACME,2500.00,3178.60\n\
                   11/07/2026,COFFEE,-4.50,3174.10\n\
                   Pending,,,\n\
                   11/08/2026,Nothing,,\n";
        let s = budget();
        let view = read_statement(&s, csv, None, &ctx()).unwrap();
        assert_eq!(view.format, StatementFormat::Csv);
        assert_eq!(
            view.headers,
            vec!["Date", "Description", "Amount", "Running Balance"]
        );
        assert_eq!(
            view.columns,
            Some(CsvColumns {
                date: 0,
                description: Some(1),
                amount: Some(2),
                debit: None,
                credit: None,
                balance: Some(3),
            })
        );
        assert_eq!(view.transactions.len(), 5);
        assert_eq!(view.skipped_rows, 2);
        assert_eq!(view.transactions[0].description, "RENT, NOV");
        assert_eq!(view.transactions[1].description, "CITYPOWER CO \"online\"");
        assert_eq!(
            view.balance,
            Some(Balance {
                cents: 317_410,
                as_of: d(2026, 11, 7)
            })
        );
        // Rent exactly; power near its amount, with its name; pay exactly; the gym's paid already
        let matched: Vec<(u32, &str, bool)> = view
            .matches
            .iter()
            .map(|m| (m.transaction, m.occurrence.item_id.as_str(), m.exact))
            .collect();
        assert_eq!(
            matched,
            vec![(0, "rent", true), (1, "power", false), (3, "pay", true)]
        );
        assert_eq!(view.already, vec![2]);
    }

    #[test]
    fn reads_debit_and_credit_columns_newest_first_with_the_day_first() {
        let csv = "Posting Date;Payee;Debit;Credit;Balance\n\
                   06/11/2026;PAYROLL;;2500,00;3178,60\n\
                   06/11/2026;LATER SAME DAY;5,00;;3173,60\n\
                   01/11/2026;LANDLORD;1200,00;;800,00\n\
                   13/11/2026;nothing either way;0;;";
        let view = read_statement(&budget(), csv, None, &ctx()).unwrap();
        let amounts: Vec<(NaiveDate, Cents)> = view
            .transactions
            .iter()
            .map(|t| (t.date, t.amount_cents))
            .collect();
        assert_eq!(
            amounts,
            vec![
                (d(2026, 11, 6), 250_000),
                (d(2026, 11, 6), -500),
                (d(2026, 11, 1), -120_000),
            ]
        );
        // Nothing either way: not a transaction
        assert_eq!(view.skipped_rows, 1);
        // Newest first: the day's first row is its last
        assert_eq!(
            view.balance,
            Some(Balance {
                cents: 317_860,
                as_of: d(2026, 11, 6)
            })
        );
        let matched: Vec<&str> = view
            .matches
            .iter()
            .map(|m| m.occurrence.item_id.as_str())
            .collect();
        assert_eq!(matched, vec!["pay", "rent"]);
    }

    #[test]
    fn asks_for_the_columns_when_it_cant_find_them() {
        let csv = "When,What,How much\n2026-11-01,Rent,-1200\n";
        let view = read_statement(&budget(), csv, None, &ctx()).unwrap();
        assert_eq!(view.columns, None);
        assert_eq!(view.headers, vec!["When", "What", "How much"]);
        assert!(view.transactions.is_empty());
        let given = CsvColumns {
            date: 0,
            description: Some(1),
            amount: Some(2),
            ..CsvColumns::default()
        };
        let view = read_statement(&budget(), csv, Some(given), &ctx()).unwrap();
        assert_eq!(view.columns, Some(given));
        // The header row doesn't read as one: skipped
        assert_eq!(view.skipped_rows, 1);
        assert_eq!(view.transactions[0].amount_cents, -120_000);
        assert_eq!(view.matches[0].occurrence.item_id, "rent");
        // Columns given past a header it found: from the row after it
        let found = "Date,Amount\n2026-11-01,-1200\n";
        let these = CsvColumns {
            date: 0,
            amount: Some(1),
            ..CsvColumns::default()
        };
        let view = read_statement(&budget(), found, Some(these), &ctx()).unwrap();
        assert_eq!((view.skipped_rows, view.transactions.len()), (0, 1));
        assert_eq!(view.transactions[0].description, "");
        assert_eq!(view.balance, None);

        let refused = |text: &str| {
            read_statement(&budget(), text, None, &ctx())
                .unwrap_err()
                .to_string()
        };
        assert_eq!(
            refused("\n \n"),
            "That file isn't a bank statement BudgetMint can read: export it as CSV or OFX"
        );
        assert_eq!(
            refused(&"x".repeat(MAX_STATEMENT_BYTES + 1)),
            "That file is too large: export a few months at a time"
        );
        // Unterminated quote: still a row
        let open = "Date,Amount\n2026-11-01,\"-1200";
        assert_eq!(
            read_statement(&budget(), open, None, &ctx())
                .unwrap()
                .transactions
                .len(),
            1
        );
    }

    #[test]
    fn reads_an_ofx_statement() {
        let ofx = "OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>\
                   <BANKTRANLIST>\
                   <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261101120000[-6:CST]<TRNAMT>-1200.00<FITID>1<NAME>LANDLORD<MEMO>RENT NOV</STMTTRN>\
                   <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261106<TRNAMT>2500.00<FITID>2<NAME>PAYROLL<MEMO>PAYROLL</STMTTRN>\
                   <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2026<TRNAMT>-1.00<FITID>3</STMTTRN>\
                   <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-2.00<MEMO>ATM</STMTTRN>\
                   </BANKTRANLIST><LEDGERBAL><BALAMT>3178.60<DTASOF>20261107</LEDGERBAL>\
                   </STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
        let view = read_statement(&budget(), ofx, None, &ctx()).unwrap();
        assert_eq!(view.format, StatementFormat::Ofx);
        assert_eq!(view.skipped_rows, 1);
        let read: Vec<(Cents, &str)> = view
            .transactions
            .iter()
            .map(|t| (t.amount_cents, t.description.as_str()))
            .collect();
        assert_eq!(
            read,
            vec![
                (-120_000, "LANDLORD RENT NOV"),
                (250_000, "PAYROLL"),
                (-200, "ATM")
            ]
        );
        assert_eq!(
            view.balance,
            Some(Balance {
                cents: 317_860,
                as_of: d(2026, 11, 7)
            })
        );
        assert_eq!(view.matches.len(), 2);

        // A balance whose day doesn't read
        let short = "<OFX><STMTRS><LEDGERBAL><BALAMT>1.00<DTASOF>2026</LEDGERBAL></STMTRS></OFX>";
        assert_eq!(
            read_statement(&budget(), short, None, &ctx())
                .unwrap()
                .balance,
            None
        );
        // No more than a statement's worth
        let many = format!(
            "<OFX>{}</OFX>",
            "<STMTTRN><DTPOSTED>20261101<TRNAMT>-1.00</STMTTRN>".repeat(MAX_ROWS + 1)
        );
        assert_eq!(
            read_statement(&budget(), &many, None, &ctx())
                .unwrap()
                .transactions
                .len(),
            MAX_ROWS
        );
        // An OFX without transactions, or with a balance that doesn't read
        let empty = "<OFX><STMTRS><LEDGERBAL><BALAMT>x</LEDGERBAL></STMTRS></OFX>";
        let view = read_statement(&budget(), empty, None, &ctx()).unwrap();
        assert!(view.transactions.is_empty() && view.balance.is_none());
        assert!(read_statement(&budget(), "<OFX></OFX>", None, &ctx()).is_err());
        // The last one open to the end of the file
        let unclosed = "<OFX><STMTTRN><DTPOSTED>20261101<TRNAMT>-5.00<NAME>X";
        assert_eq!(
            read_statement(&budget(), unclosed, None, &ctx())
                .unwrap()
                .transactions
                .len(),
            1
        );
        assert_eq!(ofx_value("<NAME></STMTTRN>", "NAME"), None);
    }

    #[test]
    fn matches_only_what_fits() {
        let s = budget();
        let t = |index: u32, date: NaiveDate, cents: Cents, description: &str| BankTransaction {
            index,
            date,
            amount_cents: cents,
            description: description.into(),
        };
        let (matches, already) = match_open(&s, &[], &ctx());
        assert!(matches.is_empty() && already.is_empty());
        let (matches, _) = match_open(
            &s,
            &[
                // Near rent's amount, close in time, no name: likely
                t(0, d(2026, 11, 2), -121_000, "ACH 1234"),
                // Near power's, but far in time and no name: not
                t(1, d(2026, 11, 12), -9_100, "ACH 5678"),
                // Income for a bill's amount: not
                t(2, d(2026, 11, 1), 120_000, "REFUND"),
                // Nothing at all
                t(3, d(2026, 11, 2), 0, ""),
                // Way off power's amount, even with its name: not
                t(4, d(2026, 11, 3), -50_000, "CITY POWER"),
            ],
            &ctx(),
        );
        let matched: Vec<(u32, &str)> = matches
            .iter()
            .map(|m| (m.transaction, m.occurrence.item_id.as_str()))
            .collect();
        assert_eq!(matched, vec![(0, "rent")]);
        // Two transactions for one bill: the better one gets it
        let (matches, _) = match_open(
            &s,
            &[
                t(0, d(2026, 11, 9), -120_000, "RENT"),
                t(1, d(2026, 11, 1), -120_000, "RENT"),
            ],
            &ctx(),
        );
        assert_eq!(
            matches.iter().map(|m| m.transaction).collect::<Vec<_>>(),
            vec![1]
        );
        assert_eq!(amount_fit(0, 0), 3);
        assert_eq!(amount_fit(110, 100), 1);
        assert_eq!(amount_fit(200, 100), 0);
        // A "Debit/Credit" column is neither (it says which, not how much)
        let columns =
            find_columns(&["Date".into(), "Debit/Credit".into(), "Amount".into()]).unwrap();
        assert_eq!(
            (columns.debit, columns.credit, columns.amount),
            (None, None, Some(2))
        );
        assert_eq!(find_columns(&["Date".into(), "Description".into()]), None);
        assert_eq!(words("A to Zed's Co"), vec!["zed".to_string()]);
    }
}
