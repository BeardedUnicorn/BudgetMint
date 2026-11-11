//! The tray (the menu bar on macOS): the lines the webview sends (today's
//! balance, the next bill, the lowest ahead), then Open and Quit. The words
//! are the webview's; this only lays them out (platform/os.rs renders it).

use crate::platform::Platform;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayItem {
    /// A line of text (not clickable).
    Label(String),
    /// A clickable item, with the id its click comes back with.
    Action {
        id: &'static str,
        label: &'static str,
    },
    Separator,
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMenu(pub Vec<TrayItem>);

/// The Open item's id.
pub const OPEN: &str = "open";

/// The menu for `lines`.
pub fn menu(lines: &[String]) -> TrayMenu {
    let mut items: Vec<TrayItem> = lines.iter().cloned().map(TrayItem::Label).collect();
    if !items.is_empty() {
        items.push(TrayItem::Separator);
    }
    items.push(TrayItem::Action {
        id: OPEN,
        label: "Open BudgetMint",
    });
    items.push(TrayItem::Quit);
    TrayMenu(items)
}

/// What a click on the tray's menu does.
pub fn clicked(platform: &dyn Platform, id: &str) {
    if id == OPEN {
        platform.show_main_window();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;

    #[test]
    fn lays_out_the_lines_then_open_and_quit() {
        assert_eq!(
            menu(&["Today: $1.00".into()]).0,
            vec![
                TrayItem::Label("Today: $1.00".into()),
                TrayItem::Separator,
                TrayItem::Action {
                    id: OPEN,
                    label: "Open BudgetMint"
                },
                TrayItem::Quit,
            ]
        );
        assert_eq!(menu(&[]).0.len(), 2);
    }

    #[test]
    fn open_shows_the_window() {
        let platform = FakePlatform::default();
        clicked(&platform, OPEN);
        clicked(&platform, "other");
        assert_eq!(platform.recorded().windows_shown, 1);
    }
}
