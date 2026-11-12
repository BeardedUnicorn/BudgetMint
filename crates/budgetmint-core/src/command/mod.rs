//! Every command, by its wire name, with its arguments and reply: the one
//! table (`command_types!`) gives the names, a check of each reply's type,
//! and the TypeScript `CommandMap` (packages/contracts, from
//! tests/contracts.rs).

use crate::backup::{BudgetExport, MonthExport};
use crate::balance::{self, BalanceCheckView, OccRef, PaidInput, SpendingEstimate};
use crate::bank::{self, CsvColumns, StatementView};
use crate::docs::{DocWrite, DocsApplied, IncomingDoc, Snapshot};
use crate::error::CoreError;
use crate::forecast::{ForecastDoc, ForecastStatus, TaskMint};
use crate::goals::{self, GoalsView};
use crate::model::{Balance, Cents, Repeat, Settings, Weekends};
use crate::plan::{
    self, AccountInput, ItemInput, OccurrenceInput, Planned, RecordInput, ScheduleChange,
};
use crate::reminders::{self, Reminder};
use crate::report::{self, ReportView};
use crate::time::Ctx;
use crate::views::{
    self, AccountView, ForecastView, ItemView, MonthView, OccurrenceView, Overview,
};
use chrono::NaiveDate;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The account's data as core holds it: the client's documents and TaskMint's forecast.
#[derive(Debug, Clone, Default)]
pub struct Budget {
    pub snapshot: Snapshot,
    pub taskmint: TaskMint,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", content = "args", rename_all = "snake_case")]
pub enum Command {
    ApplyDocs(ApplyDocsArgs),
    ResetDocs(NoArgs),
    ApplyForecast(ApplyForecastArgs),
    GetOverview(NoArgs),
    GetMonth(MonthArgs),
    GetForecast(NoArgs),
    GetItems(NoArgs),
    GetItemHistory(ItemHistoryArgs),
    GetReminders(RemindersArgs),
    GetSettings(NoArgs),
    SaveItem(SaveItemArgs),
    ChangeSchedule(ChangeScheduleArgs),
    ArchiveItem(ArchiveItemArgs),
    DeleteItem(ItemIdArgs),
    SetOccurrence(SetOccurrenceArgs),
    SetBalance(SetBalanceArgs),
    SaveSettings(SaveSettingsArgs),
    Undo(UndoArgs),
    ExportBudget(NoArgs),
    RestoreBudget(RestoreBudgetArgs),
    GetGoals(NoArgs),
    GetReport(MonthArgs),
    GetBalanceCheck(BalanceCheckArgs),
    GetSpendingEstimate(NoArgs),
    Settle(SettleArgs),
    ReadStatement(ReadStatementArgs),
    GetScheduleDates(ScheduleDatesArgs),
    Record(RecordArgs),
    ExportMonth(MonthArgs),
    GetAccounts(NoArgs),
    SaveAccount(SaveAccountArgs),
    ArchiveAccount(ArchiveAccountArgs),
    DeleteAccount(AccountIdArgs),
    GetAccountOverview(AccountIdArgs),
    GetAccountForecast(AccountIdArgs),
}

macro_rules! command_types {
    ($($name:literal: $args:ty => $reply:ty,)*) => {
        /// Every command's name, as `Command` spells them.
        pub const COMMAND_NAMES: &[&str] = &[$($name),*];

        /// Whether `reply` is exactly a reply of `command`'s declared type:
        /// it reads as that type and writes back unchanged.
        pub fn check_reply(command: &str, reply: &serde_json::Value) -> Result<(), String> {
            let reread = match command {
                $($name => reread::<$reply>(reply),)*
                _ => return Err(format!("{} has no declared reply", command)),
            };
            match reread? {
                again if again == *reply => Ok(()),
                again => Err(format!("it reads back as {}", again)),
            }
        }

        /// Each command's argument and reply types in TypeScript, and the
        /// generated types they name.
        #[cfg(feature = "ts")]
        pub fn command_types(cfg: &ts_rs::Config) -> Vec<CommandTypes> {
            vec![$(CommandTypes {
                name: $name,
                args: <$args as ts_rs::TS>::name(cfg),
                reply: <$reply as ts_rs::TS>::name(cfg),
                uses: [type_names::<$args>(cfg), type_names::<$reply>(cfg)].concat(),
            },)*]
        }
    };
}

command_types! {
    "apply_docs": ApplyDocsArgs => DocsApplied,
    "reset_docs": NoArgs => (),
    "apply_forecast": ApplyForecastArgs => ForecastStatus,
    "get_overview": NoArgs => Overview,
    "get_month": MonthArgs => MonthView,
    "get_forecast": NoArgs => ForecastView,
    "get_items": NoArgs => Vec<ItemView>,
    "get_item_history": ItemHistoryArgs => Vec<OccurrenceView>,
    "get_reminders": RemindersArgs => Vec<Reminder>,
    "get_settings": NoArgs => SettingsView,
    "save_item": SaveItemArgs => Planned,
    "change_schedule": ChangeScheduleArgs => Planned,
    "archive_item": ArchiveItemArgs => Planned,
    "delete_item": ItemIdArgs => Planned,
    "set_occurrence": SetOccurrenceArgs => Planned,
    "set_balance": SetBalanceArgs => Planned,
    "save_settings": SaveSettingsArgs => Planned,
    "undo": UndoArgs => Vec<DocWrite>,
    "export_budget": NoArgs => BudgetExport,
    "restore_budget": RestoreBudgetArgs => Planned,
    "get_goals": NoArgs => GoalsView,
    "get_report": MonthArgs => ReportView,
    "get_balance_check": BalanceCheckArgs => BalanceCheckView,
    "get_spending_estimate": NoArgs => Option<SpendingEstimate>,
    "settle": SettleArgs => Planned,
    "read_statement": ReadStatementArgs => StatementView,
    "get_schedule_dates": ScheduleDatesArgs => Vec<ScheduleDate>,
    "record": RecordArgs => Planned,
    "export_month": MonthArgs => MonthExport,
    "get_accounts": NoArgs => Vec<AccountView>,
    "save_account": SaveAccountArgs => Planned,
    "archive_account": ArchiveAccountArgs => Planned,
    "delete_account": AccountIdArgs => Planned,
    "get_account_overview": AccountIdArgs => Overview,
    "get_account_forecast": AccountIdArgs => ForecastView,
}

/// `reply` read as a `T` and written back.
fn reread<T: Serialize + DeserializeOwned>(
    reply: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    T::deserialize(reply)
        .map(|typed| serde_json::to_value(typed).expect("replies are plain data"))
        .map_err(|e| format!("it doesn't read as its reply type: {}", e))
}

/// One command in TypeScript: `args` is "NoArgs" for a command without any.
#[cfg(feature = "ts")]
#[derive(Debug)]
pub struct CommandTypes {
    pub name: &'static str,
    pub args: String,
    pub reply: String,
    /// The generated types `args` and `reply` mention.
    pub uses: Vec<String>,
}

/// The generated type `T` is, or the ones it wraps (`Vec<T>`, `Option<T>`).
#[cfg(feature = "ts")]
fn type_names<T: ts_rs::TS + 'static>(cfg: &ts_rs::Config) -> Vec<String> {
    struct Names<'a> {
        cfg: &'a ts_rs::Config,
        found: Vec<String>,
    }
    impl ts_rs::TypeVisitor for Names<'_> {
        fn visit<U: ts_rs::TS + 'static + ?Sized>(&mut self) {
            if U::output_path().is_some() {
                self.found.push(U::ident(self.cfg));
            }
        }
    }
    let mut names = Names {
        cfg,
        found: Vec::new(),
    };
    if T::output_path().is_some() {
        names.found.push(T::ident(cfg));
    } else {
        T::visit_generics(&mut names);
    }
    names.found
}

