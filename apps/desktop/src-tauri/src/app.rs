// Adapted from TaskMint apps/desktop/src-tauri/src/app.rs @ 1623bee.
//! The Tauri app: plugins, the window, the menus, the tray and the
//! reminders' thread. It needs a real event loop and main thread, so the
//! coverage policy leaves it to the manual QA checklist: it only wires up
//! code tested elsewhere (window.rs decides the window's comings and goings,
//! menu.rs the menus and their clicks).
//!
//! On Android and iOS (Tauri's `mobile` cfg) there's no second instance,
//! tray, menu bar, hide-on-close, saved window place, budgetmint:// link or
//! updater, and the system keeps the reminders.
//!
//! A dev build (environment.rs) is "BudgetMint Dev", an app of its own beside
//! the installed one; it refuses to start as the installed app, and a
//! production build refuses to start as anything else.

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
    // budgetmint:// links (budgetmint-dev:// in a dev build; plugins.deep-link
    // in tauri.conf.json and tauri.production.conf.json): Google sign-in's
    // page opens one to bring the app back (start_desktop)
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    let builder = builder
        // The shell's log, with the webview's errors and warnings (logs.rs),
        // in the app's log folder (Settings → Troubleshooting opens it)
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
        .plugin(tauri_plugin_notification::init())
        // The save dialog, for the files the webview makes (platform/os.rs)
        .plugin(tauri_plugin_dialog::init());
    // Opens the documents Android's save dialog picks
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_fs::init());
    #[cfg(desktop)]
    let builder = builder
        // Updates from GitHub's latest release (plugins.updater: the feed is
        // in tauri.production.conf.json, so a dev build has none); the
        // webview asks before installing one
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Open at login, as a launch agent on macOS (the webview turns it on)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![STARTED_AT_LOGIN]),
        ))
        // The window's size and position from last time; the first time,
        // it's centered (tauri.conf.json)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(crate::platform::os::window_state())
                .build(),
        )
        // Closing the window hides it to the tray, so reminders keep coming
        // (window.rs); quit from the tray or the app menu
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let closes = match window.try_state::<Arc<AppState>>() {
                    Some(state) => crate::window::closes(state.platform.as_ref(), window.label()),
                    None => true,
                };
                if !closes {
                    api.prevent_close();
                }
            }
        });
    // The menu bar (menu.rs), in place of Tauri's default
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| crate::platform::os::app_menu(app, &crate::menu::app_menu()));

    builder
        .setup(|app| {
            let platform = Arc::new(TauriPlatform::new(app.handle().clone()));
            let state = Arc::new(AppState {
                platform,
                reminders: Arc::new(Scheduler::default()),
                tray: Default::default(),
            });
            app.manage(state.clone());

            // A production build runs only as the installed app, and a dev
            // build never as it (environment.rs)
            #[cfg(desktop)]
            crate::environment::Environment::current()
                .check_identifier(&app.config().identifier)?;

            // The main window ("create": false in tauri.conf.json), titled
            // as the build is named ("BudgetMint Dev" for a dev build). On a
            // desktop it's built hidden: the window-state plugin puts it
            // back where it was, and window.rs shows it once the tray is up
            let window = app.config().app.windows[0].clone();
            let builder = WebviewWindowBuilder::from_config(app.handle(), &window)?
                .title(&app.package_info().name);
            #[cfg(desktop)]
            let builder = builder.visible(false);
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

/// The menus' clicks, the tray (Open, Settings, Check for Updates and Quit
/// until the webview sends its lines), the window (window.rs) and the
/// thread that shows reminders at their times.
#[cfg(desktop)]
fn start_desktop(app: &tauri::App, state: &Arc<AppState>) {
    use crate::{menu, reminders, tray, window};
    use tauri_plugin_deep_link::DeepLinkExt;
    // The app menu's and the tray menu's clicks both come here
    let menu_state = state.clone();
    app.on_menu_event(move |_app, event| {
        menu::clicked(menu_state.platform.as_ref(), event.id().as_ref())
    });
    if let Err(e) = state.platform.render_tray(&tray::menu(&Default::default())) {
        log::error!("Failed to create the tray icon: {}", e);
    }
    let started_at_login = std::env::args().any(|arg| arg == STARTED_AT_LOGIN);
    window::at_launch(state.platform.as_ref(), started_at_login);

    // budgetmint:// links (budgetmint-dev:// in a dev build) bring the
    // window forward (window.rs). The macOS app's Info.plist and the Windows
    // installer register the scheme; this registers it for Linux and Windows
    // development builds. (A macOS
    // development build gets no links: only a built .app can.) A link that
    // starts the app needs nothing more: the window shows at launch.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    if let Err(e) = app.deep_link().register_all() {
        log::error!("Failed to register the app's links: {}", e);
    }
    // Links opened while running (macOS's Apple events; on Windows and
    // Linux, a second launch's, forwarded by the single-instance plugin)
    let link_state = state.clone();
    app.deep_link()
        .on_open_url(move |event| window::link_opened(link_state.platform.as_ref(), &event.urls()));

    let state = state.clone();
    std::thread::spawn(move || loop {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        let wait = reminders::tick(&state.reminders, state.platform.as_ref(), now_ms);
        state.reminders.sleep(wait);
    });
}
