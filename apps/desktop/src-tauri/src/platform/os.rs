// Adapted from TaskMint apps/desktop/src-tauri/src/platform/os.rs @ 1623bee.
//! The Platform the app runs on: Tauri's window, opener, notifications,
//! menus, tray and updater. It needs a real UI session, so the coverage
//! policy leaves it to the manual QA checklist: keep it to calls, with any
//! decision made in the code that uses it (menu.rs, tray.rs, window.rs).
//!
//! The tray, the menus, the window's saved place, the updater and opening at
//! login exist only on a desktop. On Android and iOS `mobile::DesktopParts`
//! stands in for them and reports each one missing (the webview leaves out
//! what needs them: apps/desktop/src/tauriShell.ts).
//!
//! The save dialog picks a path on a desktop, and on Android a document (a
//! content:// address) that the fs plugin opens for the app.

use super::{AvailableUpdate, DownloadEvent, Platform, SaveFile, ScheduledNotification};
use crate::tray::TrayMenu;
use crate::window::MAIN;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use tauri_plugin_opener::OpenerExt;

#[cfg(desktop)]
use desktop::DesktopParts;
#[cfg(desktop)]
pub use desktop::{app_menu, window_state};
#[cfg(mobile)]
use mobile::DesktopParts;

/// The system sound a reminder plays (Android plays its default for a name
/// it has no sound for).
const SOUND: &str = if cfg!(target_os = "macos") {
    "Glass"
} else if cfg!(target_os = "linux") {
    "message-new-instant"
} else {
    "Default"
};

pub struct TauriPlatform {
    app: AppHandle,
    desktop: DesktopParts,
}

impl TauriPlatform {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            #[cfg(desktop)]
            desktop: DesktopParts::default(),
            #[cfg(mobile)]
            desktop: DesktopParts,
        }
    }
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// macOS: the Dock icon (and the app menu) shows while the window does; a
/// window hidden to the menu bar leaves only the menu-bar icon.
#[cfg(target_os = "macos")]
fn show_dock_icon(app: &AppHandle, shown: bool) {
    use tauri::ActivationPolicy::{Accessory, Regular};
    if let Err(e) = app.set_activation_policy(if shown { Regular } else { Accessory }) {
        log::warn!("Failed to change the Dock icon: {}", e);
    }
}

#[cfg(not(target_os = "macos"))]
fn show_dock_icon(_app: &AppHandle, _shown: bool) {}

/// A phone's alarm: the system shows the notification at its time, with the
/// app closed, and in Doze too.
#[cfg(mobile)]
fn schedule_os_notification(
    app: &AppHandle,
    scheduled: &ScheduledNotification,
) -> Result<(), String> {
    use tauri_plugin_notification::Schedule;
    let nanos = i128::from(scheduled.at_ms) * 1_000_000;
    let date = time::OffsetDateTime::from_unix_timestamp_nanos(nanos).map_err(text)?;
    app.notification()
        .builder()
        .id(scheduled.id)
        .title(&scheduled.title)
        .body(&scheduled.body)
        // Shown expanded too (see notify)
        .large_body(&scheduled.body)
        .sound(SOUND)
        .schedule(Schedule::At {
            date,
            repeating: false,
            allow_while_idle: true,
        })
        .show()
        .map_err(text)
}

#[cfg(mobile)]
fn cancel_os_notification(app: &AppHandle, id: i32) -> Result<(), String> {
    app.notification().cancel(vec![id]).map_err(text)
}

#[cfg(mobile)]
fn cancel_all_os_notifications(app: &AppHandle) -> Result<(), String> {
    app.notification().cancel_all().map_err(text)
}

/// A desktop's reminders are timed by the app while it runs, so the system
/// is never asked to set one.
#[cfg(desktop)]
fn schedule_os_notification(
    _app: &AppHandle,
    _scheduled: &ScheduledNotification,
) -> Result<(), String> {
    Err("Scheduled notifications are only set on a phone or tablet.".to_string())
}