/// For commands that take no arguments: `{}`, `null`, or nothing at all.
#[derive(Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
pub struct NoArgs {}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ApplyDocsArgs {
    /// In the order they were read.
    pub docs: Vec<IncomingDoc>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ApplyForecastArgs {
    /// Null: there's none (or it was deleted).
    pub doc: Option<ForecastDoc>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct MonthArgs {
    /// YYYY-MM
    pub month: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ItemHistoryArgs {
    pub item_id: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RemindersArgs {
    pub window_days: u16,
    pub max: u16,
    /// When this device last ran: the reminders it missed since are
    /// included (reminders::upcoming).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub missed_since_ms: Option<i64>,
}

/// The settings, and whether any have been saved (onboarding comes first until they are).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub saved: bool,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SaveItemArgs {
    pub item: ItemInput,
    /// With it, the schedule also changes from a date on (plan::save_item_from).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub change: Option<ScheduleChange>,
    /// An edit to an item already there, refused once it's been deleted
    /// (on another device); without it, the item is added.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub edit: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ChangeScheduleArgs {
    pub item_id: String,
    pub from: NaiveDate,
    pub repeat: Repeat,
    pub amount_cents: Cents,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ArchiveItemArgs {
    pub item_id: String,
    pub archived: bool,
}

/// A schedule not saved yet: its first `count` dates (the item form's "First due", "After N payments").
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDatesArgs {
    pub from: NaiveDate,
    pub repeat: Repeat,
    #[serde(default)]
    pub weekends: Weekends,
    pub count: u16,
}

/// A date of a schedule: as the schedule has it (what `until` counts), and when it's due.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDate {
    pub scheduled: NaiveDate,
    pub due: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ItemIdArgs {
    pub item_id: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SaveAccountArgs {
    pub account: AccountInput,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAccountArgs {
    pub account_id: String,
    pub archived: bool,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct AccountIdArgs {
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SetOccurrenceArgs {
    pub occurrence: OccurrenceInput,
    /// Paid on or before the balance's day, after it was set: the balance moves by it too.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub from_balance: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RecordArgs {
    pub record: RecordInput,
    /// On or before the balance's day, after it was set: the balance moves by it too.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub from_balance: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SetBalanceArgs {
    pub balance: Balance,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsArgs {
    pub settings: Settings,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UndoArgs {
    /// The change to take back, as its command returned it.
    pub planned: Planned,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RestoreBudgetArgs {
    /// The backup file's text, as export_budget wrote it.
    pub backup: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct BalanceCheckArgs {
    /// The balance the user's giving (not set yet).
    pub balance: Balance,
    /// The open ones they say haven't come out (or in) yet.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub still_open: Option<Vec<OccRef>>,
    /// What the others came to, where the user said (else as expected).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub amounts: Option<Vec<PaidInput>>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SettleArgs {
    /// One-offs to record with it (a statement's transactions that are no bill or income here).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub record: Option<Vec<RecordInput>>,
    /// Marked paid (or received), each on a day for an amount.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub paid: Option<Vec<PaidInput>>,
    /// Not paid yet after all: left to come the day after the balance's.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub still_open: Option<Vec<OccRef>>,
    /// The new balance, checked against what was expected by its day.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub balance: Option<Balance>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReadStatementArgs {
    /// The statement file's text.
    pub text: String,
    /// A CSV's columns, when they weren't found.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub columns: Option<CsvColumns>,
}

impl Command {
    /// The command `name` with `args`, as a client sent them. Missing or null
    /// args are `{}`, and unknown keys are ignored.
    pub fn parse(name: &str, args: serde_json::Value) -> Result<Command, CoreError> {
        if !COMMAND_NAMES.contains(&name) {
            return Err(CoreError::UnknownCommand(name.to_string()));
        }
        let args = if args.is_null() {
            serde_json::json!({})
        } else {
            args
        };
        serde_json::from_value(serde_json::json!({ "command": name, "args": args }))
            .map_err(|e| CoreError::InvalidArgs(format!("Invalid arguments for {}: {}", name, e)))
    }
}

fn to_value<T: Serialize>(value: T) -> serde_json::Value {
    serde_json::to_value(value).expect("replies are plain data")
}

/// What a page of one account is refused with once it's gone, or archived.
fn no_account() -> CoreError {
    CoreError::NotFound("That account isn't in use any more".into())
}

/// Runs `command` on `budget`, as of `ctx`; its reply as JSON.
pub fn execute(
    command: Command,
    budget: &mut Budget,
    ctx: &Ctx,
) -> Result<serde_json::Value, CoreError> {
    let Budget { snapshot, taskmint } = budget;
    let forecast = taskmint.forecast.as_ref();
    Ok(match command {
        Command::ApplyDocs(args) => to_value(snapshot.apply(args.docs)),
        // Signed out, or the data deleted: nothing of the account's is left
        Command::ResetDocs(_) => {
            *snapshot = Snapshot::default();
            *taskmint = TaskMint::default();
            to_value(())
        }
        Command::ApplyForecast(args) => {
            *taskmint = TaskMint::read(args.doc);
            to_value(&taskmint.status)
        }
        Command::GetOverview(_) => {
            to_value(views::overview(snapshot, forecast, &taskmint.status, ctx))
        }
        Command::GetMonth(args) => to_value(
            views::month(snapshot, forecast, &args.month, ctx)
                .ok_or_else(|| CoreError::InvalidArgs(format!("Not a month: {}", args.month)))?,
        ),
        Command::GetForecast(_) => {
            to_value(views::forecast(snapshot, forecast, &taskmint.status, ctx))
        }
        Command::GetItems(_) => to_value(views::items(snapshot, ctx)),
        Command::GetItemHistory(args) => to_value(
            views::history(snapshot, &args.item_id, args.from, args.to, ctx)
                .ok_or_else(|| CoreError::NotFound("That bill isn't there any more".into()))?,
        ),
        Command::GetReminders(args) => to_value(reminders::upcoming(
            snapshot,
            forecast,
            ctx,
            args.window_days,
            args.max,
            args.missed_since_ms,
        )),
        Command::GetSettings(_) => to_value(SettingsView {
            settings: snapshot.settings(),
            saved: snapshot.settings.is_some(),
        }),
        Command::SaveItem(args) => to_value(plan::save_item_from(
            snapshot,
            args.item,
            args.change,
            args.edit.unwrap_or(false),
            ctx,
        )?),
        Command::ChangeSchedule(args) => to_value(plan::change_schedule(
            snapshot,
            &args.item_id,
            args.from,
            args.repeat,
            args.amount_cents,
            ctx,
        )?),
        Command::ArchiveItem(args) => to_value(plan::archive_item(
            snapshot,
            &args.item_id,
            args.archived,
            ctx,
        )?),
        Command::DeleteItem(args) => to_value(plan::delete_item(snapshot, &args.item_id)?),
        Command::SetOccurrence(args) => to_value(plan::set_occurrence_with_balance(
            snapshot,
            args.occurrence,
            args.from_balance.unwrap_or(false),
            ctx,
        )?),
        Command::SetBalance(args) => to_value(plan::set_balance(snapshot, args.balance, ctx)?),
        Command::Record(args) => to_value(plan::record_with_balance(
            snapshot,
            args.record,
            args.from_balance.unwrap_or(false),
            ctx,
        )?),
        Command::ExportMonth(args) => to_value(
            crate::backup::month_csv(snapshot, &args.month)
                .ok_or_else(|| CoreError::InvalidArgs(format!("Not a month: {}", args.month)))?,
        ),
        Command::SaveSettings(args) => to_value(plan::save_settings(snapshot, args.settings)?),
        Command::GetAccountOverview(args) => to_value(
            views::overview_of(
                snapshot,
                forecast,
                &taskmint.status,
                ctx,
                Some(&args.account_id),
            )
            .ok_or_else(no_account)?,
        ),
        Command::GetAccountForecast(args) => to_value(
            views::forecast_of(
                snapshot,
                forecast,
                &taskmint.status,
                ctx,
                Some(&args.account_id),
            )
            .ok_or_else(no_account)?,
        ),
        Command::GetAccounts(_) => to_value(views::accounts(snapshot)),
        Command::SaveAccount(args) => to_value(plan::save_account(snapshot, args.account)?),
        Command::ArchiveAccount(args) => to_value(plan::archive_account(
            snapshot,
            &args.account_id,
            args.archived,
        )?),
        Command::DeleteAccount(args) => to_value(plan::delete_account(snapshot, &args.account_id)?),
        Command::Undo(args) => to_value(plan::undo(snapshot, args.planned)?),
        Command::ExportBudget(_) => to_value(crate::backup::export(snapshot, ctx)),
        Command::RestoreBudget(args) => to_value(plan::restore_budget(snapshot, &args.backup)?),
        Command::GetGoals(_) => to_value(goals::goals(snapshot, ctx)),
        Command::GetReport(args) => to_value(
            report::report(snapshot, forecast, &args.month, ctx)
                .ok_or_else(|| CoreError::InvalidArgs(format!("Not a month: {}", args.month)))?,
        ),
        Command::GetBalanceCheck(args) => to_value(balance::balance_check(
            snapshot,
            forecast,
            args.balance,
            args.still_open.unwrap_or_default(),
            &args.amounts.unwrap_or_default(),
            ctx,
        )),
        Command::GetSpendingEstimate(_) => to_value(balance::spending_estimate(
            &snapshot.settings(),
            ctx.today(),
        )),
        Command::Settle(args) => to_value(balance::settle(
            snapshot,
            forecast,
            args.record.unwrap_or_default(),
            args.paid.unwrap_or_default(),
            args.still_open.unwrap_or_default(),
            args.balance,
            ctx,
        )?),
        Command::ReadStatement(args) => to_value(bank::read_statement(
            snapshot,
            &args.text,
            args.columns,
            ctx,
        )?),
        Command::GetScheduleDates(args) => {
            plan::check_date(args.from)?;
            plan::check_repeat(args.repeat)?;
            if args.count == 0 {
                return Err(CoreError::InvalidArgs("Ask for one date or more".into()));
            }
            to_value(
                crate::recur::first_dates(args.from, args.repeat, args.weekends, args.count.into())
                    .into_iter()
                    .map(|(scheduled, due)| ScheduleDate { scheduled, due })
                    .collect::<Vec<_>>(),
            )
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_commands_by_name_and_says_what_it_cant() {
        let name = |command: Command| format!("{:?}", command);
        assert!(
            name(Command::parse("get_overview", json!(null)).unwrap()).starts_with("GetOverview")
        );
        assert!(
            name(Command::parse("reset_docs", json!({ "extra": 1 })).unwrap())
                .starts_with("ResetDocs")
        );
        assert_eq!(
            Command::parse("nope", json!({})).unwrap_err(),
            CoreError::UnknownCommand("nope".into())
        );
        let bad = Command::parse("get_month", json!({ "month": 5 }))
            .unwrap_err()
            .to_string();
        assert!(
            bad.starts_with("Invalid arguments for get_month: "),
            "{}",
            bad
        );
    }

    #[test]
    fn checks_replies_against_their_declared_types() {
        assert_eq!(check_reply("reset_docs", &json!(null)), Ok(()));
        assert!(check_reply("nope", &json!(null))
            .unwrap_err()
            .contains("no declared reply"));
        assert!(check_reply("get_items", &json!({}))
            .unwrap_err()
            .contains("doesn't read"));
        // Reads, but with something its type doesn't have
        let extra = json!({ "applied": 0, "held": [], "unreadable": [], "extra": true });
        assert!(check_reply("apply_docs", &extra)
            .unwrap_err()
            .contains("reads back as"));
    }
}
