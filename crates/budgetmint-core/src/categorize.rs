//! Who a statement's line was paid to, and the category it most likely
//! belongs in: a merchant's name out of what the bank wrote ("WM SUPERCENTER
//! #2780" and "WAL-MART #2780 -149" are both Walmart), and a category for it
//! from what the user chose for that merchant before, else from the
//! merchants and words known here.

use crate::docs::Snapshot;
use crate::model::CategoryRule;
use std::collections::BTreeMap;

/// What a card processor puts before the merchant's own name.
const PROCESSORS: &[&str] = &[
    "SQ", "TST", "PAYPAL", "FSP", "SP", "WEB", "CTLP", "MED", "FLF", "DD", "GOOGLE", "POS",
];

/// What's known of a merchant by words in its line (upper case, `*` as a
/// space): the name it goes by (none: the line's own, cleaned) and its
/// category. The first that fits is taken, so the longer come first.
const KNOWN: &[(&str, &str, &str)] = &[
    ("GOOGLE FI", "Google Fi", "Phone & internet"),
    ("GOOGLE CLOUD", "Google Cloud", "Software"),
    ("SPOTIFY", "Spotify", "Subscriptions"),
    ("YOUTUBE", "YouTube", "Subscriptions"),
    ("NETFLIX", "Netflix", "Subscriptions"),
    ("DISNEY PLUS", "Disney+", "Subscriptions"),
    ("HULU", "Hulu", "Subscriptions"),
    ("PADDLE.NET", "Paddle", "Software"),
    ("BLUEHOST", "Bluehost", "Software"),
    ("ANTHROPIC", "Anthropic", "Software"),
    ("OPENAI", "OpenAI", "Software"),
    ("GITHUB", "GitHub", "Software"),
    ("WM SUPERCENTER", "Walmart", "Groceries"),
    ("WAL-MART", "Walmart", "Groceries"),
    ("WALMART", "Walmart", "Groceries"),
    ("WINCO", "WinCo Foods", "Groceries"),
    ("ALBERTSONS", "Albertsons", "Groceries"),
    ("FRED-MEYER", "Fred Meyer", "Groceries"),
    ("FRED MEYER", "Fred Meyer", "Groceries"),
    ("KROGER", "Kroger", "Groceries"),
    ("SAFEWAY", "Safeway", "Groceries"),
    ("COSTCO", "Costco", "Groceries"),
    ("TRADER JOE", "Trader Joe’s", "Groceries"),
    ("GROCERY", "", "Groceries"),
    ("MAVERIK", "Maverik", "Gas"),
    ("CHEVRON", "Chevron", "Gas"),
    ("SHELL OIL", "Shell", "Gas"),
    ("EXXON", "Exxon", "Gas"),
    ("SINCLAIR", "Sinclair", "Gas"),
    ("ROCKET MORTGAGE", "Rocket Mortgage", "Housing"),
    ("MORTGAGE", "", "Housing"),
    ("IDAHO POWER", "Idaho Power", "Utilities"),
    ("CITY OF ", "", "Utilities"),
    ("QUANTUM FIBER", "Quantum Fiber", "Phone & internet"),
    ("COMCAST", "Comcast", "Phone & internet"),
    ("VERIZON", "Verizon", "Phone & internet"),
    ("T-MOBILE", "T-Mobile", "Phone & internet"),
    ("AMAZON", "Amazon", "Shopping"),
    ("TARGET", "Target", "Shopping"),
    ("MICHAELS", "Michaels", "Shopping"),
    ("HOBBYLOBBY", "Hobby Lobby", "Shopping"),
    ("HOBBY LOBBY", "Hobby Lobby", "Shopping"),
    ("ETSY", "Etsy", "Shopping"),
    ("ULTA", "Ulta Beauty", "Shopping"),
    ("HOME DEPOT", "The Home Depot", "Shopping"),
    ("DOLLARTREE", "Dollar Tree", "Shopping"),
    ("DOLLAR TREE", "Dollar Tree", "Shopping"),
    ("T J MAXX", "T.J. Maxx", "Shopping"),
    ("NORDSTROM", "Nordstrom Rack", "Shopping"),
    ("ROSS DRESS", "Ross", "Shopping"),
    ("DOORDASH", "DoorDash", "Dining"),
    ("MCDONALD", "McDonald’s", "Dining"),
    ("TACO BELL", "Taco Bell", "Dining"),
    ("JACK IN THE BOX", "Jack in the Box", "Dining"),
    ("IN-N-OUT", "In-N-Out Burger", "Dining"),
    ("DUTCH BROS", "Dutch Bros", "Dining"),
    ("LITTLE CAESARS", "Little Caesars", "Dining"),
    ("CHICK-FIL-A", "Chick-fil-A", "Dining"),
    ("PIZZA HUT", "Pizza Hut", "Dining"),
    ("STARBUCKS", "Starbucks", "Dining"),
    ("PIZZA", "", "Dining"),
    ("TACO", "", "Dining"),
    ("BURGER", "", "Dining"),
    ("GRILL", "", "Dining"),
    ("BREWING", "", "Dining"),
    ("BREWERY", "", "Dining"),
    ("BAKERY", "", "Dining"),
    ("COFFEE", "", "Dining"),
    ("RESTAURANT", "", "Dining"),
    ("WALGREENS", "Walgreens", "Health"),
    ("CVS", "CVS", "Health"),
    ("PHARMACY", "", "Health"),
    ("PETCO", "Petco", "Pets"),
    ("PETSMART", "PetSmart", "Pets"),
    ("PET WANTS", "", "Pets"),
    ("O'REILLY", "O’Reilly Auto Parts", "Car"),
    ("JIFFY LUBE", "Jiffy Lube", "Car"),
    ("AUTOZONE", "AutoZone", "Car"),
];