/// Nothing is ever set on a desktop, so there's nothing to take back.
#[cfg(desktop)]
fn cancel_os_notification(_app: &AppHandle, _id: i32) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
fn cancel_all_os_notifications(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Writes `contents` where a desktop's save dialog said: always a path.
#[cfg(desktop)]
fn write_picked(_app: &AppHandle, picked: FilePath, contents: &str) -> Result<(), String> {
    let path = picked.into_path().map_err(text)?;
    std::fs::write(path, contents).map_err(text)
}

/// Writes `contents` where a phone's save dialog said: on Android a document
/// (a content:// address), which only the system can open, so the fs plugin
/// asks it for the document's file (as TaskMint's open_picked_file, 08fae9f).
#[cfg(mobile)]
fn write_picked(app: &AppHandle, picked: FilePath, contents: &str) -> Result<(), String> {
    use std::io::Write;
    use tauri_plugin_fs::{FsExt, OpenOptions};
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    let mut file = app.fs().open(picked, options).map_err(text)?;
    file.write_all(contents.as_bytes()).map_err(text)
}

/// The tray, the menus, the window's saved place, the updater and opening at
/// login.
#[cfg(desktop)]
mod desktop {
    use super::text;
    use crate::menu::{MenuItem, Submenu, SystemItem};
    use crate::platform::{AvailableUpdate, DownloadEvent};
    use crate::state::AppState;
    use crate::tray::{self, IconClick, TrayMenu};
    use std::future::Future;
    use std::sync::{Arc, Mutex};
    use tauri::image::Image;
    use tauri::menu::{
        IsMenuItem, Menu, MenuItem as Item, PredefinedMenuItem, Submenu as TauriSubmenu,
        WINDOW_SUBMENU_ID,
    };
    use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Manager, Wry};
    use tauri_plugin_autostart::ManagerExt;
    use tauri_plugin_updater::{Update, UpdaterExt};
    use tauri_plugin_window_state::{AppHandleExt, StateFlags};

    /// What the window-state plugin keeps of the window: its size and
    /// position. Not whether it was maximized (restoring that could show a
    /// window started hidden at login), nor whether it was showing
    /// (window.rs decides).
    pub fn window_state() -> StateFlags {
        StateFlags::SIZE | StateFlags::POSITION
    }

    #[derive(Default)]
    pub struct DesktopParts {
        tray: Mutex<Option<TrayIcon>>,
        /// The update the last check found, for install_update.
        update: Mutex<Option<Update>>,
    }

    /// Runs one of the updater's futures to its end. dispatch runs on the
    /// async runtime's blocking pool, where block_on would panic, so it gets
    /// a thread of its own.
    fn finish<T: Send>(future: impl Future<Output = T> + Send) -> T {
        std::thread::scope(|scope| {
            scope
                .spawn(|| tauri::async_runtime::block_on(future))
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
        })
    }

    /// The system's own item, in the system's words, except Hide and Quit:
    /// macOS would add the process's name, which a dev build's binary has
    /// in lower case (Hide budgetmint).
    fn system_item(app: &AppHandle, item: SystemItem) -> tauri::Result<PredefinedMenuItem<Wry>> {
        match item {
            SystemItem::Services => PredefinedMenuItem::services(app, None),
            SystemItem::Hide => PredefinedMenuItem::hide(app, Some("Hide BudgetMint")),
            SystemItem::HideOthers => PredefinedMenuItem::hide_others(app, None),
            SystemItem::ShowAll => PredefinedMenuItem::show_all(app, None),
            // Windows would say Exit
            SystemItem::Quit => PredefinedMenuItem::quit(app, Some("Quit BudgetMint")),
            SystemItem::Undo => PredefinedMenuItem::undo(app, None),
            SystemItem::Redo => PredefinedMenuItem::redo(app, None),
            SystemItem::Cut => PredefinedMenuItem::cut(app, None),
            SystemItem::Copy => PredefinedMenuItem::copy(app, None),
            SystemItem::Paste => PredefinedMenuItem::paste(app, None),
            SystemItem::SelectAll => PredefinedMenuItem::select_all(app, None),
            SystemItem::Minimize => PredefinedMenuItem::minimize(app, None),
            SystemItem::Maximize => PredefinedMenuItem::maximize(app, None),
            SystemItem::Fullscreen => PredefinedMenuItem::fullscreen(app, None),
            SystemItem::CloseWindow => PredefinedMenuItem::close_window(app, None),
            SystemItem::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, None),
        }
    }

    fn menu_item(app: &AppHandle, item: &MenuItem) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
        Ok(match item {
            MenuItem::Label(label) => Box::new(Item::new(app, label, false, None::<&str>)?),
            // with_id: Item::new's last argument is an accelerator, not an id
            // The budget's own are greyed out until it's open (set_items_enabled)
            MenuItem::Action {
                id,
                label,
                shortcut,
                needs_budget,
            } => Box::new(Item::with_id(app, *id, *label, !needs_budget, *shortcut)?),
            MenuItem::Separator => Box::new(PredefinedMenuItem::separator(app)?),
            // GTK doesn't support the system's Quit item (it shows greyed out):
            // Linux gets an ordinary one, which menu.rs quits on
            MenuItem::System(SystemItem::Quit) if cfg!(target_os = "linux") => {
                Box::new(Item::with_id(
                    app,
                    crate::menu::QUIT,
                    "Quit BudgetMint",
                    true,
                    None::<&str>,
                )?)
            }
            MenuItem::System(item) => Box::new(system_item(app, *item)?),
        })
    }

    fn menu_items(
        app: &AppHandle,
        items: &[MenuItem],
    ) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
        items.iter().map(|item| menu_item(app, item)).collect()
    }

    fn build_menu(app: &AppHandle, menu: &TrayMenu) -> tauri::Result<Menu<Wry>> {
        let built = Menu::new(app)?;
        for item in menu_items(app, &menu.0)? {
            built.append(item.as_ref())?;
        }
        Ok(built)
    }

    /// The menu bar's menus (menu.rs's app_menu); their clicks reach
    /// menu::clicked through app.rs.
    pub fn app_menu(app: &AppHandle, menus: &[Submenu]) -> tauri::Result<Menu<Wry>> {
        let built = Menu::new(app)?;
        for submenu in menus {
            let items = menu_items(app, &submenu.items)?;
            let items: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
            let built_submenu = if submenu.windows {
                TauriSubmenu::with_id_and_items(
                    app,
                    WINDOW_SUBMENU_ID,
                    submenu.title,
                    true,
                    &items,
                )?
            } else {
                TauriSubmenu::with_items(app, submenu.title, true, &items)?
            };
            // macOS adds its search field to the Help menu
            #[cfg(target_os = "macos")]
            if submenu.help {
                built_submenu.set_as_help_menu_for_nsapp()?;
            }
            built.append(&built_submenu)?;
        }
        Ok(built)
    }

    /// Greys out the menu bar's items with `ids`, or not. Only macOS has a
    /// menu bar (app.rs); elsewhere there's nothing to change.
    pub fn set_items_enabled(app: &AppHandle, ids: &[&str], enabled: bool) {
        let Some(menu) = app.menu() else { return };
        let submenus = match menu.items() {
            Ok(items) => items,
            Err(e) => return log::warn!("Failed to read the menu bar: {}", e),
        };
        for submenu in submenus.iter().filter_map(|item| item.as_submenu()) {
            for id in ids {
                let Some(found) = submenu.get(*id) else {
                    continue;
                };
                if let Some(Err(e)) = found.as_menuitem().map(|item| item.set_enabled(enabled)) {
                    log::warn!("Failed to change the menu's {}: {}", id, e);
                }
            }
        }
    }

    /// macOS's one-color menu-bar icon; the app's icon elsewhere.
    fn tray_icon() -> tauri::Result<(Image<'static>, bool)> {
        if cfg!(target_os = "macos") {
            return Ok((
                Image::from_bytes(include_bytes!("../../icons/tray-template.png"))?,
                true,
            ));
        }
        Ok((
            Image::from_bytes(include_bytes!("../../icons/32x32.png"))?,
            false,
        ))
    }

    impl DesktopParts {
        /// The tray icon's handle, taken out of the lock: Tauri runs tray
        /// calls on the main thread and waits for them, so holding the lock
        /// through one would deadlock against a menu click handled there.
        fn tray(&self) -> Option<TrayIcon> {
            self.tray.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }

        pub fn has_tray(&self) -> bool {
            self.tray().is_some()
        }

        /// Saves the window's size and position now. The plugin saves them
        /// when the app quits, but not when an update restarts it or a
        /// logout ends it, so they're saved each time it hides too.
        pub fn save_window_state(&self, app: &AppHandle) {
            if let Err(e) = app.save_window_state(window_state()) {
                log::warn!("Failed to save the window's size and position: {}", e);
            }
        }

        pub fn render_tray(&self, app: &AppHandle, menu: &TrayMenu) -> Result<(), String> {
            let built = build_menu(app, menu).map_err(text)?;
            if let Some(tray) = self.tray() {
                return tray.set_menu(Some(built)).map_err(text);
            }
            let handle = app.clone();
            let windows = cfg!(target_os = "windows");
            let (icon, template) = tray_icon().map_err(text)?;
            let icon = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(template)
                .menu(&built)
                .show_menu_on_left_click(tray::menu_on_left_click(windows))
                .tooltip("BudgetMint")
                .on_tray_icon_event(move |_tray, event| {
                    let click = match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => IconClick::Left,
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => IconClick::Double,
                        _ => return,
                    };
                    if let Some(state) = handle.try_state::<Arc<AppState>>() {
                        tray::icon_clicked(state.platform.as_ref(), click, windows);
                    }
                })
                .build(app)
                .map_err(text)?;
            *self.tray.lock().unwrap_or_else(|e| e.into_inner()) = Some(icon);
            Ok(())
        }

        pub fn autostart(&self, app: &AppHandle) -> Result<bool, String> {
            app.autolaunch().is_enabled().map_err(text)
        }

        pub fn set_autostart(&self, app: &AppHandle, enabled: bool) -> Result<(), String> {
            let launcher = app.autolaunch();
            match enabled {
                true => launcher.enable(),
                false => launcher.disable(),
            }
            .map_err(text)
        }

        pub fn check_update(&self, app: &AppHandle) -> Result<Option<AvailableUpdate>, String> {
            let updater = app.updater().map_err(text)?;
            let found = finish(updater.check()).map_err(text)?;
            let available = found.as_ref().map(|update| AvailableUpdate {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
                notes: update.body.clone(),
                date: update.raw_json["pub_date"].as_str().map(str::to_string),
            });
            *self.update.lock().unwrap_or_else(|e| e.into_inner()) = found;
            Ok(available)
        }

        pub fn install_update(
            &self,
            progress: &mut (dyn FnMut(DownloadEvent) + Send),
        ) -> Result<(), String> {
            // A development build's executable isn't an installed app, so the
            // updater would replace the wrong thing
            if cfg!(debug_assertions) {
                return Err(
                    "A development build can't install updates. Build the app to try one."
                        .to_string(),
                );
            }
            let update = self
                .update
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let update = update.ok_or("Check for updates first.")?;
            // Both callbacks report to `progress`, one at a time
            let progress = Mutex::new(progress);
            let report = |event| (progress.lock().unwrap_or_else(|e| e.into_inner()))(event);
            finish(update.download_and_install(
                |bytes, total| {
                    report(DownloadEvent::Chunk {
                        bytes: bytes as u64,
                        total,
                    })
                },
                || report(DownloadEvent::Downloaded),
            ))
            .map_err(text)
        }
    }
}

