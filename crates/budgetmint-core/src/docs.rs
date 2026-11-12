//! The documents BudgetMint keeps in `budgetmint/{uid}/data` (the rules are
//! TaskMint's: firebase/firestore.rules), and core's copy of them.
//!
//! | Document | Holds |
//! |---|---|
//! | `settings~account` | [`Settings`] |
//! | `item~{id}` | an [`Item`] |
//! | `occ~{YYYY-MM-DD}~{itemId}` | an [`Override`]: the occurrence its schedule puts on that date |
//! | `account~{id}` | an [`Account`]: a bank account besides the main one (`account~main`: the main one's name) |
//!
//! The date leads an occurrence's id so the client can listen to a range of
//! dates. Each document's JSON is the type's; the client wraps it with the
//! fields the rules want (kind, schema, device, epoch, time).

use crate::model::{Account, Item, ItemKind, Override, Settings, MAIN_ACCOUNT, MAIN_ACCOUNT_NAME};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The newest documents' schema this BudgetMint reads: one written by a
/// newer BudgetMint (a higher number) is held, not read. 2: schedules twice
/// a month or on a weekday of the month, weekends moved, varying amounts,
/// money set aside, everyday spending and balance checks (fields an older
/// BudgetMint would drop). 3: an amount already set aside for a bill.
/// 4: bank accounts besides the main one, the items in them, and transfers.
pub const BUDGET_SCHEMA: u32 = 4;

/// The schema a document is written with when it has nothing a newer one added.
pub const BASE_SCHEMA: u32 = 2;

/// The schema a document needs: a field an older BudgetMint would drop
/// (writing back what it read without it) makes it that field's schema,
/// so older ones hold it instead. Only what needs it is newer: the rest of
/// the account stays readable, and changeable, everywhere.
pub trait Versioned {
    fn schema(&self) -> u32 {
        BASE_SCHEMA
    }
}

impl Versioned for Settings {}

impl Versioned for Override {}

impl Versioned for Item {
    fn schema(&self) -> u32 {
        // In another account, or moving money between two: an older
        // BudgetMint would count it in the main one, as a bill or income
        if self.kind == ItemKind::Transfer
            || self.account_id.is_some()
            || self.to_account_id.is_some()
        {
            4
        } else if self
            .save_up
            .is_some_and(|save_up| save_up.saved_cents.is_some())
        {
            3
        } else {
            BASE_SCHEMA
        }
    }
}

impl Versioned for Account {
    fn schema(&self) -> u32 {
        4
    }
}

/// The longest id an item may have (the rules' too).
pub const MAX_ID_LEN: usize = 64;

/// Whether `id` can name an item: 1–64 letters, digits and dashes.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Which document something is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocKey {
    Settings,
    Item(String),
    Occ { date: NaiveDate, item_id: String },
    Account(String),
}

impl DocKey {
    /// The document `doc_id` names; None for one BudgetMint doesn't keep.
    pub fn parse(doc_id: &str) -> Option<DocKey> {
        let (kind, rest) = doc_id.split_once('~')?;
        match kind {
            "settings" if rest == "account" => Some(DocKey::Settings),
            "item" if valid_id(rest) => Some(DocKey::Item(rest.to_string())),
            "account" if valid_id(rest) => Some(DocKey::Account(rest.to_string())),
            "occ" => {
                let (date, item_id) = rest.split_once('~')?;
                let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
                // Exactly YYYY-MM-DD, as the rules want
                (rest.len() == 11 + item_id.len() && valid_id(item_id)).then(|| DocKey::Occ {
                    date,
                    item_id: item_id.to_string(),
                })
            }
            _ => None,
        }
    }

    pub fn doc_id(&self) -> String {
        match self {
            DocKey::Settings => "settings~account".to_string(),
            DocKey::Item(id) => format!("item~{}", id),
            DocKey::Occ { date, item_id } => format!("occ~{}~{}", date.format("%Y-%m-%d"), item_id),
            DocKey::Account(id) => format!("account~{}", id),
        }
    }

