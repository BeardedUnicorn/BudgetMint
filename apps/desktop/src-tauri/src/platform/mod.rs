//! What the shell needs from the OS and from Tauri, as one seam (TaskMint's
//! Platform, without the files and dialogs BudgetMint doesn't use). `os.rs`
//! is the real thing (it needs a real UI session, so the coverage policy
//! leaves it to the manual QA checklist); tests use `fake::FakePlatform`.

use crate::tray::TrayMenu;
use serde::Serialize;
use serde_json::Value;

pub mod os;

#[cfg(test)]
pub mod fake;

/// A notification for the system to show at its time, with the app closed
/// (a phone's alarm).
#[derive(Debug, Clone, PartialEq)]
pub struct ScheduledNotification {
    /// Setting another with the same id replaces it.
    pub id: i32,
    pub at_ms: i64,
    pub title: String,
    pub body: String,
}

/// A newer release the update feed announced (GitHub's latest release).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    /// The version running now.
    pub current_version: String,
    /// The release's notes: its CHANGELOG section, as Markdown.
    pub notes: Option<String>,
    /// When it was published (RFC 3339).
    pub date: Option<String>,
}

/// How an update's download is going (Platform::install_update).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DownloadEvent {
    /// `bytes` more arrived, of `total` (when the server says).
    Chunk { bytes: u64, total: Option<u64> },
    /// The download is complete and verified; installing comes next.
    Downloaded,
}

pub trait Platform: Send + Sync {
    /// A phone or tablet (no tray, no updater; the system keeps the reminders).
    fn is_mobile(&self) -> bool;
    /// Sends an event to the webview.
    fn emit(&self, event: &str, payload: &Value) -> Result<(), String>;
    /// Whether notifications may be shown, asking for permission if it hasn't been yet.
    fn request_notifications(&self) -> Result<bool, String>;
    /// Shows an OS notification now.
    fn notify(&self, title: &str, body: &str) -> Result<(), String>;
    /// Sets a notification for the system to show at its time. Only a phone or tablet can.
    fn schedule_notification(&self, scheduled: &ScheduledNotification) -> Result<(), String>;
    /// Takes back the notification set with `id`, if it's still to come.
    fn cancel_notification(&self, id: i32) -> Result<(), String>;
    /// Takes back every notification set and still to come (an earlier run's).
    fn cancel_all_notifications(&self) -> Result<(), String>;
    /// Opens a web page in the system browser (Google sign-in).
    fn open_url(&self, url: &str) -> Result<(), String>;
    /// Shows and focuses the main window.
    fn show_main_window(&self);
    /// Shows `menu` in the tray, creating the tray icon the first time.
    fn render_tray(&self, menu: &TrayMenu) -> Result<(), String>;
    /// Whether the app opens when the user logs in. Only a desktop can.
    fn autostart(&self) -> Result<bool, String>;
    /// Opens the app when the user logs in (hidden in the tray), or stops.
    fn set_autostart(&self, enabled: bool) -> Result<(), String>;
    /// Starts the app again (into an update).
    fn restart(&self);
    /// Asks the update feed whether there's a newer version, and keeps what
    /// it found for install_update. None: this is the newest.
    fn check_update(&self) -> Result<Option<AvailableUpdate>, String>;
    /// Downloads the update check_update found, verifies its signature and
    /// installs it, telling `progress` how the download goes.
    fn install_update(
        &self,
        progress: &mut (dyn FnMut(DownloadEvent) + Send),
    ) -> Result<(), String>;
}
