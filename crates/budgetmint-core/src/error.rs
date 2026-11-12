//! What a command can fail with. The messages are shown to the user as they
//! are, so they say what to do.

use serde::Serialize;
use std::fmt;

/// Which of a form's fields a refusal is about, so the form says it there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum FormField {
    Name,
    Amount,
    /// How often it repeats.
    Repeat,
    /// When it starts (or a change to it does).
    Dates,
    /// When it ends.
    Ends,
    Category,
    Note,
    Reminder,
    /// What's set aside for it already.
    Saved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    UnknownCommand(String),
    /// The arguments don't read as the command's.
    InvalidArgs(String),
    /// A value the rules don't allow: the message says which.
    Invalid(String),
    /// A value the rules don't allow in one field of a form.
    InvalidField(FormField, String),
    /// Something the command names isn't there (deleted on another device).
    NotFound(String),
}

impl CoreError {
    /// The field it's about, when it's about one.
    pub fn field(&self) -> Option<FormField> {
        match self {
            CoreError::InvalidField(field, _) => Some(*field),
            _ => None,
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::UnknownCommand(name) => write!(f, "Unknown command: {}", name),
            CoreError::InvalidArgs(message)
            | CoreError::Invalid(message)
            | CoreError::InvalidField(_, message)
            | CoreError::NotFound(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for CoreError {}

/// A refused command, as the apps get it: the message to show, and the
/// field it's about (a form says it under that field).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
pub struct Refusal {
    pub message: String,
    pub field: Option<FormField>,
}

impl From<&CoreError> for Refusal {
    fn from(error: &CoreError) -> Self {
        Refusal {
            message: error.to_string(),
            field: error.field(),
        }
    }
}

/// A rule's refusal.
pub fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Invalid(message.into())
}

/// A rule's refusal of one field.
pub fn invalid_at(field: FormField, message: impl Into<String>) -> CoreError {
    CoreError::InvalidField(field, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_went_wrong() {
        assert_eq!(
            CoreError::UnknownCommand("x".into()).to_string(),
            "Unknown command: x"
        );
        assert_eq!(CoreError::InvalidArgs("bad".into()).to_string(), "bad");
        assert_eq!(invalid("Name the bill").to_string(), "Name the bill");
        assert_eq!(
            CoreError::NotFound("gone".into()).to_string(),
            "gone".to_string()
        );
        assert_eq!(invalid("x").field(), None);
        let named = invalid_at(FormField::Name, "Give it a name");
        assert_eq!(named.to_string(), "Give it a name");
        assert_eq!(
            Refusal::from(&named),
            Refusal {
                message: "Give it a name".into(),
                field: Some(FormField::Name)
            }
        );
    }
}
