//! BudgetMint's rules, shared by every app: the desktop, Android and the
//! web all run them as WebAssembly (crates/budgetmint-wasm) in their
//! webview, next to the Firestore data they're about.
//!
//! - Bills and income ([`model::Item`]) on schedules ([`recur`]), with what
//!   happened to each occurrence ([`model::Override`]).
//! - TaskMint's payout forecast ([`forecast`]): the withdrawals ahead.
//! - The cash flow those make from the balance the user set ([`project`]),
//!   and what each page shows of it ([`views`]); the reminders due
//!   ([`reminders`]).
//! - The documents they're kept in ([`docs`]), and the writes each change
//!   makes ([`plan`]).
//!
//! It's pure: no I/O, no clock, no randomness (clippy.toml). The client
//! passes the time, the zone and new ids in; [`host::JsonHost`] is what it
//! calls, by command name ([`command`]).

pub mod backup;
pub mod command;
pub mod docs;
pub mod error;
pub mod forecast;
pub mod host;
pub mod model;
pub mod occur;
pub mod plan;
pub mod project;
pub mod recur;
pub mod reminders;
pub mod time;
pub mod views;

#[cfg(test)]
mod testkit;

pub use error::CoreError;
pub use time::Ctx;
