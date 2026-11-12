//! The menus: their items, as data, and what a click on one does. The tray's
//! menu (tray.rs) and, on macOS, the menu bar share the ids below, and their
//! clicks all come to `clicked`. platform/os.rs turns the items into Tauri's.
//!
//! Most items are the webview's to do (it opens the page, the dialog): the
//! click comes to it as MENU_COMMAND with the item's id
//! (packages/client/src/hooks/useMenuCommands.ts has the same ids). The
//! Help menu's links and Open Logs Folder need no window, and are done here.

use crate::events::{self, emit_quiet};
use crate::platform::Platform;

/// Open BudgetMint: shows the window.
pub const OPEN: &str = "open";
/// About BudgetMint: the webview's About window.
pub const ABOUT: &str = "about";
/// Settings…: the window, on Settings.
pub const SETTINGS: &str = "settings";
/// Check for Updates…: the window, with the check's outcome in a dialog.
pub const CHECK_FOR_UPDATES: &str = "check-for-updates";
/// Sign Out…: the webview asks first.
pub const SIGN_OUT: &str = "sign-out";
/// The Quit item's id where it's an ordinary item (Linux: GTK greys out the
/// system's own Quit item, and closing the window only hides it in the tray).
pub const QUIT: &str = "quit";

// The File menu
pub const NEW_BILL: &str = "new-bill";
pub const NEW_INCOME: &str = "new-income";
pub const UPDATE_BALANCE: &str = "update-balance";
/// Settings › Your data, where the statement's file is picked.
pub const IMPORT_STATEMENT: &str = "import-statement";
pub const DOWNLOAD_BACKUP: &str = "download-backup";
pub const DOWNLOAD_SPREADSHEET: &str = "download-spreadsheet";

// The View and Help menus' items the webview does
pub const TOGGLE_SIDEBAR: &str = "toggle-sidebar";
pub const SHORTCUTS: &str = "shortcuts";

// The Help menu's own
pub const RELEASE_NOTES: &str = "release-notes";
pub const REPORT_PROBLEM: &str = "report-problem";
pub const OPEN_LOGS: &str = "open-logs";
pub const PRIVACY: &str = "privacy";
pub const TERMS: &str = "terms";
pub const SOURCE: &str = "source";

/// The Go menu: each page's item (`go-` and the webview's name for it), and
/// its shortcut, the webview's own (⌘1…; Settings has ⌘,).
pub const GO: [(&str, &str, &str); 7] = [
    ("go-overview", "Overview", "CmdOrCtrl+1"),
    ("go-bills", "Bills", "CmdOrCtrl+2"),
    ("go-income", "Income", "CmdOrCtrl+3"),
    ("go-savings", "Savings", "CmdOrCtrl+4"),
    ("go-calendar", "Calendar", "CmdOrCtrl+5"),
    ("go-forecast", "Forecast", "CmdOrCtrl+6"),
    ("go-reports", "Reports", "CmdOrCtrl+7"),
];

/// The items the webview does: a click shows the window and sends it the id.
const WEBVIEW_DOES: [&str; 11] = [
    ABOUT,
    SETTINGS,
    SIGN_OUT,
    NEW_BILL,
    NEW_INCOME,
    UPDATE_BALANCE,
    IMPORT_STATEMENT,
    DOWNLOAD_BACKUP,
    DOWNLOAD_SPREADSHEET,
    TOGGLE_SIDEBAR,
    SHORTCUTS,
];

const REPOSITORY: &str = "https://github.com/BeardedUnicorn/BudgetMint";

/// The pages the Help menu's links open (Report a Problem's is `report_url`).
pub fn link(id: &str) -> Option<String> {
    match id {
        RELEASE_NOTES => Some(format!("{}/blob/main/CHANGELOG.md", REPOSITORY)),
        PRIVACY => Some("https://budgetmint.web.app/privacy".into()),
        TERMS => Some("https://budgetmint.web.app/terms".into()),
        SOURCE => Some(REPOSITORY.into()),
        REPORT_PROBLEM => Some(report_url(env!("CARGO_PKG_VERSION"), std::env::consts::OS)),
        _ => None,
    }
}

