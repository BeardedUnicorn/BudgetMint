// Adapted from TaskMint apps/desktop/src-tauri/src/platform/os.rs @ 1623bee.
//! The Platform the app runs on: Tauri's window, opener, notifications, tray
//! and updater. It needs a real UI session, so the coverage policy leaves it
//! to the manual QA checklist: keep it to calls, with any decision made in
//! the code that uses it.
//!
//! The tray, the updater and opening at login exist only on a desktop. On Android and iOS
//! `mobile::DesktopParts` stands in for them and reports each one missing
//! (the webview leaves out what needs them: apps/desktop/src/tauriShell.ts).

use super::{AvailableUpdate, DownloadEvent, Platform, ScheduledNotification};
use crate::tray::TrayMenu;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use tauri_plugin_opener::OpenerExt;

#[cfg(desktop)]
use desktop::DesktopParts;
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

    /// Whether there's a tray icon to bring the window back from (closing
    /// the window hides it only then).
    pub fn has_tray(&self) -> bool {
        self.desktop.has_tray()
    }
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

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

/// The tray, the updater and opening at login.
#[cfg(desktop)]
mod desktop {
    use super::text;
    use crate::platform::{AvailableUpdate, DownloadEvent};
    use crate::tray::{TrayItem, TrayMenu};
    use std::future::Future;
    use std::sync::Mutex;
    use tauri::image::Image;
    use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Manager, Wry};
    use tauri_plugin_autostart::ManagerExt;
    use tauri_plugin_updater::{Update, UpdaterExt};

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

    fn menu_item(app: &AppHandle, item: &TrayItem) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
        Ok(match item {
            TrayItem::Label(label) => Box::new(MenuItem::new(app, label, false, None::<&str>)?),
            // with_id: MenuItem::new's last argument is an accelerator, not an id
            TrayItem::Action { id, label } => {
                Box::new(MenuItem::with_id(app, *id, *label, true, None::<&str>)?)
            }
            TrayItem::Separator => Box::new(PredefinedMenuItem::separator(app)?),
            // GTK doesn't support the system's Quit item (it shows greyed out):
            // Linux gets an ordinary one, which app.rs's menu handler quits on
            TrayItem::Quit if cfg!(target_os = "linux") => Box::new(MenuItem::with_id(
                app,
                crate::tray::QUIT,
                "Quit BudgetMint",
                true,
                None::<&str>,
            )?),
            TrayItem::Quit => Box::new(PredefinedMenuItem::quit(app, Some("Quit BudgetMint"))?),
        })
    }

    fn build_menu(app: &AppHandle, menu: &TrayMenu) -> tauri::Result<Menu<Wry>> {
        let built = Menu::new(app)?;
        for item in &menu.0 {
            built.append(menu_item(app, item)?.as_ref())?;
        }
        Ok(built)
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

        pub fn render_tray(&self, app: &AppHandle, menu: &TrayMenu) -> Result<(), String> {
            let built = build_menu(app, menu).map_err(text)?;
            if let Some(tray) = self.tray() {
                return tray.set_menu(Some(built)).map_err(text);
            }
            let handle = app.clone();
            let (icon, template) = tray_icon().map_err(text)?;
            let icon = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(template)
                .menu(&built)
                .tooltip("BudgetMint")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show().and_then(|()| window.set_focus());
                        }
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

    fn show_main_window(&self) {
        let Some(window) = self.app.get_webview_window("main") else {
            log::error!("Main window not found");
            return;
        };
        if let Err(e) = window.show().and_then(|()| window.set_focus()) {
            log::error!("Failed to bring the window forward: {}", e);
        }
    }

    fn render_tray(&self, menu: &TrayMenu) -> Result<(), String> {
        self.desktop.render_tray(&self.app, menu)
    }

    fn autostart(&self) -> Result<bool, String> {
        self.desktop.autostart(&self.app)
    }

    fn set_autostart(&self, enabled: bool) -> Result<(), String> {
        self.desktop.set_autostart(&self.app, enabled)
    }

    fn restart(&self) {
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
