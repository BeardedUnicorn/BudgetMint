//! A shell over the fake platform, for tests.

use crate::platform::fake::FakePlatform;
use crate::reminders::Scheduler;
use crate::state::AppState;
use std::sync::{Arc, Mutex};

pub struct Fixture {
    pub platform: Arc<FakePlatform>,
    pub state: AppState,
}

pub fn fixture() -> Fixture {
    with_platform(FakePlatform::default())
}

pub fn with_platform(platform: FakePlatform) -> Fixture {
    let platform = Arc::new(platform);
    Fixture {
        platform: platform.clone(),
        state: AppState {
            platform,
            reminders: Arc::new(Scheduler::default()),
            tray: Mutex::new(Default::default()),
        },
    }
}
