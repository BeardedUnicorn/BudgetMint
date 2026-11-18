//! A bank statement's lines, kept: each in its account's month
//! (crate::model::MonthTransactions), under the name and category the user
//! left it with, so a month's spending can be looked back on by category
//! and a later statement knows what it has already shown. Saving a
//! statement (`import`) does all of it at once: the bills it paid, the
//! bills and income added for what comes round, the lines kept, the
//! categories remembered and the balance.

use crate::balance::{settle_account, PaidInput};
use crate::categorize::merchant_key;
use crate::docs::{valid_id, DocKey, Snapshot};
use crate::error::{invalid, CoreError};
use crate::forecast::contract::PayoutForecast;
use crate::model::{
    Balance, CategoryRule, Cents, LineFlow, MonthTransactions, Transaction, MAX_CENTS,
};
use crate::plan::{
    check_date, ours, save_item, spelled_as_before, ItemInput, Planned, MAX_CATEGORY, MAX_NAME,
};
use crate::report::month_days;
use crate::time::Ctx;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The most merchants a category is remembered for: the latest are kept.
pub const MAX_RULES: usize = 500;
/// The most transactions kept for one account's month.
pub const MAX_MONTH_TRANSACTIONS: usize = 1_500;
/// What a line with nothing said of it is called.
pub const UNNAMED: &str = "From the bank";

/// A statement's line as the user leaves it.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    /// The statement's id for it (crate::bank::BankTransaction).
    pub id: String,
    pub on: NaiveDate,
    /// Into the account above zero, out below.
    pub amount_cents: Cents,
    pub name: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub category: Option<String>,
    pub flow: LineFlow,
    /// The bill or income it paid.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub item_id: Option<String>,
}

/// A statement as the user saves it.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
pub struct ImportInput {
    /// Its lines, to keep.
    pub transactions: Vec<TransactionInput>,
    /// The bills and income it shows paid.
    pub paid: Vec<PaidInput>,
    /// Bills and income to add: what it shows coming round.
    pub items: Vec<ItemInput>,
    /// The categories the user chose for merchants, to remember (an empty
    /// category forgets the merchant's).
    pub rules: Vec<CategoryRule>,
    /// Its closing balance, to set.
    #[cfg_attr(feature = "ts", ts(optional))]
    pub balance: Option<Balance>,
}