    /// The document's kind, as the rules spell it.
    pub fn kind(&self) -> &'static str {
        match self {
            DocKey::Settings => "settings",
            DocKey::Item(_) => "item",
            DocKey::Occ { .. } => "occ",
            DocKey::Account(_) => "account",
        }
    }
}

/// A document as the client read it (its pending writes included).
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct IncomingDoc {
    pub doc_id: String,
    /// Null: deleted.
    pub json: Option<String>,
    pub schema: u32,
}

/// A document for the client to write (null JSON deletes it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DocWrite {
    pub doc_id: String,
    pub kind: String,
    pub json: Option<String>,
    pub schema: u32,
}

/// What applying documents did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DocsApplied {
    /// Documents now as they say.
    pub applied: u32,
    /// From a newer BudgetMint, left alone until this one is updated (all of them so far).
    pub held: Vec<String>,
    /// Ones that don't read as BudgetMint's (all of them so far).
    pub unreadable: Vec<String>,
}

/// Core's copy of the account's documents: what the client last read.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub settings: Option<Settings>,
    pub items: BTreeMap<String, Item>,
    /// By (item, date).
    pub overrides: BTreeMap<(String, NaiveDate), Override>,
    /// The account documents as kept, by id: the accounts besides the main
    /// one, and the main one's name when it has one (`account` and
    /// `all_accounts` are what the rules go by).
    pub accounts: BTreeMap<String, Account>,
    /// Each document's JSON as read, to tell a change from none.
    json: BTreeMap<String, String>,
    /// Each document's schema as read: a write never lowers it (the rules
    /// refuse that), so a document once newer stays so.
    schemas: BTreeMap<String, u32>,
    held: BTreeSet<String>,
    unreadable: BTreeSet<String>,
}

impl Snapshot {
    /// The settings, or the defaults before any are saved.
    pub fn settings(&self) -> Settings {
        self.settings.clone().unwrap_or_default()
    }

    /// The account `id` as the rules see it. The main one always is: its
    /// balance, low mark and checks are the settings', and its name the
    /// user's when they gave it one.
    pub fn account(&self, id: &str) -> Option<Account> {
        if id != MAIN_ACCOUNT {
            return self.accounts.get(id).cloned();
        }
        Some(self.main_account())
    }

    /// The balance `id`'s account holds, when it's there and has one.
    pub fn balance_of(&self, id: &str) -> Option<crate::model::Balance> {
        self.account(id).and_then(|account| account.balance)
    }

    /// The main account: the settings' balance, low mark and checks, under
    /// the name the user gave it (if any).
    pub fn main_account(&self) -> Account {
        let settings = self.settings();
        let named = self.accounts.get(MAIN_ACCOUNT);
        Account {
            id: MAIN_ACCOUNT.into(),
            name: named.map_or(MAIN_ACCOUNT_NAME.into(), |named| named.name.clone()),
            order: named.map_or(0, |named| named.order),
            balance: settings.balance,
            low_balance_cents: settings.low_balance_cents,
            checks: settings.checks,
            archived: false,
        }
    }

    /// Every account, the main one among them, in their order.
    pub fn all_accounts(&self) -> Vec<Account> {
        let mut all: Vec<Account> = self
            .accounts
            .values()
            .filter(|account| !account.is_main())
            .cloned()
            .chain([self.main_account()])
            .collect();
        all.sort_by(|a, b| (a.order, &a.name, &a.id).cmp(&(b.order, &b.name, &b.id)));
        all
    }

    /// The accounts in use (not archived), in their order.
    pub fn live_accounts(&self) -> Vec<Account> {
        self.all_accounts()
            .into_iter()
            .filter(|account| !account.archived)
            .collect()
    }

    /// Whether a newer BudgetMint wrote `key`'s document (it's held, not read).
    pub fn is_held(&self, key: &DocKey) -> bool {
        self.held.contains(&key.doc_id())
    }