/// The system's name, as a bug report wants it (Rust's `consts::OS`).
fn system_name(os: &str) -> &str {
    match os {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

/// A new issue on GitHub, with the version and the system under the space
/// for what happened (as the About window's Report a problem).
pub fn report_url(version: &str, os: &str) -> String {
    let body = format!(
        "What happened, and what you expected:\n\n\n---\nBudgetMint {} · desktop · {}",
        version,
        system_name(os)
    );
    format!(
        "{}/issues/new?body={}",
        REPOSITORY,
        url::form_urlencoded::byte_serialize(body.as_bytes()).collect::<String>()
    )
}

/// One of the system's own items: each acts by itself (Copy copies the
/// selection in the focused text field) and comes with the system's words
/// and shortcut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemItem {
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
    BringAllToFront,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuItem {
    /// A line of text (not clickable).
    Label(String),
    /// A clickable item: the id its click comes back with, its shortcut
    /// (Tauri's accelerator, "CmdOrCtrl+,"), and whether it's for the
    /// budget: greyed out until the budget is open (signed in, past
    /// onboarding).
    Action {
        id: &'static str,
        label: &'static str,
        shortcut: Option<&'static str>,
        needs_budget: bool,
    },
    Separator,
    System(SystemItem),
}

impl MenuItem {
    /// An item with no shortcut, there whether the budget is open or not.
    pub const fn action(id: &'static str, label: &'static str) -> Self {
        MenuItem::Action {
            id,
            label,
            shortcut: None,
            needs_budget: false,
        }
    }

    /// With `shortcut`.
    pub fn key(self, shortcut: &'static str) -> Self {
        match self {
            MenuItem::Action {
                id,
                label,
                needs_budget,
                ..
            } => MenuItem::Action {
                id,
                label,
                shortcut: Some(shortcut),
                needs_budget,
            },
            other => other,
        }
    }

    /// Greyed out until the budget is open.
    pub fn for_budget(self) -> Self {
        match self {
            MenuItem::Action {
                id,
                label,
                shortcut,
                ..
            } => MenuItem::Action {
                id,
                label,
                shortcut,
                needs_budget: true,
            },
            other => other,
        }
    }
}

/// One of the menu bar's menus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submenu {
    pub title: &'static str,
    /// The Window menu: macOS lists the open windows in it.
    pub windows: bool,
    /// The Help menu: macOS adds its search field.
    pub help: bool,
    pub items: Vec<MenuItem>,
}

impl Submenu {
    fn new(title: &'static str, items: Vec<MenuItem>) -> Self {
        Self {
            title,
            windows: false,
            help: false,
            items,
        }
    }
}

/// The macOS menu bar: BudgetMint's menu (About, Settings…, Check for
/// Updates…, Sign Out…, Hide, Quit), File (adding, the balance, a
/// statement, a backup), Edit (without it, copy and paste don't reach a
/// text field in the webview), View, Go (the pages), Window and Help.
pub fn app_menu() -> Vec<Submenu> {
    use MenuItem::{Separator, System};
    use SystemItem::*;
    let action = MenuItem::action;
    vec![
        // macOS shows the app's name here whatever the title
        Submenu::new(
            "BudgetMint",
            vec![
                action(ABOUT, "About BudgetMint"),
                Separator,
                action(SETTINGS, "Settings…")
                    .key("CmdOrCtrl+,")
                    .for_budget(),
                action(CHECK_FOR_UPDATES, "Check for Updates…"),
                Separator,
                action(SIGN_OUT, "Sign Out…").for_budget(),
                Separator,
                System(Services),
                Separator,
                System(Hide),
                System(HideOthers),
                System(ShowAll),
                Separator,
                System(Quit),
            ],
        ),
        Submenu::new(
            "File",
            vec![
                action(NEW_BILL, "New Bill").key("CmdOrCtrl+N").for_budget(),
                action(NEW_INCOME, "New Income")
                    .key("CmdOrCtrl+Shift+N")
                    .for_budget(),
                Separator,
                action(UPDATE_BALANCE, "Update Balance…")
                    .key("CmdOrCtrl+B")
                    .for_budget(),
                action(IMPORT_STATEMENT, "Import Bank Statement…").for_budget(),
                Separator,
                action(DOWNLOAD_BACKUP, "Download Backup…").for_budget(),
                action(DOWNLOAD_SPREADSHEET, "Download Spreadsheet…").for_budget(),
                Separator,
                System(CloseWindow),
            ],
        ),
        Submenu::new(
            "Edit",
            vec![
                System(Undo),
                System(Redo),
                Separator,
                System(Cut),
                System(Copy),
                System(Paste),
                System(SelectAll),
            ],
        ),
        Submenu::new(
            "View",
            vec![
                action(TOGGLE_SIDEBAR, "Show or Hide Sidebar")
                    .key("Ctrl+Cmd+S")
                    .for_budget(),
                Separator,
                System(Fullscreen),
            ],
        ),
        Submenu::new(
            "Go",
            GO.iter()
                .map(|&(id, label, shortcut)| action(id, label).key(shortcut).for_budget())
                .collect(),
        ),
        Submenu {
            windows: true,
            ..Submenu::new(
                "Window",
                vec![
                    System(Minimize),
                    System(Maximize),
                    Separator,
                    System(BringAllToFront),
                ],
            )
        },
        Submenu {
            help: true,
            ..Submenu::new(
                "Help",
                vec![
                    action(SHORTCUTS, "Keyboard Shortcuts")
                        .key("CmdOrCtrl+/")
                        .for_budget(),
                    action(RELEASE_NOTES, "Release Notes"),
                    Separator,
                    action(REPORT_PROBLEM, "Report a Problem…"),
                    action(OPEN_LOGS, "Open Logs Folder"),
                    Separator,
                    action(PRIVACY, "Privacy Policy"),
                    action(TERMS, "Terms of Use"),
                    action(SOURCE, "BudgetMint on GitHub"),
                ],
            )
        },
    ]
}

/// The ids of the items greyed out until the budget is open.
pub fn budget_items(menu: &[Submenu]) -> Vec<&'static str> {
    menu.iter()
        .flat_map(|submenu| &submenu.items)
        .filter_map(|item| match item {
            MenuItem::Action {
                id,
                needs_budget: true,
                ..
            } => Some(*id),
            _ => None,
        })
        .collect()
}