/// The line as the table reads it: upper case, a `*` a space, one space between words.
fn plain(description: &str) -> String {
    description
        .to_uppercase()
        .replace('*', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn known(description: &str) -> Option<(&'static str, &'static str)> {
    let plain = plain(description);
    KNOWN
        .iter()
        .find(|(words, _, _)| plain.contains(words))
        .map(|(_, name, category)| (*name, *category))
}

/// A word as a name has it: its first letter a capital, the rest small.
fn titled(word: &str) -> String {
    word.chars()
        .enumerate()
        .flat_map(|(at, c)| {
            if at == 0 {
                c.to_uppercase().collect::<Vec<_>>()
            } else {
                c.to_lowercase().collect()
            }
        })
        .collect()
}

/// Who a line was paid to (or came from), as a name: the one a known
/// merchant goes by, else the line's own words without the processor before
/// them, the store's number and the codes after (a bank's capitals made a
/// name's). A person's payment ("Sam Lee: rent") is the person.
pub fn merchant_name(description: &str) -> String {
    let who = description.split(": ").next().unwrap_or_default();
    if let Some((name, _)) = known(who).filter(|(name, _)| !name.is_empty()) {
        return name.to_string();
    }
    let spaced = who.replace('*', " ");
    let mut words: Vec<&str> = spaced.split_whitespace().collect();
    while words.len() > 1 && PROCESSORS.contains(&words[0].to_uppercase().as_str()) {
        words.remove(0);
    }
    words
        .iter()
        .enumerate()
        // The first word stays whatever it is; after it, a store's number or a code goes
        .filter(|(at, word)| *at == 0 || !word.bytes().any(|b| b.is_ascii_digit() || b == b'#'))
        .map(|(_, word)| {
            if word.chars().any(char::is_lowercase) {
                word.to_string()
            } else {
                titled(word)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A merchant's name as the rules and the grouping know it: its letters and
/// digits, lower case, a space between words.
pub fn merchant_key(name: &str) -> String {
    name.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// What suggests a category for a merchant: the user's own choices first.
pub struct Categories {
    rules: BTreeMap<String, String>,
    /// What each merchant's latest kept transaction was put in.
    kept: BTreeMap<String, String>,
}

impl Categories {
    pub fn new(snapshot: &Snapshot) -> Categories {
        let rules = snapshot
            .settings()
            .category_rules
            .unwrap_or_default()
            .into_iter()
            .map(|CategoryRule { merchant, category }| (merchant, category))
            .collect();
        let mut latest = BTreeMap::new();
        for transaction in snapshot
            .transactions
            .values()
            .flat_map(|month| &month.transactions)
        {
            if let Some(category) = &transaction.category {
                let at = latest
                    .entry(merchant_key(&transaction.name))
                    .or_insert((transaction.on, category));
                if transaction.on >= at.0 {
                    *at = (transaction.on, category);
                }
            }
        }
        Categories {
            rules,
            kept: latest
                .into_iter()
                .map(|(key, (_, category))| (key, category.clone()))
                .collect(),
        }
    }

    /// The category for a line: the one remembered for its merchant, the one
    /// its merchant was last kept with, or the one known here for it.
    pub fn suggest(&self, description: &str) -> Option<String> {
        let key = merchant_key(&merchant_name(description));
        self.rules
            .get(&key)
            .or_else(|| self.kept.get(&key))
            .cloned()
            .or_else(|| known(description).map(|(_, category)| category.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::DocKey;
    use crate::model::{LineFlow, MonthTransactions, Settings, Transaction};
    use crate::occur::tests::d;

    #[test]
    fn names_the_merchant_a_line_was_paid_to() {
        for (line, name) in [
            ("WM SUPERCENTER #2780", "Walmart"),
            ("WAL-MART #2780       -172", "Walmart"),
            ("Walmart", "Walmart"),
            ("GOOGLE*FI 94CQX6", "Google Fi"),
            ("GOOGLE *Spotify Music", "Spotify"),
            ("PAYPAL *DISNEY PLUS", "Disney+"),
            ("Maverik #00430 CALDWEL", "Maverik"),
            ("AMAZON MKTPL*5E2677W40", "Amazon"),
            ("SQ *WHITE DOG BREWING", "White Dog Brewing"),
            ("TST* EUREKA RESTAURANT", "Eureka Restaurant"),
            ("IDAGO 2", "Idago"),
            ("VAPE 2922", "Vape"),
            ("ULTA # 460 -n63", "Ulta Beauty"),
            ("Liza McElroy: Truck/loan", "Liza McElroy"),
            ("SQ", "Sq"),
            ("7-ELEVEN 3301", "7-eleven"),
            ("Corner Cafe 12", "Corner Cafe"),
            ("", ""),
        ] {
            assert_eq!(merchant_name(line), name, "{:?}", line);
        }
        assert_eq!(merchant_key("McDonald’s"), "mcdonald s");
        assert_eq!(merchant_key("  White  Dog-Brewing "), "white dog brewing");
    }

    #[test]
    fn suggests_what_the_user_chose_before_what_is_known_here() {
        let mut s = Snapshot::default();
        let categories = Categories::new(&s);
        assert_eq!(
            categories.suggest("WM SUPERCENTER #2780").as_deref(),
            Some("Groceries")
        );
        assert_eq!(categories.suggest("SQ *GYRO SHACK - FOOD").as_deref(), None);
        assert_eq!(
            categories.suggest("GARBONZOS PIZZA").as_deref(),
            Some("Dining")
        );
        // Kept before: the merchant's latest, whichever order they're in
        let kept = |id: &str, on, name: &str, category: Option<&str>| Transaction {
            id: id.into(),
            on,
            amount_cents: -500,
            name: name.into(),
            category: category.map(str::to_string),
            flow: LineFlow::Spend,
            item_id: None,
        };
        s.write(
            DocKey::Txns {
                account_id: "main".into(),
                month: "2026-10".into(),
            },
            Some(&MonthTransactions {
                account_id: "main".into(),
                month: "2026-10".into(),
                transactions: vec![
                    kept("a", d(2026, 10, 9), "Walmart", Some("Household")),
                    kept("b", d(2026, 10, 2), "Walmart", Some("Food")),
                    kept("c", d(2026, 10, 3), "Gyro Shack - Food", Some("Dining")),
                    kept("d", d(2026, 10, 4), "Idago", None),
                    kept("e", d(2026, 10, 12), "Gyro Shack - Food", Some("Lunch")),
                ],
            }),
        );
        let categories = Categories::new(&s);
        assert_eq!(
            categories.suggest("WAL-MART #2780").as_deref(),
            Some("Household")
        );
        assert_eq!(
            categories.suggest("SQ *GYRO SHACK - FOOD").as_deref(),
            Some("Lunch")
        );
        assert_eq!(categories.suggest("IDAGO 2"), None);
        // A rule of the user's comes before both
        s.write(
            DocKey::Settings,
            Some(&Settings {
                category_rules: Some(vec![CategoryRule {
                    merchant: "walmart".into(),
                    category: "Everything".into(),
                }]),
                ..Settings::default()
            }),
        );
        assert_eq!(
            Categories::new(&s).suggest("Walmart").as_deref(),
            Some("Everything")
        );
    }
}
