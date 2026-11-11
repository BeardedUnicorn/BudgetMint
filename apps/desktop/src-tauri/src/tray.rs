//! The tray (the menu bar on macOS): the lines the webview sends (today's
//! balance, the next bill, the lowest ahead), then Open, Settings, Check for
//! Updates and Quit. The words are the webview's; this only lays them out
//! (platform/os.rs renders it, and menu.rs handles the clicks).

use crate::menu::{MenuItem, SystemItem, CHECK_FOR_UPDATES, OPEN, SETTINGS};
use crate::platform::Platform;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMenu(pub Vec<MenuItem>);

/// The menu for `lines`.
pub fn menu(lines: &[String]) -> TrayMenu {
    let mut items: Vec<MenuItem> = lines.iter().cloned().map(MenuItem::Label).collect();
    if !items.is_empty() {
        items.push(MenuItem::Separator);
    }
    items.extend([
        MenuItem::action(OPEN, "Open BudgetMint"),
        MenuItem::action(SETTINGS, "Settings…"),
        MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"),
        MenuItem::Separator,
        MenuItem::System(SystemItem::Quit),
    ]);
    TrayMenu(items)
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
    fn lays_out_the_lines_then_open_settings_updates_and_quit() {
        assert_eq!(
            menu(&["Today: $1.00".into()]).0,
            vec![
                MenuItem::Label("Today: $1.00".into()),
                MenuItem::Separator,
                MenuItem::action(OPEN, "Open BudgetMint"),
                MenuItem::action(SETTINGS, "Settings…"),
                MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"),
                MenuItem::Separator,
                MenuItem::System(SystemItem::Quit),
            ]
        );
        // No lines, no separator above Open
        assert_eq!(menu(&[]).0[0], MenuItem::action(OPEN, "Open BudgetMint"));
        assert_eq!(menu(&[]).0.len(), 5);
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
