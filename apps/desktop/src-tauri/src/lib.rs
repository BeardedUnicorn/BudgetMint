//! BudgetMint's shell on the desktop and Android: a window for the client,
//! and what the webview can't do itself. Its data is the cloud's, read and
//! written in the webview (packages/client), so the shell only shows
//! reminders, keeps the tray and the menus, signs in with Google in the
//! browser, keeps the log, and updates itself. The webview reaches it
//! through one command, `dispatch`.

mod app;
pub mod dispatch;
pub mod environment;
pub mod events;
pub mod files;
pub mod google_sign_in;
pub mod logs;
pub mod menu;
pub mod platform;
pub mod reminders;
pub mod state;
pub mod tray;
pub mod updates;
pub mod window;

#[cfg(test)]
mod testing;

pub use app::run;