/// A phone's or tablet's stand-in for the desktop parts: none of them is
/// there.
#[cfg(mobile)]
mod mobile {
    use crate::platform::{AvailableUpdate, DownloadEvent};
    use crate::tray::TrayMenu;
    use tauri::AppHandle;

    pub struct DesktopParts;

    fn missing(what: &str) -> String {
        format!("{} isn't available on a phone or tablet.", what)
    }

    impl DesktopParts {
        pub fn has_tray(&self) -> bool {
            false
        }

        pub fn render_tray(&self, _app: &AppHandle, _menu: &TrayMenu) -> Result<(), String> {
            Err(missing("The system tray"))
        }

        /// A phone keeps no window place.
        pub fn save_window_state(&self, _app: &AppHandle) {}

        pub fn autostart(&self, _app: &AppHandle) -> Result<bool, String> {
            Err(missing("Opening at login"))
        }

        pub fn set_autostart(&self, _app: &AppHandle, _enabled: bool) -> Result<(), String> {
            Err(missing("Opening at login"))
        }

        pub fn check_update(&self, _app: &AppHandle) -> Result<Option<AvailableUpdate>, String> {
            Err(missing("Updating from BudgetMint's releases"))
        }

        pub fn install_update(
            &self,
            _progress: &mut (dyn FnMut(DownloadEvent) + Send),
        ) -> Result<(), String> {
            Err(missing("Updating from BudgetMint's releases"))
        }
    }
}

