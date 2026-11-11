//! The documents BudgetMint keeps in `budgetmint/{uid}/data` (the rules are
//! TaskMint's: firebase/firestore.rules), and core's copy of them.
//!
//! | Document | Holds |
//! |---|---|
//! | `settings~account` | [`Settings`] |
//! | `item~{id}` | an [`Item`] |
//! | `occ~{YYYY-MM-DD}~{itemId}` | an [`Override`]: the occurrence its schedule puts on that date |
//!
//! The date leads an occurrence's id so the client can listen to a range of
//! dates. Each document's JSON is the type's; the client wraps it with the
//! fields the rules want (kind, schema, device, epoch, time).

use crate::model::{Item, Override, Settings};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The documents' schema: one written by a newer BudgetMint (a higher
/// number) is held, not read.
pub const BUDGET_SCHEMA: u32 = 1;

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
}

impl DocKey {
    /// The document `doc_id` names; None for one BudgetMint doesn't keep.
    pub fn parse(doc_id: &str) -> Option<DocKey> {
        let (kind, rest) = doc_id.split_once('~')?;
        match kind {
            "settings" if rest == "account" => Some(DocKey::Settings),
            "item" if valid_id(rest) => Some(DocKey::Item(rest.to_string())),
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
        }
    }

    /// The document's kind, as the rules spell it.
    pub fn kind(&self) -> &'static str {
        match self {
            DocKey::Settings => "settings",
            DocKey::Item(_) => "item",
            DocKey::Occ { .. } => "occ",
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
    /// Each document's JSON as read, to tell a change from none.
    json: BTreeMap<String, String>,
    held: BTreeSet<String>,
    unreadable: BTreeSet<String>,
}

impl Snapshot {
    /// The settings, or the defaults before any are saved.
    pub fn settings(&self) -> Settings {
        self.settings.clone().unwrap_or_default()
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
                Some(json) => self.json.insert(doc.doc_id, json),
                None => self.json.remove(&doc.doc_id),
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
    /// once, with the write that undoes it. None when nothing changes.
    pub fn write<T: Serialize>(
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
        let write = |json: Option<String>| DocWrite {
            doc_id: doc_id.clone(),
            kind: key.kind().to_string(),
            json,
            schema: BUDGET_SCHEMA,
        };
        let (done, undo) = (write(json.clone()), write(before));
        self.apply_one(IncomingDoc {
            doc_id: doc_id.clone(),
            json,
            schema: BUDGET_SCHEMA,
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
            }],
            autopay: false,
            reminder: None,
            archived: false,
            note: None,
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
        for bad in [
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
                schema: 2,
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
        assert_eq!(write.schema, BUDGET_SCHEMA);
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
}