/// `text` without the space around it, cut to `max` characters.
fn cut(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// A category as it's kept: trimmed and cut, spelled as a bill already
/// spells it; None when there's nothing to it.
fn category(snapshot: &Snapshot, category: Option<String>) -> Option<String> {
    category
        .map(|category| cut(&category, MAX_CATEGORY))
        .filter(|category| !category.is_empty())
        .map(|category| spelled_as_before(snapshot, "", category))
}

/// Keeps `transactions` in `account_id`'s months: one kept before (by its
/// id) is replaced, the rest of its month stays.
fn keep(
    snapshot: &mut Snapshot,
    account_id: &str,
    transactions: Vec<TransactionInput>,
) -> Result<Planned, CoreError> {
    let mut months: BTreeMap<String, Vec<Transaction>> = BTreeMap::new();
    for input in transactions {
        check_date(input.on)?;
        if !valid_id(&input.id) || input.amount_cents.abs() > MAX_CENTS {
            return Err(invalid(
                "That statement didn't read as it should: choose its file again",
            ));
        }
        let name = cut(&input.name, MAX_NAME);
        // What paid a transfer was moved, not spent (or come in)
        let moved = input
            .item_id
            .as_deref()
            .and_then(|id| snapshot.items.get(id))
            .is_some_and(|item| item.kind == crate::model::ItemKind::Transfer);
        let month = months
            .entry(input.on.format("%Y-%m").to_string())
            .or_default();
        month.retain(|other| other.id != input.id);
        month.push(Transaction {
            name: if name.is_empty() {
                UNNAMED.to_string()
            } else {
                name
            },
            category: category(snapshot, input.category),
            item_id: input.item_id.filter(|id| valid_id(id)),
            id: input.id,
            on: input.on,
            amount_cents: input.amount_cents,
            flow: if moved { LineFlow::Moved } else { input.flow },
        });
        if month.len() > MAX_MONTH_TRANSACTIONS {
            return Err(too_many());
        }
    }
    let mut planned = Planned::default();
    for (month, new) in months {
        let key = DocKey::Txns {
            account_id: account_id.to_string(),
            month: month.clone(),
        };
        ours(snapshot, &key)?;
        let mut all: Vec<Transaction> = snapshot
            .transactions
            .get(&(account_id.to_string(), month.clone()))
            .map(|kept| kept.transactions.clone())
            .unwrap_or_default();
        all.retain(|kept| !new.iter().any(|one| one.id == kept.id));
        all.extend(new);
        if all.len() > MAX_MONTH_TRANSACTIONS {
            return Err(too_many());
        }
        all.sort_by(|a, b| (a.on, &a.id).cmp(&(b.on, &b.id)));
        planned.add(snapshot.write(
            key,
            Some(&MonthTransactions {
                account_id: account_id.to_string(),
                month,
                transactions: all,
            }),
        ));
    }
    Ok(planned)
}

fn too_many() -> CoreError {
    invalid(format!(
        "That's more than BudgetMint keeps for one month ({} transactions)",
        MAX_MONTH_TRANSACTIONS
    ))
}

/// Remembers each of `rules`' categories for its merchant, in place of the
/// one remembered before; an empty category forgets it.
fn remember(snapshot: &mut Snapshot, rules: Vec<CategoryRule>) -> Result<Planned, CoreError> {
    let mut planned = Planned::default();
    if rules.is_empty() {
        return Ok(planned);
    }
    ours(snapshot, &DocKey::Settings)?;
    let mut settings = snapshot.settings();
    let mut kept = settings.category_rules.take().unwrap_or_default();
    for rule in rules {
        let merchant = merchant_key(&rule.merchant);
        kept.retain(|other| other.merchant != merchant);
        if let Some(category) =
            category(snapshot, Some(rule.category)).filter(|_| !merchant.is_empty())
        {
            kept.push(CategoryRule { merchant, category });
        }
    }
    let extra = kept.len().saturating_sub(MAX_RULES);
    kept.drain(..extra);
    settings.category_rules = (!kept.is_empty()).then_some(kept);
    planned.add(snapshot.write(DocKey::Settings, Some(&settings)));
    Ok(planned)
}

/// Saves `account_id`'s statement: marks what it paid paid and sets its
/// balance (crate::balance::settle_account), adds the bills and income
/// chosen from what comes round (in that account, unless one names
/// another), keeps its lines and remembers the categories chosen. All of
/// it, with one undo, or none of it.
pub fn import(
    snapshot: &mut Snapshot,
    taskmint: Option<&PayoutForecast>,
    account_id: &str,
    input: ImportInput,
    ctx: &Ctx,
) -> Result<Planned, CoreError> {
    let mut planned = settle_account(
        snapshot,
        taskmint,
        account_id,
        Vec::new(),
        input.paid,
        Vec::new(),
        input.balance,
        ctx,
    )?;
    for item in input.items {
        let item = ItemInput {
            account_id: item.account_id.or(Some(account_id.to_string())),
            ..item
        };
        planned.then(save_item(snapshot, item, ctx)?);
    }
    planned.then(keep(snapshot, account_id, input.transactions)?);
    planned.then(remember(snapshot, input.rules)?);
    Ok(planned)
}

/// What a month's kept spending came to in one category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SpendingCategory {
    /// None: what has none.
    pub category: Option<String>,
    pub cents: Cents,
    pub count: u32,
}

/// A kept transaction, and the account it's in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct KeptTransaction {
    pub account_id: String,
    pub transaction: Transaction,
}