    /// Whether `write`'s document is still exactly what it wrote.
    pub fn holds(&self, write: &DocWrite) -> bool {
        self.json.get(&write.doc_id) == write.json.as_ref()
    }

    /// Takes the documents the client read, in order.
    pub fn apply(&mut self, docs: Vec<IncomingDoc>) -> DocsApplied {
        let mut applied = 0;
        for doc in docs {
            if self.apply_one(doc) {
                applied += 1;
            }
        }
        DocsApplied {
            applied,
            held: self.held.iter().cloned().collect(),
            unreadable: self.unreadable.iter().cloned().collect(),
        }
    }

    fn apply_one(&mut self, doc: IncomingDoc) -> bool {
        self.held.remove(&doc.doc_id);
        self.unreadable.remove(&doc.doc_id);
        let Some(key) = DocKey::parse(&doc.doc_id) else {
            self.unreadable.insert(doc.doc_id);
            return false;
        };
        if doc.schema > BUDGET_SCHEMA {
            // Keep what this version last read of it
            self.held.insert(doc.doc_id);
            return false;
        }
        let read = match &doc.json {
            None => {
                self.set(&key, None);
                true
            }
            Some(json) => self.set(&key, Some(json)),
        };
        if read {
            match doc.json {
                Some(json) => {
                    self.schemas.insert(doc.doc_id.clone(), doc.schema);
                    self.json.insert(doc.doc_id, json)
                }
                None => {
                    self.schemas.remove(&doc.doc_id);
                    self.json.remove(&doc.doc_id)
                }
            };
        } else {
            self.unreadable.insert(doc.doc_id);
        }
        read
    }

    /// Puts `json` (None: nothing) as `key`'s value; false when it doesn't read as one.
    fn set(&mut self, key: &DocKey, json: Option<&str>) -> bool {
        match key {
            DocKey::Settings => match json.map(serde_json::from_str::<Settings>) {
                None => self.settings = None,
                Some(Ok(settings)) if settings.in_calendar() => self.settings = Some(settings),
                Some(_) => return false,
            },
            DocKey::Item(id) => match json.map(serde_json::from_str::<Item>) {
                None => {
                    self.items.remove(id);
                }
                Some(Ok(item))
                    if item.id == *id && !item.schedule.is_empty() && item.in_calendar() =>
                {
                    self.items.insert(id.clone(), item);
                }
                Some(_) => return false,
            },
            DocKey::Account(id) => match json.map(serde_json::from_str::<Account>) {
                None => {
                    self.accounts.remove(id);
                }
                Some(Ok(account)) if account.id == *id && account.in_calendar() => {
                    self.accounts.insert(id.clone(), account);
                }
                Some(_) => return false,
            },
            DocKey::Occ { date, item_id } => {
                let at = (item_id.clone(), *date);
                match json.map(serde_json::from_str::<Override>) {
                    None => {
                        self.overrides.remove(&at);
                    }
                    Some(Ok(over))
                        if over.item_id == *item_id && over.date == *date && over.in_calendar() =>
                    {
                        self.overrides.insert(at, over);
                    }
                    Some(_) => return false,
                }
            }
        }
        true
    }

