//! The tray (the menu bar on macOS): the lines the webview sends (today's
//! balance, the next bill, the lowest ahead), then Open, About, Settings
//! (while the budget is open: only it has Settings), Check for Updates, Sign
//! Out (while the budget is open) and Quit. The
//! words are the webview's; this only lays them out (platform/os.rs renders
//! it, and menu.rs handles the clicks).

use crate::menu::{MenuItem, SystemItem, ABOUT, CHECK_FOR_UPDATES, OPEN, SETTINGS, SIGN_OUT};
use crate::platform::Platform;
use crate::state::{AppState, TrayStatus};
use std::sync::PoisonError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMenu(pub Vec<MenuItem>);

/// The menu for `status`.
pub fn menu(status: &TrayStatus) -> TrayMenu {
    let mut items: Vec<MenuItem> = status.lines.iter().cloned().map(MenuItem::Label).collect();
    if !items.is_empty() {
        items.push(MenuItem::Separator);
    }
    items.extend([
        MenuItem::action(OPEN, "Open BudgetMint"),
        MenuItem::action(ABOUT, "About BudgetMint"),
    ]);
    if status.budget_open {
        items.push(MenuItem::action(SETTINGS, "Settings…"));
    }
    items.push(MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"));
    if status.budget_open {
        items.push(MenuItem::action(SIGN_OUT, "Sign Out…"));
    }
    items.extend([MenuItem::Separator, MenuItem::System(SystemItem::Quit)]);
    TrayMenu(items)
}

/// Changes what the tray shows, and shows it. The lock isn't held while it
/// renders (os.rs: Tauri runs that on the main thread and waits for it).
pub fn update(state: &AppState, change: impl FnOnce(&mut TrayStatus)) -> Result<(), String> {
    let status = {
        let mut status = state.tray.lock().unwrap_or_else(PoisonError::into_inner);
        change(&mut status);
        status.clone()
    };
    state.platform.render_tray(&menu(&status))
}

/// A click on the tray icon itself, not on its menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconClick {
    /// The left button, let go.
    Left,
    /// A double click (only Windows reports one).
    Double,
}

/// Whether a left click on the icon opens its menu. It does on macOS, where
/// the icon is a menu-bar item (Linux always opens it). On Windows a left
/// click opens the window instead, and the right click the menu.
pub fn menu_on_left_click(windows: bool) -> bool {
    !windows
}

/// What a click on the icon does: on Windows, a click or a double click
/// opens the window.
pub fn icon_clicked(platform: &dyn Platform, click: IconClick, windows: bool) {
    let opens = match click {
        IconClick::Left => !menu_on_left_click(windows),
        IconClick::Double => true,
    };
    if opens {
        platform.show_main_window();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;

    #[test]
    fn lays_out_the_lines_then_open_about_settings_updates_sign_out_and_quit() {
        let open = TrayStatus {
            lines: vec!["Today: $1.00".into()],
            budget_open: true,
        };
        assert_eq!(
            menu(&open).0,
            vec![
                MenuItem::Label("Today: $1.00".into()),
                MenuItem::Separator,
                MenuItem::action(OPEN, "Open BudgetMint"),
                MenuItem::action(ABOUT, "About BudgetMint"),
                MenuItem::action(SETTINGS, "Settings…"),
                MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"),
                MenuItem::action(SIGN_OUT, "Sign Out…"),
                MenuItem::Separator,
                MenuItem::System(SystemItem::Quit),
            ]
        );
        // No lines, no separator above Open; signed out, no Settings or Sign
        // Out (nothing would answer them)
        assert_eq!(
            menu(&TrayStatus::default()).0,
            vec![
                MenuItem::action(OPEN, "Open BudgetMint"),
                MenuItem::action(ABOUT, "About BudgetMint"),
                MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"),
                MenuItem::Separator,
                MenuItem::System(SystemItem::Quit),
            ]
        );
    }

    #[test]
    fn keeps_what_it_shows_between_changes() {
        let f = crate::testing::fixture();
        update(&f.state, |status| {
            status.lines = vec!["Today: $1.00".into()]
        })
        .unwrap();
        update(&f.state, |status| status.budget_open = true).unwrap();
        let menus = f.platform.recorded().menus;
        assert_eq!(menus[1].0[0], MenuItem::Label("Today: $1.00".into()));
        assert!(menus[1]
            .0
            .contains(&MenuItem::action(SIGN_OUT, "Sign Out…")));
        f.platform.fail("tray");
        assert!(update(&f.state, |status| status.lines.clear()).is_err());
        // Kept all the same, for the next try
        assert!(f.state.tray.lock().unwrap().lines.is_empty());
    }

    #[test]
    fn a_click_on_the_icon_opens_the_window_on_windows() {
        let platform = FakePlatform::default();
        icon_clicked(&platform, IconClick::Left, true);
        assert_eq!(platform.recorded().windows_shown, 1);
        icon_clicked(&platform, IconClick::Double, true);
        assert_eq!(platform.recorded().windows_shown, 2);
        assert!(!menu_on_left_click(true));
    }

    #[test]
    fn a_click_on_the_icon_opens_its_menu_on_macos() {
        let platform = FakePlatform::default();
        icon_clicked(&platform, IconClick::Left, false);
        assert_eq!(platform.recorded().windows_shown, 0);
        assert!(menu_on_left_click(false));
    }
}
