//! What every command reaches: the platform, and the reminders waiting.

use crate::platform::Platform;
use crate::reminders::Scheduler;
use std::sync::Arc;

pub struct AppState {
    pub platform: Arc<dyn Platform>,
    pub reminders: Arc<Scheduler>,
}