    /// Writes `value` as `key`'s document (None deletes it): taken here at
    /// once, with the write that undoes it. None when nothing changes. Both
    /// carry the schema `value` needs, or the document's as read when that's
    /// newer: the undo too, since it follows the write it undoes.
    pub fn write<T: Serialize + Versioned>(
        &mut self,
        key: DocKey,
        value: Option<&T>,
    ) -> Option<(DocWrite, DocWrite)> {
        let doc_id = key.doc_id();
        let json =
            value.map(|value| serde_json::to_string(value).expect("documents are plain data"));
        let before = self.json.get(&doc_id).cloned();
        if json == before {
            return None;
        }
        let schema = value
            .map_or(BASE_SCHEMA, Versioned::schema)
            .max(self.schemas.get(&doc_id).copied().unwrap_or(BASE_SCHEMA));
        let write = |json: Option<String>| DocWrite {
            doc_id: doc_id.clone(),
            kind: key.kind().to_string(),
            json,
            schema,
        };
        let (done, undo) = (write(json.clone()), write(before));
        self.apply_one(IncomingDoc {
            doc_id: doc_id.clone(),
            json,
            schema,
        });
        Some((done, undo))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ItemKind, OccStatus, Repeat, Segment};
    use chrono::DateTime;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    pub(crate) fn rent() -> Item {
        Item {
            id: "rent".into(),
            kind: ItemKind::Bill,
            name: "Rent".into(),
            category: None,
            schedule: vec![Segment {
                from: d(2026, 11, 1),
                until: None,
                repeat: Repeat::Months { n: 1, day: 1 },
                amount_cents: 120_000,
                weekends: crate::model::Weekends::Keep,
            }],
            autopay: false,
            reminder: None,
            archived: false,
            note: None,
            varies: false,
            save_up: None,
            account_id: None,
            to_account_id: None,
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
        }
    }

    fn doc(doc_id: &str, json: Option<String>) -> IncomingDoc {
        IncomingDoc {
            doc_id: doc_id.into(),
            json,
            schema: 1,
        }
    }

    #[test]
    fn names_each_document_as_the_rules_do() {
        assert_eq!(DocKey::parse("settings~account"), Some(DocKey::Settings));
        assert_eq!(
            DocKey::parse("item~rent-1"),
            Some(DocKey::Item("rent-1".into()))
        );
        assert_eq!(
            DocKey::parse("occ~2026-11-30~rent"),
            Some(DocKey::Occ {
                date: d(2026, 11, 30),
                item_id: "rent".into()
            })
        );
        assert_eq!(
            DocKey::parse("account~savings-1"),
            Some(DocKey::Account("savings-1".into()))
        );
        for bad in [
            "account~",
            "account~a b",
            "settings~device",
            "item~",
            "item~a b",
            "occ~2026-11-30",
            "occ~2026-1-30~rent",
            "occ~2026-11-31~rent",
            "occ~2026-11-30~",
            "secret~x",
            "plain",
        ] {
            assert_eq!(DocKey::parse(bad), None, "{}", bad);
        }
        for key in [
            DocKey::Settings,
            DocKey::Item("x".into()),
            DocKey::Account("x".into()),
            DocKey::Occ {
                date: d(2026, 1, 2),
                item_id: "x".into(),
            },
        ] {
            assert_eq!(DocKey::parse(&key.doc_id()), Some(key.clone()));
            assert!(key.doc_id().starts_with(key.kind()));
        }
        assert!(!valid_id(&"a".repeat(65)));
        assert!(valid_id(&"a".repeat(64)));
    }

    #[test]
    fn reads_what_it_can_and_says_what_it_cant() {
        let mut snapshot = Snapshot::default();
        let rent = serde_json::to_string(&rent()).unwrap();
        let over = Override {
            item_id: "rent".into(),
            date: d(2026, 11, 1),
            status: OccStatus::Skipped,
            amount_cents: None,
            moved_to: None,
            note: None,
            updated_at: DateTime::UNIX_EPOCH,
        };
        let applied = snapshot.apply(vec![
            doc("item~rent", Some(rent.clone())),
            doc(
                "occ~2026-11-01~rent",
                Some(serde_json::to_string(&over).unwrap()),
            ),
            doc("settings~account", Some("{}".into())),
            // Its id isn't its document's
            doc("item~other", Some(rent.clone())),
            doc(
                "occ~2026-11-02~rent",
                Some(serde_json::to_string(&over).unwrap()),
            ),
            doc("item~broken", Some("{".into())),
            doc("settings~device", Some("{}".into())),
            IncomingDoc {
                doc_id: "item~future".into(),
                json: Some("{}".into()),
                schema: BUDGET_SCHEMA + 1,
            },
        ]);
        assert_eq!(
            applied,
            DocsApplied {
                applied: 3,
                held: vec!["item~future".into()],
                unreadable: vec![
                    "item~broken".into(),
                    "item~other".into(),
                    "occ~2026-11-02~rent".into(),
                    "settings~device".into()
                ],
            }
        );
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.overrides.len(), 1);
        assert_eq!(snapshot.settings(), Settings::default());