impl Platform for TauriPlatform {
    fn is_mobile(&self) -> bool {
        cfg!(mobile)
    }

    fn emit(&self, event: &str, payload: &Value) -> Result<(), String> {
        self.app.emit(event, payload).map_err(text)
    }

    fn request_notifications(&self) -> Result<bool, String> {
        let notification = self.app.notification();
        let state = match notification.permission_state().map_err(text)? {
            known @ (PermissionState::Granted | PermissionState::Denied) => known,
            _ => notification.request_permission().map_err(text)?,
        };
        Ok(state == PermissionState::Granted)
    }

    fn notify(&self, title: &str, body: &str) -> Result<(), String> {
        // The large body is Android's: without it the plugin's empty inbox
        // style hides the text whenever the notification is expanded
        // (desktops ignore it)
        self.app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .large_body(body)
            .sound(SOUND)
            .show()
            .map_err(text)
    }

    fn schedule_notification(&self, scheduled: &ScheduledNotification) -> Result<(), String> {
        schedule_os_notification(&self.app, scheduled)
    }

    fn cancel_notification(&self, id: i32) -> Result<(), String> {
        cancel_os_notification(&self.app, id)
    }

    fn cancel_all_notifications(&self) -> Result<(), String> {
        cancel_all_os_notifications(&self.app)
    }