/// What a click on one of the menus' items does. For the webview's items,
/// the window comes forward first, so what it does next is seen.
pub fn clicked(platform: &dyn Platform, id: &str) {
    match id {
        OPEN => platform.show_main_window(),
        CHECK_FOR_UPDATES => {
            platform.show_main_window();
            emit_quiet(platform, events::CHECK_FOR_UPDATES, ());
        }
        QUIT => platform.quit(),
        OPEN_LOGS => {
            if let Err(e) = platform.open_logs_folder() {
                log::warn!("Failed to open the logs folder: {}", e);
            }
        }
        _ if WEBVIEW_DOES.contains(&id) || GO.iter().any(|&(go, _, _)| go == id) => {
            platform.show_main_window();
            emit_quiet(platform, events::MENU_COMMAND, id);
        }
        _ => {
            if let Some(url) = link(id) {
                if let Err(e) = platform.open_url(&url) {
                    log::warn!("Failed to open {}: {}", url, e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use serde_json::{json, Value};

    fn items(menu: &[Submenu], title: &str) -> Vec<MenuItem> {
        menu.iter()
            .find(|submenu| submenu.title == title)
            .map(|submenu| submenu.items.clone())
            .unwrap()
    }

    fn ids(items: &[MenuItem]) -> Vec<&'static str> {
        items
            .iter()
            .filter_map(|item| match item {
                MenuItem::Action { id, .. } => Some(*id),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_menu_bar_has_the_apps_menus_and_the_standard_ones() {
        let menu = app_menu();
        let titles: Vec<_> = menu.iter().map(|submenu| submenu.title).collect();
        assert_eq!(
            titles,
            ["BudgetMint", "File", "Edit", "View", "Go", "Window", "Help"]
        );

        let app = items(&menu, "BudgetMint");
        assert_eq!(app[0], MenuItem::action(ABOUT, "About BudgetMint"));
        assert!(app.contains(
            &MenuItem::action(SETTINGS, "Settings…")
                .key("CmdOrCtrl+,")
                .for_budget()
        ));
        assert!(app.contains(&MenuItem::action(CHECK_FOR_UPDATES, "Check for Updates…")));
        assert!(app.contains(&MenuItem::action(SIGN_OUT, "Sign Out…").for_budget()));
        assert_eq!(app.last(), Some(&MenuItem::System(SystemItem::Quit)));

        assert_eq!(
            ids(&items(&menu, "File")),
            [
                NEW_BILL,
                NEW_INCOME,
                UPDATE_BALANCE,
                IMPORT_STATEMENT,
                DOWNLOAD_BACKUP,
                DOWNLOAD_SPREADSHEET
            ]
        );
        // The webview's own shortcuts, shown in the menu
        assert!(items(&menu, "File").contains(
            &MenuItem::action(NEW_BILL, "New Bill")
                .key("CmdOrCtrl+N")
                .for_budget()
        ));
        assert_eq!(
            ids(&items(&menu, "Go")),
            GO.iter().map(|&(id, _, _)| id).collect::<Vec<_>>()
        );
        assert!(items(&menu, "Go").contains(
            &MenuItem::action("go-calendar", "Calendar")
                .key("CmdOrCtrl+5")
                .for_budget()
        ));

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
        let help: Vec<_> = menu.iter().filter(|submenu| submenu.help).collect();
        assert_eq!(help.len(), 1);
        assert_eq!(help[0].title, "Help");
        assert_eq!(
            ids(&help[0].items),
            [
                SHORTCUTS,
                RELEASE_NOTES,
                REPORT_PROBLEM,
                OPEN_LOGS,
                PRIVACY,
                TERMS,
                SOURCE
            ]
        );
        assert!(items(&menu, "File").contains(&MenuItem::System(SystemItem::CloseWindow)));
    }

    #[test]
    fn the_budgets_items_wait_for_it_and_the_rest_dont() {
        let waiting = budget_items(&app_menu());
        for id in [
            SETTINGS,
            SIGN_OUT,
            NEW_BILL,
            DOWNLOAD_BACKUP,
            TOGGLE_SIDEBAR,
            SHORTCUTS,
            "go-bills",
        ] {
            assert!(waiting.contains(&id), "{}", id);
        }
        for id in [ABOUT, CHECK_FOR_UPDATES, RELEASE_NOTES, OPEN_LOGS] {
            assert!(!waiting.contains(&id), "{}", id);
        }
        // Only an item takes a shortcut, or waits
        assert_eq!(MenuItem::Separator.key("CmdOrCtrl+N"), MenuItem::Separator);
        assert_eq!(MenuItem::Separator.for_budget(), MenuItem::Separator);
    }

    #[test]
    fn the_webviews_items_bring_the_window_forward_then_go_to_it() {
        let platform = FakePlatform::default();
        clicked(&platform, OPEN);
        assert_eq!(platform.recorded().windows_shown, 1);
        assert!(platform.recorded().events.is_empty());

        clicked(&platform, SETTINGS);
        clicked(&platform, CHECK_FOR_UPDATES);
        clicked(&platform, NEW_BILL);
        clicked(&platform, "go-reports");
        let recorded = platform.recorded();
        assert_eq!(recorded.windows_shown, 5);
        assert_eq!(
            recorded.events,
            vec![
                (events::MENU_COMMAND.to_string(), json!(SETTINGS)),
                (events::CHECK_FOR_UPDATES.to_string(), Value::Null),
                (events::MENU_COMMAND.to_string(), json!(NEW_BILL)),
                (events::MENU_COMMAND.to_string(), json!("go-reports")),
            ]
        );
        assert!(recorded.opened_urls.is_empty());
    }

    #[test]
    fn the_help_menus_links_open_in_the_browser_without_the_window() {
        let platform = FakePlatform::default();
        for id in [RELEASE_NOTES, PRIVACY, TERMS, SOURCE, REPORT_PROBLEM] {
            clicked(&platform, id);
        }
        let recorded = platform.recorded();
        assert_eq!(recorded.windows_shown, 0);
        assert_eq!(
            recorded.opened_urls[..4],
            [
                "https://github.com/BeardedUnicorn/BudgetMint/blob/main/CHANGELOG.md",
                "https://budgetmint.web.app/privacy",
                "https://budgetmint.web.app/terms",
                "https://github.com/BeardedUnicorn/BudgetMint",
            ]
        );
        assert!(recorded.opened_urls[4]
            .starts_with("https://github.com/BeardedUnicorn/BudgetMint/issues/new?body="));

        // One that can't open is logged
        platform.fail("open_url");
        clicked(&platform, PRIVACY);
        assert_eq!(platform.recorded().opened_urls.len(), 5);
    }

    #[test]
    fn a_report_says_which_version_on_which_system() {
        let url = report_url("2.2.0", "macos");
        let body = url.split("body=").nth(1).unwrap();
        let decoded: String = url::form_urlencoded::parse(format!("body={}", body).as_bytes())
            .map(|(_, value)| value.into_owned())
            .collect();
        assert!(decoded.starts_with("What happened, and what you expected:"));
        assert!(decoded.ends_with("---\nBudgetMint 2.2.0 · desktop · macOS"));
        assert!(report_url("1.0.0", "windows").ends_with("Windows"));
        assert!(report_url("1.0.0", "linux").ends_with("Linux"));
        assert!(report_url("1.0.0", "freebsd").ends_with("freebsd"));
    }

    #[test]
    fn opens_the_logs_folder_and_quits_and_other_ids_do_nothing() {
        let platform = FakePlatform::default();
        clicked(&platform, OPEN_LOGS);
        assert_eq!(platform.recorded().logs_folders_opened, 1);
        platform.fail("open_logs_folder");
        clicked(&platform, OPEN_LOGS);
        assert_eq!(platform.recorded().logs_folders_opened, 1);

        clicked(&platform, "nope");
        let recorded = platform.recorded();
        assert_eq!(recorded.windows_shown, 0);
        assert!(recorded.events.is_empty() && recorded.opened_urls.is_empty());
        assert_eq!(recorded.quits, 0);
        clicked(&platform, QUIT);
        assert_eq!(platform.recorded().quits, 1);
    }
}
