//! What every command reaches: the platform, the reminders waiting, and
//! what the tray last showed.

use crate::platform::Platform;
use crate::reminders::Scheduler;
use std::sync::{Arc, Mutex};

/// What the tray's menu is made of (tray.rs): the webview's lines, and
/// whether the budget is open (Sign Out… is there).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TrayStatus {
    pub lines: Vec<String>,
    pub budget_open: bool,
}

pub struct AppState {
    pub platform: Arc<dyn Platform>,
    pub reminders: Arc<Scheduler>,
    pub tray: Mutex<TrayStatus>,
}
