//! The events the shell sends the webview.

use crate::platform::Platform;
use serde::Serialize;

/// An update's download, as it goes (updates.rs).
pub const UPDATE_PROGRESS: &str = "update-progress";

/// A click on one of the menus' items the webview does (menu.rs): the
/// item's id, as the payload.
pub const MENU_COMMAND: &str = "menu-command";

/// The menus' Check for Updates… (menu.rs): the webview checks, and says
/// what it found in a dialog.
pub const CHECK_FOR_UPDATES: &str = "check-for-updates";

/// Sends `payload` as `event`; one that can't be sent is logged, not an error
/// (the webview may be gone).
pub fn emit_quiet<T: Serialize>(platform: &dyn Platform, event: &str, payload: T) {
    let payload = serde_json::to_value(payload).expect("events are plain data");
    if let Err(error) = platform.emit(event, &payload) {
        log::warn!("Failed to send {}: {}", event, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;

    #[test]
    fn sends_events_and_logs_when_it_cant() {
        let f = fixture();
        emit_quiet(f.platform.as_ref(), UPDATE_PROGRESS, 1);
        f.platform.fail("emit");
        emit_quiet(f.platform.as_ref(), UPDATE_PROGRESS, 2);
        assert_eq!(
            f.platform.recorded().events,
            vec![(UPDATE_PROGRESS.to_string(), serde_json::json!(1))]
        );
    }
}
