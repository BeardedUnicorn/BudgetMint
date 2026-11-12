//! The main window's comings and goings: at launch, and when it's closed.
//! Hidden, it waits in the tray (macOS's menu bar, without a Dock icon), so
//! reminders keep coming. Without a tray icon to bring it back from, it's
//! never hidden.

use crate::platform::Platform;

/// The main window's label (tauri.conf.json's only window).
pub const MAIN: &str = "main";

/// At launch, once the tray is up: the window shows, unless the app was
/// started at login (Settings → Reminders), when it waits in the tray.
pub fn at_launch(platform: &dyn Platform, started_at_login: bool) {
    if started_at_login && platform.has_tray() {
        platform.hide_main_window();
    } else {
        platform.show_main_window();
    }
}

/// The app's link scheme (tauri.conf.json's plugins.deep-link): opening a
/// `budgetmint://` link brings the app forward.
pub const SCHEME: &str = "budgetmint";

/// The system opened `urls` with the app: a `budgetmint://` link shows the
/// window. Google sign-in's page opens one, so the app comes back in front
/// of the browser: the browser is the app in front, so the system lets it
/// hand the focus over, which BudgetMint can't take for itself (macOS).
pub fn link_opened(platform: &dyn Platform, urls: &[url::Url]) {
    if urls.iter().any(|url| url.scheme() == SCHEME) {
        platform.show_main_window();
    }
}

/// Whether the window `label` closes when asked to (its close button,
/// Close Window). The main window hides to the tray instead while there's
/// one; quit from the tray or the app menu.
pub fn closes(platform: &dyn Platform, label: &str) -> bool {
    if label == MAIN && platform.has_tray() {
        platform.hide_main_window();
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use crate::tray;

    fn with_tray() -> FakePlatform {
        let platform = FakePlatform::default();
        platform
            .render_tray(&tray::menu(&Default::default()))
            .unwrap();
        platform
    }

    #[test]
    fn shows_at_launch_unless_started_at_login() {
        let platform = with_tray();
        at_launch(&platform, false);
        assert_eq!(platform.recorded().windows_shown, 1);
        at_launch(&platform, true);
        assert_eq!(platform.recorded().windows_hidden, 1);
        assert_eq!(platform.recorded().windows_shown, 1);
    }

    #[test]
    fn shows_at_login_too_without_a_tray_to_come_back_from() {
        let platform = FakePlatform::default();
        platform.fail("tray");
        assert!(platform
            .render_tray(&tray::menu(&Default::default()))
            .is_err());
        at_launch(&platform, true);
        assert_eq!(platform.recorded().windows_shown, 1);
        assert_eq!(platform.recorded().windows_hidden, 0);
    }

    #[test]
    fn closing_hides_the_main_window_to_the_tray() {
        let platform = with_tray();
        assert!(!closes(&platform, MAIN));
        assert_eq!(platform.recorded().windows_hidden, 1);
        // Another window closes as usual
        assert!(closes(&platform, "other"));
        assert_eq!(platform.recorded().windows_hidden, 1);
    }

    #[test]
    fn a_budgetmint_link_brings_the_window_forward() {
        let urls = |list: &[&str]| -> Vec<url::Url> {
            list.iter()
                .map(|url| url::Url::parse(url).unwrap())
                .collect()
        };
        let platform = with_tray();
        link_opened(&platform, &urls(&["budgetmint://signed-in"]));
        assert_eq!(platform.recorded().windows_shown, 1);
        // Once, however many links came
        link_opened(&platform, &urls(&["budgetmint://a", "budgetmint://b"]));
        assert_eq!(platform.recorded().windows_shown, 2);
        // Another scheme's links, or none, leave the window as it is
        link_opened(&platform, &urls(&["https://example.com", "taskmint://x"]));
        link_opened(&platform, &[]);
        assert_eq!(platform.recorded().windows_shown, 2);
    }

    #[test]
    fn closing_closes_without_a_tray() {
        let platform = FakePlatform::default();
        assert!(closes(&platform, MAIN));
        assert_eq!(platform.recorded().windows_hidden, 0);
    }
}
