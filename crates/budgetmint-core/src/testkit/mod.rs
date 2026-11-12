//! Conformance scenarios (scenarios/*.json): calls to the JSON host the
//! apps use, each with what its reply must hold (`expect`, matched as a
//! subset: an object's keys listed, an array's items in order) or the
//! error it must give. Every reply is also checked against its command's
//! declared type (command::check_reply), so the TypeScript the contracts
//! generate is what core sends.
//!
//! And TaskMint's golden fixtures (taskmint/*.json, pinned from TaskMint by
//! scripts/sync-upstream.mjs): read from the forecast alone, what a
//! withdrawal takes and the next withdrawal must be TaskMint's own answers.

use crate::command::{check_reply, COMMAND_NAMES};
use crate::host::JsonHost;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

mod golden;
mod taskmint;

const SCENARIOS: &[&str] = &[
    include_str!("scenarios/a_month_of_bills.json"),
    include_str!("scenarios/a_backup_restored.json"),
    include_str!("scenarios/a_balance_checked_and_money_set_aside.json"),
    include_str!("scenarios/a_week_around_the_balances_day.json"),
    include_str!("scenarios/several_bank_accounts.json"),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    name: String,
    zone: String,
    now_ms: f64,
    steps: Vec<Step>,
}

#[derive(Debug, Deserialize)]
struct Step {
    call: String,
    #[serde(default)]
    args: Value,
    expect: Option<Value>,
    error: Option<String>,
}

/// Whether `actual` holds `expected`: its keys (and only theirs) for an
/// object, the same items in order for an array, equal otherwise.
fn holds(expected: &Value, actual: &Value, path: &str) -> Result<(), String> {
    match (expected, actual) {
        (Value::Object(want), Value::Object(have)) => want.iter().try_for_each(|(key, value)| {
            let found = have
                .get(key)
                .ok_or_else(|| format!("{}.{} is missing", path, key))?;
            holds(value, found, &format!("{}.{}", path, key))
        }),
        (Value::Array(want), Value::Array(have)) if want.len() == have.len() => want
            .iter()
            .zip(have)
            .enumerate()
            .try_for_each(|(index, (value, found))| {
                holds(value, found, &format!("{}[{}]", path, index))
            }),
        _ if expected == actual => Ok(()),
        _ => Err(format!("{} is {}, not {}", path, actual, expected)),
    }
}

fn run(scenario: &Scenario) -> Result<BTreeSet<String>, String> {
    let mut host = JsonHost::new(&scenario.zone);
    let mut called = BTreeSet::new();
    for (index, step) in scenario.steps.iter().enumerate() {
        let at = format!("{} step {} ({})", scenario.name, index + 1, step.call);
        let args = if step.args.is_null() {
            "{}".to_string()
        } else {
            step.args.to_string()
        };
        called.insert(step.call.clone());
        // A refusal's message (it comes as JSON, with the field it's about)
        let result = host
            .call(&step.call, &args, scenario.now_ms)
            .map_err(|refusal| {
                let refusal: Value = serde_json::from_str(&refusal).expect("refusals are JSON");
                refusal["message"].as_str().expect("a message").to_string()
            });
        match (result, &step.error) {
            (Ok(reply), None) => {
                let reply: Value = serde_json::from_str(&reply).expect("replies are JSON");
                assert_eq!(
                    check_reply(&step.call, &reply),
                    Ok(()),
                    "{}: not its declared reply type",
                    at
                );
                if let Some(expected) = &step.expect {
                    holds(expected, &reply, "reply").map_err(|e| format!("{}: {}", at, e))?;
                }
            }
            (Err(message), Some(expected)) if message == *expected => {}
            (Ok(reply), Some(expected)) => {
                return Err(format!("{}: wanted \"{}\", got {}", at, expected, reply))
            }
            (Err(message), _) => return Err(format!("{}: {}", at, message)),
        }
    }
    Ok(called)
}

#[test]
fn every_scenario_holds_and_every_command_runs_in_one() {
    let mut called = BTreeSet::new();
    for text in SCENARIOS {
        let scenario: Scenario = serde_json::from_str(text).expect("a scenario");
        called.extend(run(&scenario).unwrap());
    }
    let missing: Vec<_> = COMMAND_NAMES
        .iter()
        .filter(|name| !called.contains(**name))
        .collect();
    assert!(missing.is_empty(), "no scenario runs {:?}", missing);
}

#[test]
fn the_runner_says_where_a_scenario_goes_wrong() {
    assert_eq!(
        holds(
            &serde_json::json!({ "a": [1] }),
            &serde_json::json!({ "a": [1], "b": 2 }),
            "reply"
        ),
        Ok(())
    );
    assert_eq!(
        holds(
            &serde_json::json!({ "a": 1 }),
            &serde_json::json!({}),
            "reply"
        ),
        Err("reply.a is missing".into())
    );
    assert_eq!(
        holds(&serde_json::json!([1, 2]), &serde_json::json!([1]), "reply"),
        Err("reply is [1], not [1,2]".into())
    );
    assert_eq!(
        holds(
            &serde_json::json!([{ "a": 1 }]),
            &serde_json::json!([{ "a": 2 }]),
            "reply"
        ),
        Err("reply[0].a is 2, not 1".into())
    );
    let scenario = |steps: Value| -> Scenario {
        serde_json::from_value(
            serde_json::json!({ "name": "t", "zone": "UTC", "nowMs": 0.0, "steps": steps }),
        )
        .unwrap()
    };
    assert!(run(&scenario(
        serde_json::json!([{ "call": "get_settings", "error": "x" }])
    ))
    .unwrap_err()
    .starts_with("t step 1 (get_settings): wanted \"x\", got {\"saved\":false"));
    assert_eq!(
        run(&scenario(serde_json::json!([{ "call": "nope" }]))).unwrap_err(),
        "t step 1 (nope): Unknown command: nope"
    );
    assert!(run(&scenario(
        serde_json::json!([{ "call": "get_settings", "expect": { "saved": true } }])
    ))
    .unwrap_err()
    .contains("reply.saved is false, not true"));
}
