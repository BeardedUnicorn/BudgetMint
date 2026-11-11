//! What a command can fail with. The messages are shown to the user as they
//! are, so they say what to do.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    UnknownCommand(String),
    /// The arguments don't read as the command's.
    InvalidArgs(String),
    /// A value the rules don't allow: the message says which.
    Invalid(String),
    /// Something the command names isn't there (deleted on another device).
    NotFound(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::UnknownCommand(name) => write!(f, "Unknown command: {}", name),
            CoreError::InvalidArgs(message)
            | CoreError::Invalid(message)
            | CoreError::NotFound(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for CoreError {}

/// A rule's refusal.
pub fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Invalid(message.into())
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
    }
}