    fn open_url(&self, url: &str) -> Result<(), String> {
        self.app
            .opener()
            .open_url(url, None::<String>)
            .map_err(text)
    }

    fn open_logs_folder(&self) -> Result<(), String> {
        // Where the log plugin writes (app.rs): ~/Library/Logs/<identifier>
        // on macOS, %LOCALAPPDATA%\<identifier>\logs on Windows
        let folder = self.app.path().app_log_dir().map_err(text)?;
        std::fs::create_dir_all(&folder).map_err(text)?;
        self.app
            .opener()
            .open_path(folder.to_string_lossy(), None::<String>)
            .map_err(text)
    }

    fn show_main_window(&self) {
        let Some(window) = self.app.get_webview_window(MAIN) else {
            log::error!("Main window not found");
            return;
        };
        show_dock_icon(&self.app, true);
        // A phone's window is never minimized: Tauri has no unminimize there
        #[cfg(desktop)]
        let shown = window.unminimize().and_then(|()| window.show());
        #[cfg(mobile)]
        let shown = window.show();
        let shown = shown.and_then(|()| window.set_focus());
        if let Err(e) = shown {
            log::error!("Failed to bring the window forward: {}", e);
        }
    }

    fn hide_main_window(&self) {
        let Some(window) = self.app.get_webview_window(MAIN) else {
            log::error!("Main window not found");
            return;
        };
        self.desktop.save_window_state(&self.app);
        if let Err(e) = window.hide() {
            log::error!("Failed to hide the window: {}", e);
        }
        show_dock_icon(&self.app, false);
    }

    fn render_tray(&self, menu: &TrayMenu) -> Result<(), String> {
        self.desktop.render_tray(&self.app, menu)
    }

    fn has_tray(&self) -> bool {
        self.desktop.has_tray()
    }

    fn set_menu_enabled(&self, ids: &[&str], enabled: bool) {
        #[cfg(desktop)]
        desktop::set_items_enabled(&self.app, ids, enabled);
        // A phone has no menu bar
        #[cfg(mobile)]
        let _ = (ids, enabled);
    }

    fn quit(&self) {
        self.app.exit(0)
    }

    fn autostart(&self) -> Result<bool, String> {
        self.desktop.autostart(&self.app)
    }

    /// The system's save dialog (over the window, as a sheet on macOS; on
    /// Android its document picker), then the file written where it says. It
    /// blocks: dispatch runs commands off the main thread.
    fn save_file(&self, file: &SaveFile) -> Result<bool, String> {
        let mut dialog = self.app.dialog().file().set_file_name(&file.name);
        if !file.extension.is_empty() {
            dialog = dialog.add_filter(&file.kind, &[file.extension.as_str()]);
        }
        #[cfg(desktop)]
        if let Some(window) = self.app.get_webview_window(MAIN) {
            dialog = dialog.set_parent(&window);
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok(false);
        };
        let shown = picked.to_string();
        write_picked(&self.app, picked, &file.contents)?;
        log::info!("Saved {}", shown);
        Ok(true)
    }

    fn set_autostart(&self, enabled: bool) -> Result<(), String> {
        self.desktop.set_autostart(&self.app, enabled)
    }

    fn restart(&self) {
        self.desktop.save_window_state(&self.app);
        self.app.restart()
    }

    fn check_update(&self) -> Result<Option<AvailableUpdate>, String> {
        self.desktop.check_update(&self.app)
    }

    fn install_update(
        &self,
        progress: &mut (dyn FnMut(DownloadEvent) + Send),
    ) -> Result<(), String> {
        self.desktop.install_update(progress)
    }
}
