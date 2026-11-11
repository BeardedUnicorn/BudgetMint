//! What every app calls, through crates/budgetmint-wasm: the account's
//! data in memory (the documents the client reads, TaskMint's forecast), and
//! commands as JSON in and out, with the time in milliseconds and the zone
//! the user is in. A command that fails changes nothing.

use crate::command::{execute, Budget, Command};
use crate::time::Ctx;
use serde_json::Value;

#[derive(Debug, Default)]
pub struct JsonHost {
    budget: Budget,
    zone: String,
}

impl JsonHost {
    /// `zone`: the device's IANA time zone (`Intl`); UTC when core doesn't know it.
    pub fn new(zone: &str) -> Self {
        Self {
            budget: Budget::default(),
            zone: zone.to_string(),
        }
    }

    /// Now in another zone (the user travelled, or changed the device's).
    pub fn set_zone(&mut self, zone: &str) {
        self.zone = zone.to_string();
    }

    /// Runs a command: its arguments as JSON text; the reply as JSON text,
    /// or the message to show.
    pub fn call(&mut self, name: &str, args: &str, now_ms: f64) -> Result<String, String> {
        let args: Value = serde_json::from_str(args)
            .map_err(|e| format!("Invalid arguments for {}: {}", name, e))?;
        let command = Command::parse(name, args).map_err(|e| e.to_string())?;
        let ctx = Ctx::new(now_ms as i64, &self.zone);
        // On a copy, so a refusal halfway leaves nothing half done
        let mut draft = self.budget.clone();
        let reply = execute(command, &mut draft, &ctx).map_err(|e| e.to_string())?;
        self.budget = draft;
        Ok(reply.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_and_gives_json_in_the_users_zone() {
        let mut host = JsonHost::new("America/Chicago");
        // Nov 10, 2026, 3:00 UTC: still the 9th in Chicago
        let now = 1_794_279_600_000.0;
        let overview: Value =
            serde_json::from_str(&host.call("get_overview", "{}", now).unwrap()).unwrap();
        assert_eq!(overview["today"], "2026-11-09");
        host.set_zone("Asia/Tokyo");
        let overview: Value =
            serde_json::from_str(&host.call("get_overview", "null", now).unwrap()).unwrap();
        assert_eq!(overview["today"], "2026-11-10");
        assert_eq!(JsonHost::default().zone, "");

        assert_eq!(
            host.call("get_overview", "{", now),
            Err("Invalid arguments for get_overview: EOF while parsing an object at line 1 column 1".into())
        );
        assert_eq!(
            host.call("nothing", "{}", now),
            Err("Unknown command: nothing".into())
        );
        assert_eq!(
            host.call(
                "set_balance",
                r#"{"balance":{"cents":1,"asOf":"2030-01-01"}}"#,
                now
            ),
            Err("Set the balance as of today or a day before".into())
        );
        let settings: Value =
            serde_json::from_str(&host.call("get_settings", "{}", now).unwrap()).unwrap();
        let expected = crate::command::SettingsView {
            settings: Default::default(),
            saved: false,
        };
        assert_eq!(settings, serde_json::to_value(expected).unwrap());
    }

    #[test]
    fn refuses_an_edit_to_an_item_deleted_meanwhile() {
        let mut host = JsonHost::new("UTC");
        let now = 1_794_279_600_000.0;
        let save = |edit: &str| {
            format!(
                r#"{{"item":{{"id":"rent","kind":"bill","name":"Rent","schedule":[
                    {{"from":"2026-11-01","repeat":{{"every":"once"}},"amountCents":100}}]}}{}}}"#,
                edit
            )
        };
        assert_eq!(
            host.call("save_item", &save(r#","edit":true"#), now),
            Err("That bill isn't there any more (deleted on another device?)".into())
        );
        assert!(host.call("save_item", &save(""), now).is_ok());
        assert!(host
            .call("save_item", &save(r#","edit":true"#), now)
            .is_ok());
    }

    #[test]
    fn no_clock_or_argument_makes_it_panic() {
        let mut host = JsonHost::new("Pacific/Kiritimati");
        let now = 1_794_279_600_000.0;
        let item = r#"{"item":{"id":"rent","kind":"bill","name":"Rent","schedule":[
            {"from":"2199-12-31","repeat":{"every":"days","n":1},"amountCents":100}]}}"#;
        host.call("save_item", item, now).unwrap();
        host.call(
            "set_balance",
            r#"{"balance":{"cents":-5,"asOf":"2026-11-10"}}"#,
            now,
        )
        .unwrap();
        let queries = [
            ("get_overview", "{}"),
            ("get_forecast", "{}"),
            ("get_items", "{}"),
            ("get_month", r#"{"month":"2199-12"}"#),
            (
                "get_item_history",
                r#"{"itemId":"rent","from":"-262143-01-01","to":"+262142-12-31"}"#,
            ),
            (
                "get_reminders",
                r#"{"windowDays":65535,"max":65535,"missedSinceMs":-9223372036854775808}"#,
            ),
        ];
        for now in [f64::MAX, f64::MIN, f64::NAN, 0.0, 7_258_118_400_000.0] {
            for (name, args) in queries {
                assert!(host.call(name, args, now).is_ok(), "{} at {}", name, now);
            }
        }
    }
}
