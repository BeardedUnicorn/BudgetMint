//! The menus: their items, as data, and what a click on one does. The tray's
//! menu (tray.rs) and, on macOS, the app menu in the menu bar share the ids
//! below, and their clicks all come to `clicked`. platform/os.rs turns the
//! items into Tauri's.

use crate::events::{self, emit_quiet};
use crate::platform::Platform;

/// Open BudgetMint: shows the window.
pub const OPEN: &str = "open";
/// Settings…: the window, on Settings.
pub const SETTINGS: &str = "settings";
/// Check for Updates…: the window, with the check's outcome in a dialog.
pub const CHECK_FOR_UPDATES: &str = "check-for-updates";
/// The Quit item's id where it's an ordinary item (Linux: GTK greys out the
/// system's own Quit item, and closing the window only hides it in the tray).
pub const QUIT: &str = "quit";

/// One of the system's own items: each acts by itself (Copy copies the
/// selection in the focused text field) and comes with the system's words
/// and shortcut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemItem {
    /// About BudgetMint, with the version and copyright.
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    /// Zoom on macOS: the window fills the screen, and back.
    Maximize,
    Fullscreen,
    /// Closing hides the window to the tray (app.rs), as its close button does.
    CloseWindow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuItem {
    /// A line of text (not clickable).
    Label(String),
    /// A clickable item: the id its click comes back with, and its shortcut
    /// (Tauri's accelerator, "CmdOrCtrl+,").
    Action {
        id: &'static str,
        label: &'static str,
        shortcut: Option<&'static str>,
    },
    Separator,
    System(SystemItem),
}

impl MenuItem {
    /// An item with no shortcut.
    pub const fn action(id: &'static str, label: &'static str) -> Self {
        MenuItem::Action {
            id,
            label,
            shortcut: None,
        }
    }
}

/// One of the menu bar's menus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submenu {
    pub title: &'static str,
    /// The Window menu: macOS lists the open windows in it.
    pub windows: bool,
    pub items: Vec<MenuItem>,
}

/// The macOS app menu: BudgetMint's (About, Settings…, Check for Updates…,
/// Hide, Quit), Edit (without it, copy and paste don't reach a text field
/// in the webview), View and Window.
pub fn app_menu() -> Vec<Submenu> {
    use MenuItem::{Separator, System};
    use SystemItem::*;
    vec![
        Submenu {
            // macOS shows the app's name here whatever the title
            title: "BudgetMint",
            windows: false,
            items: vec![
                System(About),
                Separator,
                MenuItem::Action {
                    id: SETTINGS,
                    label: "Settings…",
                    shortcut: Some("CmdOrCtrl+,"),
                },
                MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…"),
                Separator,
                System(Services),
                Separator,
                System(Hide),
                System(HideOthers),
                System(ShowAll),
                Separator,
                System(Quit),
            ],
        },
        Submenu {
            title: "Edit",
            windows: false,
            items: vec![
                System(Undo),
                System(Redo),
                Separator,
                System(Cut),
                System(Copy),
                System(Paste),
                System(SelectAll),
            ],
        },
        Submenu {
            title: "View",
            windows: false,
            items: vec![System(Fullscreen)],
        },
        Submenu {
            title: "Window",
            windows: true,
            items: vec![
                System(Minimize),
                System(Maximize),
                Separator,
                System(CloseWindow),
            ],
        },
    ]
}

/// What a click on one of the menus' items does. The window comes forward
/// first, so what the webview does next is seen.
pub fn clicked(platform: &dyn Platform, id: &str) {
    match id {
        OPEN => platform.show_main_window(),
        SETTINGS => {
            platform.show_main_window();
            emit_quiet(platform, events::OPEN_SETTINGS, ());
        }
        CHECK_FOR_UPDATES => {
            platform.show_main_window();
            emit_quiet(platform, events::CHECK_FOR_UPDATES, ());
        }
        QUIT => platform.quit(),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use serde_json::Value;

    fn items(menu: &[Submenu], title: &str) -> Vec<MenuItem> {
        menu.iter()
            .find(|submenu| submenu.title == title)
            .map(|submenu| submenu.items.clone())
            .unwrap()
    }

    #[test]
    fn the_app_menu_has_settings_updates_and_the_standard_menus() {
        let menu = app_menu();
        let titles: Vec<_> = menu.iter().map(|submenu| submenu.title).collect();
        assert_eq!(titles, ["BudgetMint", "Edit", "View", "Window"]);

        let app = items(&menu, "BudgetMint");
        assert_eq!(app[0], MenuItem::System(SystemItem::About));
        assert!(app.contains(&MenuItem::Action {
            id: SETTINGS,
            label: "Settings…",
            shortcut: Some("CmdOrCtrl+,"),
        }));
        assert!(app.contains(&MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…")));
        assert_eq!(app.last(), Some(&MenuItem::System(SystemItem::Quit)));

        // Copy and paste in the webview's text fields go through these
        let edit = items(&menu, "Edit");
        for item in [
            SystemItem::Undo,
            SystemItem::Cut,
            SystemItem::Copy,
            SystemItem::Paste,
            SystemItem::SelectAll,
        ] {
            assert!(edit.contains(&MenuItem::System(item)), "{:?}", item);
        }

        let windows: Vec<_> = menu.iter().filter(|submenu| submenu.windows).collect();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].title, "Window");
        assert!(windows[0]
            .items
            .contains(&MenuItem::System(SystemItem::CloseWindow)));
    }

    #[test]
    fn open_settings_and_updates_bring_the_window_forward_first() {
        let platform = FakePlatform::default();
        clicked(&platform, OPEN);
        assert_eq!(platform.recorded().windows_shown, 1);
        assert!(platform.recorded().events.is_empty());

        clicked(&platform, SETTINGS);
        clicked(&platform, CHECK_FOR_UPDATES);
        let recorded = platform.recorded();
        assert_eq!(recorded.windows_shown, 3);
        assert_eq!(
            recorded.events,
            vec![
                (events::OPEN_SETTINGS.to_string(), Value::Null),
                (events::CHECK_FOR_UPDATES.to_string(), Value::Null),
            ]
        );
    }

    #[test]
    fn quit_quits_and_other_ids_do_nothing() {
        let platform = FakePlatform::default();
        clicked(&platform, "nope");
        assert_eq!(platform.recorded().windows_shown, 0);
        assert_eq!(platform.recorded().quits, 0);
        clicked(&platform, QUIT);
        assert_eq!(platform.recorded().quits, 1);
    }
}
