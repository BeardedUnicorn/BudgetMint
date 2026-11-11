//! The webview's errors and warnings, in the shell's log file (the log
//! plugin's, app.rs) with its own, under the target "webview". The webview
//! sends them through dispatch's `log` (apps/desktop/src/logging.ts).

/// The log target the webview's lines go under.
pub const TARGET: &str = "webview";

/// The most of one message kept, in characters: a runaway one (a huge
/// object, printed) doesn't fill the log.
pub const MAX_CHARS: usize = 4000;

/// The level the webview's `level` names: its console's `error` and `warn`;
/// anything else is information.
pub fn level(name: &str) -> log::Level {
    match name {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        _ => log::Level::Info,
    }
}

/// `message`, cut to MAX_CHARS with an ellipsis.
pub fn shortened(message: &str) -> String {
    match message.char_indices().nth(MAX_CHARS) {
        Some((end, _)) => format!("{}…", &message[..end]),
        None => message.to_string(),
    }
}

/// Writes one of the webview's lines to the log.
pub fn webview(level_name: &str, message: &str) {
    log::log!(target: TARGET, level(level_name), "{}", shortened(message));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The webview's lines logged, for the tests (other modules' lines are
    /// left out).
    static LOGGED: Mutex<Vec<(log::Level, String)>> = Mutex::new(Vec::new());

    struct Capture;

    impl log::Log for Capture {
        fn enabled(&self, _metadata: &log::Metadata) -> bool {
            true
        }

        fn log(&self, record: &log::Record) {
            if record.target() == TARGET {
                let line = (record.level(), record.args().to_string());
                LOGGED.lock().unwrap().push(line);
            }
        }

        fn flush(&self) {}
    }

    static CAPTURE: Capture = Capture;

    #[test]
    fn errors_and_warnings_keep_their_level() {
        assert_eq!(level("error"), log::Level::Error);
        assert_eq!(level("warn"), log::Level::Warn);
        assert_eq!(level("info"), log::Level::Info);
        assert_eq!(level("anything"), log::Level::Info);
    }

    #[test]
    fn a_long_message_is_cut() {
        assert_eq!(shortened("short"), "short");
        let exact = "é".repeat(MAX_CHARS);
        assert_eq!(shortened(&exact), exact);
        let long = "é".repeat(MAX_CHARS + 5);
        let cut = shortened(&long);
        assert_eq!(cut.chars().count(), MAX_CHARS + 1);
        assert!(cut.ends_with("é…"));
    }

    #[test]
    fn writes_the_line_under_the_webviews_target() {
        // The only logger the tests set (a second set_logger would fail)
        log::set_logger(&CAPTURE).unwrap();
        log::set_max_level(log::LevelFilter::Info);
        assert!(log::Log::enabled(
            &CAPTURE,
            &log::Metadata::builder().build()
        ));
        webview("warn", "Automatic update check failed: offline");
        webview("error", &"x".repeat(MAX_CHARS + 1));
        log::Log::flush(&CAPTURE);
        // (Other tests may log at the same time)
        let logged = LOGGED.lock().unwrap().clone();
        for line in [
            (
                log::Level::Warn,
                "Automatic update check failed: offline".to_string(),
            ),
            (log::Level::Error, format!("{}…", "x".repeat(MAX_CHARS))),
        ] {
            assert!(logged.contains(&line), "{:?}", line);
        }
    }
}
