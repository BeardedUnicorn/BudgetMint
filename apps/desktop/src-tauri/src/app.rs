// Adapted from TaskMint apps/desktop/src-tauri/src/app.rs @ 1623bee.
//! The Tauri app: plugins, the window, the tray and the reminders' thread.
//! It needs a real event loop and main thread, so the coverage policy leaves
//! it to the manual QA checklist: it only wires up code tested elsewhere.
//!
//! On Android and iOS (Tauri's `mobile` cfg) there's no second instance,
//! tray, hide-on-close or updater, and the system keeps the reminders.

use crate::dispatch;
use crate::platform::os::TauriPlatform;
use crate::reminders::Scheduler;
use crate::state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::utils::config::AppDirectoriesOverride;
use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

/// What the login item passes (Settings → Reminders, Open at login): the
/// app starts in the tray, without its window.
#[cfg(desktop)]
const STARTED_AT_LOGIN: &str = "--hidden";

#[cfg(desktop)]
fn show_window(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        state.platform.show_main_window();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // A development build can keep its webview's storage (the cloud's cache,
    // the device's settings) in a folder of its own
    if let Some(dir) = std::env::var_os("BUDGETMINT_DATA_DIR").filter(|_| cfg!(debug_assertions)) {
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(PathBuf::from(dir)));
    }

    let builder = tauri::Builder::default();
    // Must be the FIRST plugin: a second launch forwards here and exits
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        show_window(app)
    }));
    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder
        // Updates from GitHub's latest release (plugins.updater in
        // tauri.conf.json); the webview asks before installing one
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Open at login, as a launch agent on macOS (the webview turns it on)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![STARTED_AT_LOGIN]),
        ))
        // Closing the window hides it to the tray, so reminders keep coming;
        // quit from the tray. Without a tray icon it closes normally.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let has_tray = window
                    .try_state::<Arc<TauriPlatform>>()
                    .is_some_and(|p| p.has_tray());
                if window.label() == "main" && has_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    builder
        .setup(|app| {
            let platform = Arc::new(TauriPlatform::new(app.handle().clone()));
            let state = Arc::new(AppState {
                platform: platform.clone(),
                reminders: Arc::new(Scheduler::default()),
            });
            app.manage(platform);
            app.manage(state.clone());

            // The main window ("create": false in tauri.conf.json), hidden
            // when the app was started at login: the tray brings it up
            let window = app.config().app.windows[0].clone();
            let builder = WebviewWindowBuilder::from_config(app.handle(), &window)?;
            #[cfg(desktop)]
            let builder = builder.visible(!std::env::args().any(|arg| arg == STARTED_AT_LOGIN));
            builder.build()?;

            // Clicking a notification brings the window forward (it may be
            // hidden to the tray)
            let notified = state.clone();
            app.notification().on_action(move |action| {
                if action.action_id() == "tap" {
                    notified.platform.show_main_window();
                }
            })?;

            #[cfg(desktop)]
            start_desktop(app, &state);
            Ok(())
        })
        // Every webview call goes through dispatch (see dispatch.rs)
        .invoke_handler(tauri::generate_handler![dispatch::dispatch])
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon brings back a window hidden by close
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = _event
            {
                show_window(_app);
            }
        });
}

/// The tray (Open and Quit until the webview sends its lines) and the thread
/// that shows reminders at their times.
#[cfg(desktop)]
fn start_desktop(app: &tauri::App, state: &Arc<AppState>) {
    use crate::{reminders, tray};
    let menu_state = state.clone();
    app.on_menu_event(move |_app, event| {
        tray::clicked(menu_state.platform.as_ref(), event.id().as_ref())
    });
    if let Err(e) = state.platform.render_tray(&tray::menu(&[])) {
        log::error!("Failed to create the tray icon: {}", e);
    }
    let state = state.clone();
    std::thread::spawn(move || loop {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        let wait = reminders::tick(&state.reminders, state.platform.as_ref(), now_ms);
        state.reminders.sleep(wait);
    });
}