        // An unreadable one fixed, a held one deleted, the rest deleted
        let applied = snapshot.apply(vec![
            doc("item~broken", None),
            doc("item~future", None),
            doc("item~rent", None),
            doc("occ~2026-11-01~rent", None),
            doc("settings~account", None),
            doc("settings~account", Some("7".into())),
            doc("occ~2026-11-01~rent", Some("{}".into())),
        ]);
        assert_eq!(applied.applied, 5);
        assert!(applied.held.is_empty());
        assert_eq!(snapshot.items.len(), 0);
        assert!(snapshot.settings.is_none());
        assert!(snapshot.overrides.is_empty());
        // An item without a schedule can't be read
        let mut empty = super::tests::rent();
        empty.schedule.clear();
        let applied = snapshot.apply(vec![doc(
            "item~rent",
            Some(serde_json::to_string(&empty).unwrap()),
        )]);
        assert_eq!(applied.unreadable.len(), 6);
    }

    #[test]
    fn a_date_outside_the_calendar_doesnt_read() {
        let mut snapshot = Snapshot::default();
        let mut far = rent();
        far.id = "far".into();
        far.schedule[0].until = Some(d(20266, 1, 1));
        let mut early = rent();
        early.id = "early".into();
        early.schedule[0].from = d(1899, 12, 31);
        let over = |date: NaiveDate, moved_to: Option<NaiveDate>, status: OccStatus| {
            serde_json::to_string(&Override {
                item_id: "rent".into(),
                date,
                status,
                amount_cents: None,
                moved_to,
                note: None,
                updated_at: DateTime::UNIX_EPOCH,
            })
            .unwrap()
        };
        let paid = |on| OccStatus::Done {
            on,
            amount_cents: 1,
        };
        let applied = snapshot.apply(vec![
            doc("item~far", Some(serde_json::to_string(&far).unwrap())),
            doc("item~early", Some(serde_json::to_string(&early).unwrap())),
            doc(
                "occ~0001-01-01~rent",
                Some(over(d(1, 1, 1), None, OccStatus::Skipped)),
            ),
            doc(
                "occ~2026-11-01~rent",
                Some(over(d(2026, 11, 1), Some(d(9999, 1, 1)), OccStatus::Open)),
            ),
            doc(
                "occ~2026-12-01~rent",
                Some(over(d(2026, 12, 1), None, paid(d(1800, 1, 1)))),
            ),
            doc(
                "settings~account",
                Some(
                    serde_json::to_string(&Settings {
                        balance: Some(crate::model::Balance {
                            cents: 1,
                            as_of: d(1800, 1, 1),
                        }),
                        ..Settings::default()
                    })
                    .unwrap(),
                ),
            ),
            // Within it: read
            doc(
                "occ~2027-01-01~rent",
                Some(over(d(2027, 1, 1), None, paid(d(2026, 12, 31)))),
            ),
        ]);
        assert_eq!(applied.applied, 1);
        assert_eq!(applied.unreadable.len(), 6);
        assert!(snapshot.items.is_empty() && snapshot.settings.is_none());
    }

    #[test]
    fn writes_take_effect_at_once_and_undo_to_what_was_there() {
        let mut snapshot = Snapshot::default();
        let (write, undo) = snapshot
            .write(DocKey::Item("rent".into()), Some(&rent()))
            .unwrap();
        assert_eq!(write.doc_id, "item~rent");
        assert_eq!(write.kind, "item");
        // Nothing a newer schema added: the base one, which every BudgetMint since 1.5 reads
        assert_eq!(write.schema, BASE_SCHEMA);
        assert!(write.json.is_some());
        assert_eq!(undo.json, None);
        assert!(snapshot.items.contains_key("rent"));
        // The same again changes nothing
        assert!(snapshot
            .write(DocKey::Item("rent".into()), Some(&rent()))
            .is_none());
        // The client's echo of it changes nothing either
        snapshot.apply(vec![doc("item~rent", write.json.clone())]);
        let (delete, undo) = snapshot
            .write::<Item>(DocKey::Item("rent".into()), None)
            .unwrap();
        assert_eq!(delete.json, None);
        assert_eq!(undo.json, write.json);
        assert!(snapshot.items.is_empty());
    }

    #[test]
    fn writes_only_what_needs_it_newer_and_never_lowers_a_documents_schema() {
        use crate::model::SaveUp;
        let mut snapshot = Snapshot::default();
        let mut goal = rent();
        goal.save_up = Some(SaveUp {
            since: d(2026, 11, 10),
            saved_cents: Some(30_000),
        });
        // An amount set aside already: what older BudgetMints would drop, so they hold it
        let (write, undo) = snapshot
            .write(DocKey::Item("rent".into()), Some(&goal))
            .unwrap();
        assert_eq!((write.schema, undo.schema), (3, 3));
        // Without it again, still 3: the rules refuse a lower one, and the undo follows the write
        goal.save_up = None;
        let (write, undo) = snapshot
            .write(DocKey::Item("rent".into()), Some(&goal))
            .unwrap();
        assert_eq!((write.schema, undo.schema), (3, 3));
        // The rest stays the base schema, readable everywhere
        let (settings, _) = snapshot
            .write(DocKey::Settings, Some(&Settings::default()))
            .unwrap();
        assert_eq!(settings.schema, BASE_SCHEMA);
        // One read as written by 1.4 is written as the base one
        snapshot.apply(vec![IncomingDoc {
            doc_id: "item~old".into(),
            json: Some(
                serde_json::to_string(&Item {
                    id: "old".into(),
                    ..rent()
                })
                .unwrap(),
            ),
            schema: 1,
        }]);
        let renamed = Item {
            id: "old".into(),
            name: "Old rent".into(),
            ..rent()
        };
        let (write, _) = snapshot
            .write(DocKey::Item("old".into()), Some(&renamed))
            .unwrap();
        assert_eq!(write.schema, BASE_SCHEMA);
        // One written as 3 is read here; one newer still is held
        let applied = snapshot.apply(vec![
            IncomingDoc {
                doc_id: "item~old".into(),
                json: write.json.clone(),
                schema: 3,
            },
            IncomingDoc {
                doc_id: "item~later".into(),
                json: Some("{}".into()),
                schema: BUDGET_SCHEMA + 1,
            },
        ]);
        assert_eq!(applied.held, vec!["item~later".to_string()]);
        assert_eq!(snapshot.items["old"].name, "Old rent");
    }

    fn savings() -> Account {
        Account {
            id: "savings".into(),
            name: "Savings".into(),
            order: 1,
            balance: None,
            low_balance_cents: 500,
            checks: Vec::new(),
            archived: false,
        }
    }

    #[test]
    fn keeps_the_accounts_besides_the_main_one_which_is_the_settings() {
        let mut snapshot = Snapshot::default();
        // With no account documents there's still the main one, as the settings have it
        let main = snapshot.account(MAIN_ACCOUNT).unwrap();
        assert_eq!((main.name.as_str(), main.balance), ("Main account", None));
        assert_eq!(snapshot.all_accounts(), vec![main]);
        assert_eq!(snapshot.account("savings"), None);

        let balance = crate::model::Balance {
            cents: 700,
            as_of: d(2026, 11, 9),
        };
        let settings = Settings {
            balance: Some(balance),
            low_balance_cents: 100,
            ..Settings::default()
        };
        snapshot.write(DocKey::Settings, Some(&settings));
        let (write, undo) = snapshot
            .write(DocKey::Account("savings".into()), Some(&savings()))
            .unwrap();
        assert_eq!(
            (write.kind.as_str(), write.schema, undo.schema),
            ("account", 4, 4)
        );
        assert_eq!(write.doc_id, "account~savings");
        let closed = Account {
            id: "old".into(),
            name: "Old".into(),
            order: 1,
            archived: true,
            ..savings()
        };
        snapshot.write(DocKey::Account("old".into()), Some(&closed));
        // The main one named: only its name and place are taken from its document
        let named = Account {
            id: MAIN_ACCOUNT.into(),
            name: "Checking".into(),
            order: 2,
            balance: None,
            low_balance_cents: 9_999,
            checks: Vec::new(),
            archived: true,
        };
        snapshot.write(DocKey::Account(MAIN_ACCOUNT.into()), Some(&named));
        let main = snapshot.account(MAIN_ACCOUNT).unwrap();
        assert_eq!(
            (
                main.name.as_str(),
                main.balance,
                main.low_balance_cents,
                main.archived
            ),
            ("Checking", Some(balance), 100, false)
        );
        let names = |accounts: Vec<Account>| -> Vec<String> {
            accounts.into_iter().map(|account| account.name).collect()
        };
        assert_eq!(
            names(snapshot.all_accounts()),
            ["Old", "Savings", "Checking"]
        );
        assert_eq!(names(snapshot.live_accounts()), ["Savings", "Checking"]);

        // One that isn't its document's, or dated outside the calendar, doesn't read; deleted, it's gone
        let far = Account {
            balance: Some(crate::model::Balance {
                cents: 1,
                as_of: d(1800, 1, 1),
            }),
            ..savings()
        };
        let applied = snapshot.apply(vec![
            doc(
                "account~other",
                Some(serde_json::to_string(&savings()).unwrap()),
            ),
            doc(
                "account~savings",
                Some(serde_json::to_string(&far).unwrap()),
            ),
            doc("account~old", None),
        ]);
        assert_eq!(applied.unreadable, ["account~other", "account~savings"]);
        assert_eq!(names(snapshot.all_accounts()), ["Savings", "Checking"]);
    }

    #[test]
    fn an_item_in_another_account_or_a_transfer_is_a_newer_document() {
        let mut snapshot = Snapshot::default();
        let schema = |snapshot: &mut Snapshot, item: &Item| {
            snapshot
                .write(DocKey::Item(item.id.clone()), Some(item))
                .unwrap()
                .0
                .schema
        };
        let mut bill = rent();
        assert_eq!(schema(&mut snapshot, &bill), BASE_SCHEMA);
        bill.account_id = Some("savings".into());
        assert_eq!(schema(&mut snapshot, &bill), 4);
        // Back in the main account: still 4, since a schema is never lowered
        bill.account_id = None;
        assert_eq!(schema(&mut snapshot, &bill), 4);
        let moved = Item {
            id: "move".into(),
            kind: ItemKind::Transfer,
            to_account_id: Some("savings".into()),
            ..rent()
        };
        assert_eq!(schema(&mut snapshot, &moved), 4);
        // To the main account from another: no destination written, and still a transfer
        let back = Item {
            id: "back".into(),
            kind: ItemKind::Transfer,
            ..rent()
        };
        assert_eq!(schema(&mut snapshot, &back), 4);
        let odd = Item {
            id: "odd".into(),
            to_account_id: Some("savings".into()),
            ..rent()
        };
        assert_eq!(schema(&mut snapshot, &odd), 4);
        // The settings and what's said of an occurrence stay the base schema
        assert_eq!(Versioned::schema(&Settings::default()), BASE_SCHEMA);
    }
}
