//! The webview's one command: `dispatch`, by name (as TaskMint's). There's
//! no data behind it (that's the cloud's, in the webview): every command is
//! the shell's own.

use crate::google_sign_in::{sign_in_with_google, GoogleClient};
use crate::reminders::{self, Reminder};
use crate::state::AppState;
use crate::tray;
use crate::updates;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

/// Every command, by name.
pub const COMMANDS: &[&str] = &[
    "get_capabilities",
    "request_notifications",
    "show_notification",
    "schedule_reminders",
    "set_tray_status",
    "get_autostart",
    "set_autostart",
    "google_sign_in",
    "check_for_update",
    "install_update",
];

#[derive(Deserialize)]
struct ScheduleArgs {
    reminders: Vec<Reminder>,
}

#[derive(Deserialize)]
struct NotifyArgs {
    title: String,
    body: String,
}

#[derive(Deserialize)]
struct AutostartArgs {
    enabled: bool,
}

#[derive(Deserialize)]
struct TrayArgs {
    lines: Vec<String>,
}

fn args<T: DeserializeOwned>(command: &str, args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("Invalid arguments for {}: {}", command, e))
}

/// Runs `command` with `args`; its reply, or the message to show.
pub fn run(state: &AppState, command: &str, value: Value) -> Result<Value, String> {
    let platform = state.platform.as_ref();
    match command {
        "get_capabilities" => {
            Ok(json!({ "runtime": if platform.is_mobile() { "mobile" } else { "desktop" } }))
        }
        "request_notifications" => Ok(json!(platform.request_notifications()?)),
        "show_notification" => {
            let NotifyArgs { title, body } = args(command, value)?;
            platform.notify(&title, &body)?;
            Ok(Value::Null)
        }
        "schedule_reminders" => {
            let ScheduleArgs { reminders: list } = args(command, value)?;
            reminders::schedule(&state.reminders, platform, list)?;
            Ok(Value::Null)
        }
        "set_tray_status" => {
            let TrayArgs { lines } = args(command, value)?;
            platform.render_tray(&tray::menu(&lines))?;
            Ok(Value::Null)
        }
        "get_autostart" => Ok(json!(platform.autostart()?)),
        "set_autostart" => {
            let AutostartArgs { enabled } = args(command, value)?;
            platform.set_autostart(enabled)?;
            Ok(Value::Null)
        }
        "google_sign_in" => {
            let client: GoogleClient = args(command, value)?;
            sign_in_with_google(platform, &client)
        }
        "check_for_update" => Ok(json!(platform.check_update()?)),
        "install_update" => {
            updates::install(state)?;
            Ok(Value::Null)
        }
        _ => Err(format!("Unknown command: {}", command)),
    }
}

