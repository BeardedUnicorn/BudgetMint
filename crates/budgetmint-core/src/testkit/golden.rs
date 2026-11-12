//! What a budget with one account answered before there could be more
//! (golden/*.json, one per scenario): every reply still holds what it held
//! then (new fields aside), and the cash flow after each step is the very
//! same. A change here is a change to what every single-account user sees:
//! regenerate a golden only when that is meant (the failure prints it).

use super::{holds, Scenario, SCENARIOS};
use crate::host::JsonHost;
use crate::project::project;
use crate::time::Ctx;
use chrono::Duration;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const GOLDEN: &[&str] = &[
    include_str!("golden/a_month_of_bills.json"),
    include_str!("golden/a_backup_restored.json"),
    include_str!("golden/a_balance_checked_and_money_set_aside.json"),
    include_str!("golden/a_week_around_the_balances_day.json"),
];

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Golden {
    /// Each step's reply (`ok`) or refusal (`error`).
    replies: Vec<Value>,
    /// The cash flow to the horizon after each step, as a hash of its every field.
    projections: Vec<String>,
}

/// FNV-1a, 64-bit.
fn hash(text: &str) -> String {
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    });
    format!("{:016x}", hash)
}

fn replay(scenario: &Scenario) -> Golden {
    let mut host = JsonHost::new(&scenario.zone);
    let ctx = Ctx::new(scenario.now_ms as i64, &scenario.zone);
    let mut golden = Golden {
        replies: Vec::new(),
        projections: Vec::new(),
    };
    for step in &scenario.steps {
        let args = if step.args.is_null() {
            "{}".to_string()
        } else {
            step.args.to_string()
        };
        let parsed = |text: String| serde_json::from_str::<Value>(&text).expect("JSON");
        golden
            .replies
            .push(match host.call(&step.call, &args, scenario.now_ms) {
                Ok(reply) => json!({ "ok": parsed(reply) }),
                Err(refusal) => json!({ "error": parsed(refusal)["message"] }),
            });
        let budget = host.budget();
        let end = ctx.today() + Duration::days(i64::from(budget.snapshot.settings().horizon_days));
        let projection = project(
            &budget.snapshot,
            budget.taskmint.forecast.as_ref(),
            &ctx,
            end,
        );
        golden.projections.push(hash(&format!("{:?}", projection)));
    }
    golden
}

#[test]
fn one_accounts_replies_and_cash_flow_are_what_they_were() {
    assert_eq!(SCENARIOS.len(), GOLDEN.len());
    let mut changed = Vec::new();
    for (text, golden) in SCENARIOS.iter().zip(GOLDEN) {
        let scenario: Scenario = serde_json::from_str(text).expect("a scenario");
        let was: Golden = serde_json::from_str(golden).expect("a golden");
        let now = replay(&scenario);
        let same = holds(&json!(was.replies), &json!(now.replies), "replies").and_then(|_| {
            (was.projections == now.projections)
                .then_some(())
                .ok_or("the cash flow changed".to_string())
        });
        if let Err(why) = same {
            changed.push(format!(
                "{}: {}\nGOLDEN-BEGIN\n{}\nGOLDEN-END",
                scenario.name,
                why,
                serde_json::to_string(&now).expect("plain data")
            ));
        }
    }
    assert!(changed.is_empty(), "{}", changed.join("\n"));
}
