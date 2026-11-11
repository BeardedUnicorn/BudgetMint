//! A Platform for tests: it records what the shell asked of it, and fails
//! the calls a test names.

use super::{AvailableUpdate, DownloadEvent, Platform, ScheduledNotification};
use crate::tray::TrayMenu;
use serde_json::Value;
use std::sync::Mutex;

#[derive(Debug, Default, Clone)]
pub struct Recorded {
    pub events: Vec<(String, Value)>,
    pub notifications: Vec<(String, String)>,
    /// Set for later, in order; a cancel doesn't remove one.
    pub scheduled: Vec<ScheduledNotification>,
    pub cancelled: Vec<i32>,
    pub opened_urls: Vec<String>,
    pub windows_shown: usize,
    pub menus: Vec<TrayMenu>,
    pub restarts: usize,
    pub update_checks: usize,
    pub updates_installed: usize,
}

#[derive(Default)]
pub struct FakePlatform {
    pub mobile: bool,
    recorded: Mutex<Recorded>,
    /// Notifications aren't allowed.
    pub denied: Mutex<bool>,
    /// What the update feed announces.
    update: Mutex<Option<AvailableUpdate>>,
    /// How an update's download goes, in order.
    download: Mutex<Vec<DownloadEvent>>,
    /// Calls that fail from now on, by name.
    failing: Mutex<Vec<&'static str>>,
}

impl FakePlatform {
    pub fn mobile() -> Self {
        Self {
            mobile: true,
            ..Self::default()
        }
    }

    pub fn fail(&self, call: &'static str) {
        self.failing.lock().unwrap().push(call);
    }

    pub fn recorded(&self) -> Recorded {
        self.recorded.lock().unwrap().clone()
    }

    pub fn announce(&self, update: AvailableUpdate) {
        *self.update.lock().unwrap() = Some(update);
    }

    pub fn download_goes(&self, events: Vec<DownloadEvent>) {
        *self.download.lock().unwrap() = events;
    }

    fn check(&self, call: &'static str) -> Result<(), String> {
        if self.failing.lock().unwrap().contains(&call) {
            Err(format!("{} failed", call))
        } else {
            Ok(())
        }
    }

    fn record(&self, change: impl FnOnce(&mut Recorded)) {
        change(&mut self.recorded.lock().unwrap());
    }
}

impl Platform for FakePlatform {
    fn is_mobile(&self) -> bool {
        self.mobile
    }

    fn emit(&self, event: &str, payload: &Value) -> Result<(), String> {
        self.check("emit")?;
        self.record(|r| r.events.push((event.to_string(), payload.clone())));
        Ok(())
    }

    fn request_notifications(&self) -> Result<bool, String> {
        self.check("request_notifications")?;
        Ok(!*self.denied.lock().unwrap())
    }

    fn notify(&self, title: &str, body: &str) -> Result<(), String> {
        self.check("notify")?;
        self.record(|r| r.notifications.push((title.to_string(), body.to_string())));
        Ok(())
    }

    fn schedule_notification(&self, scheduled: &ScheduledNotification) -> Result<(), String> {
        self.check("schedule")?;
        self.record(|r| r.scheduled.push(scheduled.clone()));
        Ok(())
    }

    fn cancel_notification(&self, id: i32) -> Result<(), String> {
        self.check("cancel")?;
        self.record(|r| r.cancelled.push(id));
        Ok(())
    }

    fn open_url(&self, url: &str) -> Result<(), String> {
        self.check("open_url")?;
        self.record(|r| r.opened_urls.push(url.to_string()));
        Ok(())
    }

    fn show_main_window(&self) {
        self.record(|r| r.windows_shown += 1);
    }

    fn render_tray(&self, menu: &TrayMenu) -> Result<(), String> {
        self.check("tray")?;
        self.record(|r| r.menus.push(menu.clone()));
        Ok(())
    }

    fn restart(&self) {
        self.record(|r| r.restarts += 1);
    }

    fn check_update(&self) -> Result<Option<AvailableUpdate>, String> {
        self.check("check_update")?;
        self.record(|r| r.update_checks += 1);
        Ok(self.update.lock().unwrap().clone())
    }

    fn install_update(
        &self,
        progress: &mut (dyn FnMut(DownloadEvent) + Send),
    ) -> Result<(), String> {
        for event in self.download.lock().unwrap().iter() {
            progress(*event);
        }
        self.check("install_update")?;
        self.record(|r| r.updates_installed += 1);
        Ok(())
    }
}