/// The command the webview calls (it always sends `args`, `{}` for none).
/// It runs off the async runtime, since some commands wait (the browser,
/// the updater).
#[tauri::command]
pub async fn dispatch(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    command: String,
    args: Value,
) -> Result<Value, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run(&state, &command, args))
        .await
        .expect("commands don't panic")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use crate::platform::AvailableUpdate;
    use crate::testing::{fixture, with_platform};

    #[test]
    fn says_what_runs_it() {
        assert_eq!(
            run(&fixture().state, "get_capabilities", Value::Null),
            Ok(json!({ "runtime": "desktop" }))
        );
        let phone = with_platform(FakePlatform::mobile());
        assert_eq!(
            run(&phone.state, "get_capabilities", Value::Null),
            Ok(json!({ "runtime": "mobile" }))
        );
        assert_eq!(
            run(&phone.state, "nope", Value::Null),
            Err("Unknown command: nope".to_string())
        );
        assert_eq!(COMMANDS.len(), 10);
    }

    #[test]
    fn asks_for_notifications() {
        let f = fixture();
        assert_eq!(
            run(&f.state, "request_notifications", Value::Null),
            Ok(json!(true))
        );
        *f.platform.denied.lock().unwrap() = true;
        assert_eq!(
            run(&f.state, "request_notifications", Value::Null),
            Ok(json!(false))
        );
        f.platform.fail("request_notifications");
        assert!(run(&f.state, "request_notifications", Value::Null).is_err());

        let notice = json!({ "title": "BudgetMint 0.2.0 is available", "body": "Open BudgetMint to install it." });
        assert_eq!(
            run(&f.state, "show_notification", notice.clone()),
            Ok(Value::Null)
        );
        assert_eq!(
            f.platform.recorded().notifications[0].0,
            "BudgetMint 0.2.0 is available"
        );
        assert!(run(&f.state, "show_notification", json!({ "title": 1 })).is_err());
        f.platform.fail("notify");
        assert!(run(&f.state, "show_notification", notice).is_err());
    }

    #[test]
    fn schedules_reminders_and_shows_the_trays_lines() {
        let f = fixture();
        let reminders =
            json!({ "reminders": [{ "id": 1, "atMs": 0, "title": "Rent", "body": "$1" }] });
        assert_eq!(
            run(&f.state, "schedule_reminders", reminders),
            Ok(Value::Null)
        );
        assert_eq!(f.state.reminders.take_due(0).len(), 1);
        assert!(run(&f.state, "schedule_reminders", json!({}))
            .unwrap_err()
            .starts_with("Invalid arguments for schedule_reminders"));

        assert_eq!(
            run(
                &f.state,
                "set_tray_status",
                json!({ "lines": ["Today: $1.00"] })
            ),
            Ok(Value::Null)
        );
        assert_eq!(f.platform.recorded().menus[0].0.len(), 4);
        assert!(run(&f.state, "set_tray_status", json!({ "lines": 3 })).is_err());
        f.platform.fail("tray");
        assert!(run(&f.state, "set_tray_status", json!({ "lines": [] })).is_err());
        let phone = with_platform(FakePlatform::mobile());
        phone.platform.fail("schedule");
        assert!(run(
            &phone.state,
            "schedule_reminders",
            json!({ "reminders": [{ "id": 1, "atMs": 0, "title": "", "body": "" }] })
        )
        .is_err());
    }

    #[test]
    fn opens_at_login_when_asked() {
        let f = fixture();
        assert_eq!(
            run(&f.state, "get_autostart", Value::Null),
            Ok(json!(false))
        );
        assert_eq!(
            run(&f.state, "set_autostart", json!({ "enabled": true })),
            Ok(Value::Null)
        );
        assert_eq!(run(&f.state, "get_autostart", Value::Null), Ok(json!(true)));
        assert!(run(&f.state, "set_autostart", json!({}))
            .unwrap_err()
            .starts_with("Invalid arguments for set_autostart"));
        f.platform.fail("autostart");
        assert!(run(&f.state, "get_autostart", Value::Null).is_err());
        assert!(run(&f.state, "set_autostart", json!({ "enabled": false })).is_err());
    }

    #[test]
    fn checks_for_updates_and_installs_one() {
        let f = fixture();
        assert_eq!(
            run(&f.state, "check_for_update", Value::Null),
            Ok(Value::Null)
        );
        f.platform.announce(AvailableUpdate {
            version: "0.2.0".into(),
            current_version: "0.1.0".into(),
            notes: Some("New".into()),
            date: None,
        });
        assert_eq!(
            run(&f.state, "check_for_update", Value::Null),
            Ok(
                json!({ "version": "0.2.0", "currentVersion": "0.1.0", "notes": "New", "date": null })
            )
        );
        assert_eq!(
            run(&f.state, "install_update", Value::Null),
            Ok(Value::Null)
        );
        assert_eq!(f.platform.recorded().restarts, 1);
        f.platform.fail("check_update");
        f.platform.fail("install_update");
        assert!(run(&f.state, "check_for_update", Value::Null).is_err());
        assert!(run(&f.state, "install_update", Value::Null).is_err());
    }

    /// The webview's view: an app on the mock runtime, managing `state`.
    fn webview(
        state: std::sync::Arc<AppState>,
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = tauri::test::mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![dispatch])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        (app, webview)
    }

    fn invoke(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: "dispatch".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    }

    #[test]
    fn the_webview_reaches_the_shell_through_ipc() {
        let f = fixture();
        let (_app, webview) = webview(std::sync::Arc::new(f.state));
        assert_eq!(
            invoke(
                &webview,
                json!({ "command": "get_capabilities", "args": {} })
            ),
            Ok(json!({ "runtime": "desktop" }))
        );
        assert_eq!(
            invoke(&webview, json!({ "command": "nope", "args": {} })),
            Err(json!("Unknown command: nope"))
        );
    }

    #[test]
    fn a_call_without_a_command_or_its_args_is_refused() {
        let f = fixture();
        let (_app, webview) = webview(std::sync::Arc::new(f.state));
        for body in [
            json!({ "args": {} }),
            json!({ "command": 7, "args": {} }),
            json!({ "command": "get_capabilities" }),
        ] {
            let error = invoke(&webview, body.clone()).unwrap_err();
            assert!(
                error.as_str().unwrap().contains("dispatch"),
                "{}: {}",
                body,
                error
            );
        }
    }

    #[test]
    fn signs_in_with_google_only_with_a_client() {
        let f = fixture();
        assert!(run(&f.state, "google_sign_in", json!({}))
            .unwrap_err()
            .starts_with("Invalid arguments for google_sign_in"));
        f.platform.fail("open_url");
        assert_eq!(
            run(
                &f.state,
                "google_sign_in",
                json!({ "clientId": "c", "clientSecret": "s" })
            ),
            Err("open_url failed".to_string())
        );
    }
}