/// A month's kept transactions, every account's together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SpendingView {
    /// YYYY-MM
    pub month: String,
    /// What was spent (money moved and cash back aside), the most first.
    pub categories: Vec<SpendingCategory>,
    pub spent_cents: Cents,
    /// All of them, by day.
    pub transactions: Vec<KeptTransaction>,
}

/// What the statements kept of `month` (YYYY-MM): None when it isn't a month.
pub fn spending(snapshot: &Snapshot, month: &str) -> Option<SpendingView> {
    month_days(month)?;
    let mut transactions: Vec<KeptTransaction> = snapshot
        .transactions
        .values()
        .filter(|kept| kept.month == month)
        .flat_map(|kept| {
            kept.transactions.iter().map(|transaction| KeptTransaction {
                account_id: kept.account_id.clone(),
                transaction: transaction.clone(),
            })
        })
        .collect();
    transactions.sort_by(|a, b| {
        (a.transaction.on, &a.transaction.id).cmp(&(b.transaction.on, &b.transaction.id))
    });
    // By category ignoring case, named as first spelled
    let mut by: BTreeMap<Option<String>, SpendingCategory> = BTreeMap::new();
    for kept in transactions
        .iter()
        .map(|kept| &kept.transaction)
        .filter(|kept| kept.flow == LineFlow::Spend)
    {
        let entry = by
            .entry(kept.category.as_ref().map(|name| name.to_lowercase()))
            .or_insert_with(|| SpendingCategory {
                category: kept.category.clone(),
                cents: 0,
                count: 0,
            });
        entry.cents -= kept.amount_cents;
        entry.count += 1;
    }
    let mut categories: Vec<SpendingCategory> = by.into_values().collect();
    categories.sort_by(|a, b| b.cents.cmp(&a.cents).then(a.category.cmp(&b.category)));
    Some(SpendingView {
        month: month.to_string(),
        spent_cents: categories.iter().map(|category| category.cents).sum(),
        categories,
        transactions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::{export, read_backup};
    use crate::docs::IncomingDoc;
    use crate::model::{ItemKind, OccStatus, Repeat, Segment, Settings, Weekends};
    use crate::occur::tests::{d, item, put_account, put_item};
    use crate::plan::{delete_account, restore_budget, save_settings, NEWER};

    fn ctx() -> Ctx {
        // Nov 10, 2026, noon in Chicago
        Ctx::new(1_794_333_600_000, "America/Chicago")
    }

    fn message<T: std::fmt::Debug>(result: Result<T, CoreError>) -> String {
        result.unwrap_err().to_string()
    }

    fn line(
        id: &str,
        on: NaiveDate,
        cents: Cents,
        name: &str,
        category: Option<&str>,
    ) -> TransactionInput {
        TransactionInput {
            id: id.into(),
            on,
            amount_cents: cents,
            name: name.into(),
            category: category.map(str::to_string),
            flow: if cents < 0 {
                LineFlow::Spend
            } else {
                LineFlow::Income
            },
            item_id: None,
        }
    }

    fn month<'a>(s: &'a Snapshot, account: &str, month: &str) -> &'a [Transaction] {
        &s.transactions[&(account.to_string(), month.to_string())].transactions
    }

    #[test]
    fn keeps_each_line_in_its_month_once() {
        let mut s = Snapshot::default();
        let mut bill = item("power", ItemKind::Bill, d(2026, 11, 3), Repeat::Once, 9_000);
        bill.category = Some("Utilities".into());
        put_item(&mut s, bill);
        let planned = keep(
            &mut s,
            "main",
            vec![
                line("b", d(2026, 10, 9), -500, "  Coffee  ", Some("  dining ")),
                line("a", d(2026, 10, 9), -900, "", Some("  ")),
                line(
                    "c",
                    d(2026, 11, 2),
                    2_000,
                    &"n".repeat(90),
                    Some("UTILITIES"),
                ),
                // The same line twice: the later one is it
                line("b", d(2026, 10, 9), -500, "Cafe", None),
                TransactionInput {
                    item_id: Some("power".into()),
                    ..line("d", d(2026, 11, 3), -9_200, "City Power", None)
                },
                TransactionInput {
                    item_id: Some("not an id".into()),
                    flow: LineFlow::Moved,
                    ..line("e", d(2026, 11, 4), 5_000, "Add funds", None)
                },
            ],
        )
        .unwrap();
        assert_eq!(planned.writes.len(), 2);
        assert_eq!(
            (planned.writes[0].kind.as_str(), planned.writes[0].schema),
            ("txns", 5)
        );
        let october: Vec<(&str, &str, Option<&str>)> = month(&s, "main", "2026-10")
            .iter()
            .map(|t| (t.id.as_str(), t.name.as_str(), t.category.as_deref()))
            .collect();
        assert_eq!(october, vec![("a", UNNAMED, None), ("b", "Cafe", None)]);
        let november = month(&s, "main", "2026-11");
        assert_eq!(november[0].name.len(), MAX_NAME);
        assert_eq!(november[0].category.as_deref(), Some("Utilities"));
        assert_eq!(november[1].item_id.as_deref(), Some("power"));
        assert_eq!(
            (november[2].item_id.as_deref(), november[2].flow),
            (None, LineFlow::Moved)
        );
        // Kept again with another category: replaced, the rest of the month as it was
        keep(
            &mut s,
            "main",
            vec![line("b", d(2026, 10, 9), -500, "Cafe", Some("Dining"))],
        )
        .unwrap();
        let october = month(&s, "main", "2026-10");
        assert_eq!(
            (october.len(), october[1].category.as_deref()),
            (2, Some("Dining"))
        );
        // Just the same again: nothing to write
        assert_eq!(
            keep(
                &mut s,
                "main",
                vec![line("b", d(2026, 10, 9), -500, "Cafe", Some("Dining"))]
            )
            .unwrap(),
            Planned::default()
        );
    }

    #[test]
    fn keeps_what_paid_a_transfer_as_money_moved() {
        use crate::model::MAIN_ACCOUNT;
        use crate::occur::tests::transfer;
        let mut s = Snapshot::default();
        s.write(DocKey::Settings, Some(&Settings::default()));
        put_account(&mut s, "savings", None);
        put_item(
            &mut s,
            transfer(
                "put",
                (None, Some("savings")),
                d(2026, 11, 3),
                Repeat::Once,
                40_000,
            ),
        );
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
        let paying = |id: &str, item: &str, cents| TransactionInput {
            item_id: Some(item.into()),
            ..line(id, d(2026, 11, 3), cents, "Paid", None)
        };
        keep(
            &mut s,
            MAIN_ACCOUNT,
            vec![
                paying("t1", "put", -40_000),
                paying("t2", "rent", -120_000),
                paying("t3", "gone", -100),
            ],
        )
        .unwrap();
        let flows: Vec<LineFlow> = month(&s, MAIN_ACCOUNT, "2026-11")
            .iter()
            .map(|kept| kept.flow)
            .collect();
        assert_eq!(
            flows,
            vec![LineFlow::Moved, LineFlow::Spend, LineFlow::Spend]
        );
        // Moved: none of the month's spending
        let spent = spending(&s, "2026-11").unwrap();
        assert_eq!(spent.spent_cents, 120_100);
    }

    #[test]
    fn refuses_what_isnt_a_statements_and_more_than_a_month_holds() {
        let mut s = Snapshot::default();
        let unread = "That statement didn't read as it should: choose its file again";
        for bad in [
            line("a b", d(2026, 10, 9), -500, "x", None),
            line("a", d(2026, 10, 9), -MAX_CENTS - 1, "x", None),
        ] {
            assert_eq!(message(keep(&mut s, "main", vec![bad])), unread);
        }
        assert!(keep(
            &mut s,
            "main",
            vec![line("a", d(3026, 10, 9), -5, "x", None)]
        )
        .is_err());
        let many = |from: usize, count: usize| -> Vec<TransactionInput> {
            (from..from + count)
                .map(|at| line(&format!("t{}", at), d(2026, 10, 9), -500, "x", None))
                .collect()
        };
        let too_many = "That's more than BudgetMint keeps for one month (1500 transactions)";
        assert_eq!(
            message(keep(&mut s, "main", many(0, MAX_MONTH_TRANSACTIONS + 1))),
            too_many
        );
        keep(&mut s, "main", many(0, 1_000)).unwrap();
        assert_eq!(message(keep(&mut s, "main", many(1_000, 600))), too_many);
        // A month a newer BudgetMint wrote isn't this one's to change
        s.apply(vec![IncomingDoc {
            doc_id: "txns~main~2026-09".into(),
            json: Some("{}".into()),
            schema: 99,
        }]);
        assert_eq!(
            message(keep(
                &mut s,
                "main",
                vec![line("z", d(2026, 9, 9), -5, "x", None)]
            )),
            NEWER
        );
    }

    #[test]
    fn remembers_the_category_chosen_for_a_merchant() {
        let mut s = Snapshot::default();
        let rule = |merchant: &str, category: &str| CategoryRule {
            merchant: merchant.into(),
            category: category.into(),
        };
        assert_eq!(remember(&mut s, Vec::new()).unwrap(), Planned::default());
        let planned = remember(
            &mut s,
            vec![
                rule("Walmart", "Food"),
                rule("  ", "Food"),
                rule("Spotify", " Music "),
            ],
        )
        .unwrap();
        assert_eq!(planned.writes[0].schema, 5);
        assert_eq!(
            s.settings().category_rules,
            Some(vec![rule("walmart", "Food"), rule("spotify", "Music")])
        );
        // Chosen again: the latest, last; an empty one forgets it
        remember(
            &mut s,
            vec![rule("WALMART", "Household"), rule("Spotify", "")],
        )
        .unwrap();
        assert_eq!(
            s.settings().category_rules,
            Some(vec![rule("walmart", "Household")])
        );
        remember(&mut s, vec![rule("walmart", "")]).unwrap();
        assert_eq!(s.settings().category_rules, None);
        // Only the latest are kept
        let many: Vec<CategoryRule> = (0..MAX_RULES + 2)
            .map(|at| rule(&format!("m{}", at), "Any"))
            .collect();
        remember(&mut s, many).unwrap();
        let kept = s.settings().category_rules.unwrap();
        assert_eq!((kept.len(), kept[0].merchant.as_str()), (MAX_RULES, "m2"));
        // Saving the settings keeps them
        save_settings(&mut s, Settings::default()).unwrap();
        assert_eq!(s.settings().category_rules.unwrap().len(), MAX_RULES);
        s.apply(vec![IncomingDoc {
            doc_id: "settings~account".into(),
            json: Some("{}".into()),
            schema: 99,
        }]);
        assert_eq!(message(remember(&mut s, vec![rule("a", "b")])), NEWER);
    }

    fn bill(id: &str, account_id: Option<&str>) -> ItemInput {
        ItemInput {
            id: id.into(),
            kind: ItemKind::Bill,
            name: "Netflix".into(),
            category: Some("Subscriptions".into()),
            schedule: vec![Segment {
                from: d(2026, 11, 28),
                until: None,
                repeat: Repeat::Months { n: 1, day: 28 },
                amount_cents: 1_999,
                weekends: Weekends::Keep,
            }],
            autopay: false,
            reminder: None,
            archived: false,
            note: None,
            varies: false,
            save_up: false,
            saved_cents: None,
            account_id: account_id.map(str::to_string),
            to_account_id: None,
        }
    }

    #[test]
    fn saves_a_statement_all_at_once_and_undoes_it_so() {
        let mut s = Snapshot::default();
        s.write(DocKey::Settings, Some(&Settings::default()));
        put_account(&mut s, "card", None);
        put_account(&mut s, "other", None);
        put_item(
            &mut s,
            crate::occur::tests::in_account(
                item(
                    "rent",
                    ItemKind::Bill,
                    d(2026, 11, 1),
                    Repeat::Once,
                    120_000,
                ),
                "card",
            ),
        );
        let before = s.clone();
        let input = ImportInput {
            transactions: vec![
                line(
                    "t1",
                    d(2026, 10, 28),
                    -1_999,
                    "Netflix",
                    Some("Subscriptions"),
                ),
                TransactionInput {
                    item_id: Some("rent".into()),
                    ..line("t2", d(2026, 11, 2), -120_000, "Rent", None)
                },
            ],
            paid: vec![PaidInput {
                item_id: "rent".into(),
                date: d(2026, 11, 1),
                on: d(2026, 11, 2),
                amount_cents: 120_000,
            }],
            items: vec![bill("netflix", None), bill("elsewhere", Some("other"))],
            rules: vec![CategoryRule {
                merchant: "Netflix".into(),
                category: "Subscriptions".into(),
            }],
            balance: Some(Balance {
                cents: 50_000,
                as_of: d(2026, 11, 9),
            }),
        };
        let planned = import(&mut s, None, "card", input, &ctx()).unwrap();
        assert_eq!(
            s.overrides[&("rent".to_string(), d(2026, 11, 1))].status,
            OccStatus::Done {
                on: d(2026, 11, 2),
                amount_cents: 120_000
            }
        );
        assert_eq!(s.items["netflix"].account_id.as_deref(), Some("card"));
        assert_eq!(s.items["elsewhere"].account_id.as_deref(), Some("other"));
        assert_eq!(month(&s, "card", "2026-10").len(), 1);
        assert_eq!(
            month(&s, "card", "2026-11")[0].item_id.as_deref(),
            Some("rent")
        );
        assert_eq!(s.settings().category_rules.unwrap().len(), 1);
        assert_eq!(s.balance_of("card").unwrap().cents, 50_000);
        // Undone, it's all as it was
        for undo in planned.undo {
            s.apply(vec![IncomingDoc {
                doc_id: undo.doc_id,
                json: undo.json,
                schema: undo.schema,
            }]);
        }
        assert!(s.transactions.is_empty() && s.overrides.is_empty());
        assert_eq!(s.items.len(), before.items.len());
        assert_eq!(s.settings().category_rules, None);
        // An account that isn't there, a bill that doesn't read, a line that doesn't: none of it
        assert!(import(&mut s, None, "gone", ImportInput::default(), &ctx()).is_err());
        let unnamed = ItemInput {
            name: " ".into(),
            ..bill("x", None)
        };
        let with = |items: Vec<ItemInput>, transactions: Vec<TransactionInput>| ImportInput {
            items,
            transactions,
            ..ImportInput::default()
        };
        assert!(import(
            &mut s,
            None,
            "main",
            with(vec![unnamed], Vec::new()),
            &ctx()
        )
        .is_err());
        let unread = vec![line("a b", d(2026, 10, 9), -5, "x", None)];
        assert!(import(&mut s, None, "main", with(Vec::new(), unread), &ctx()).is_err());
        s.apply(vec![IncomingDoc {
            doc_id: "settings~account".into(),
            json: Some("{}".into()),
            schema: 99,
        }]);
        let rules = ImportInput {
            rules: vec![CategoryRule {
                merchant: "a".into(),
                category: "b".into(),
            }],
            ..ImportInput::default()
        };
        assert_eq!(message(import(&mut s, None, "card", rules, &ctx())), NEWER);
    }

    #[test]
    fn a_months_spending_by_category_every_accounts_together() {
        let mut s = Snapshot::default();
        put_account(&mut s, "card", None);
        keep(
            &mut s,
            "main",
            vec![
                line("a", d(2026, 10, 9), -500, "Cafe", Some("Dining")),
                line("b", d(2026, 10, 3), -4_000, "Grocer", Some("Groceries")),
                line("c", d(2026, 10, 20), -700, "Kiosk", None),
                line("d", d(2026, 10, 21), 9_000, "Pay", None),
                TransactionInput {
                    flow: LineFlow::Moved,
                    ..line("e", d(2026, 10, 22), -9_000, "To savings", None)
                },
                line("f", d(2026, 11, 1), -100, "Later", None),
            ],
        )
        .unwrap();
        keep(
            &mut s,
            "card",
            vec![
                line("g", d(2026, 10, 9), -1_500, "Diner", Some("dining")),
                line("h", d(2026, 10, 10), -700, "Stall", Some("Snacks")),
            ],
        )
        .unwrap();
        let view = spending(&s, "2026-10").unwrap();
        let categories: Vec<(Option<&str>, Cents, u32)> = view
            .categories
            .iter()
            .map(|c| (c.category.as_deref(), c.cents, c.count))
            .collect();
        assert_eq!(
            categories,
            vec![
                (Some("Groceries"), 4_000, 1),
                (Some("Dining"), 2_000, 2),
                (None, 700, 1),
                (Some("Snacks"), 700, 1),
            ]
        );
        assert_eq!(view.spent_cents, 7_400);
        let ids: Vec<(&str, &str)> = view
            .transactions
            .iter()
            .map(|kept| (kept.account_id.as_str(), kept.transaction.id.as_str()))
            .collect();
        assert_eq!(
            ids,
            vec![
                ("main", "b"),
                ("main", "a"),
                ("card", "g"),
                ("card", "h"),
                ("main", "c"),
                ("main", "d"),
                ("main", "e")
            ]
        );
        assert!(spending(&s, "2026-12").unwrap().transactions.is_empty());
        assert_eq!(spending(&s, "October"), None);
    }

    #[test]
    fn kept_transactions_go_with_their_account_and_into_a_backup() {
        let mut s = Snapshot::default();
        put_account(&mut s, "card", None);
        keep(
            &mut s,
            "main",
            vec![line("a", d(2026, 10, 9), -500, "Cafe", None)],
        )
        .unwrap();
        keep(
            &mut s,
            "card",
            vec![
                line("b", d(2026, 10, 9), -500, "Cafe", None),
                line("c", d(2026, 11, 9), -500, "Cafe", None),
            ],
        )
        .unwrap();
        let backup = export(&s, &ctx()).backup;
        assert!(backup.contains("\"version\": 5"));
        assert_eq!(read_backup(&backup).unwrap().transactions.len(), 3);
        // The account deleted: its months with it, the main one's left
        let deleted = delete_account(&mut s, "card").unwrap();
        assert_eq!(deleted.writes.len(), 3);
        assert_eq!(s.transactions.len(), 1);
        // Restored: the backup's months back, and one it doesn't have gone
        keep(
            &mut s,
            "main",
            vec![line("z", d(2026, 12, 1), -5, "Later", None)],
        )
        .unwrap();
        restore_budget(&mut s, &backup).unwrap();
        let months: Vec<(&str, &str)> = s
            .transactions
            .keys()
            .map(|(account, month)| (account.as_str(), month.as_str()))
            .collect();
        assert_eq!(
            months,
            vec![
                ("card", "2026-10"),
                ("card", "2026-11"),
                ("main", "2026-10")
            ]
        );
        // A month of an account the backup lacks, of no month, or with a day outside the calendar: damaged
        for (from, to) in [
            ("\"accountId\": \"main\"", "\"accountId\": \"gone\""),
            ("\"month\": \"2026-10\"", "\"month\": \"2026-1\""),
            ("\"on\": \"2026-10-09\"", "\"on\": \"3026-10-09\""),
        ] {
            assert!(backup.contains(from), "{}", from);
            assert!(message(read_backup(&backup.replace(from, to)))
                .starts_with("That backup is damaged"));
        }
        // Categories remembered alone make it a newer backup too
        let mut remembering = Snapshot::default();
        remember(
            &mut remembering,
            vec![CategoryRule {
                merchant: "cafe".into(),
                category: "Dining".into(),
            }],
        )
        .unwrap();
        assert!(export(&remembering, &ctx())
            .backup
            .contains("\"version\": 5"));
    }
}
