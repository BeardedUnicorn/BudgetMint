//! BudgetMint's shell on the desktop and Android: a window for the client,
//! and what the webview can't do itself. Its data is the cloud's, read and
//! written in the webview (packages/client), so the shell only shows
//! reminders, keeps the tray, signs in with Google in the browser, and
//! updates itself. The webview reaches it through one command, `dispatch`.

mod app;
pub mod dispatch;
pub mod events;
pub mod google_sign_in;
pub mod platform;
pub mod reminders;
pub mod state;
pub mod tray;
pub mod updates;

#[cfg(test)]
mod testing;

pub use app::run;
