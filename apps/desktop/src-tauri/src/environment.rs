// Adapted from TaskMint apps/desktop/src-tauri/src/environment.rs @ 8b486ac.
//! Which BudgetMint this build is: production (a release, the installed
//! app) or dev (every other build; ADR 0005). build.rs takes it from
//! BUDGETMINT_ENV (scripts/environment.mjs), the same variable that picks
//! the webview's Firebase projects, so the two always agree.
//!
//! A dev build installs beside the real app: tauri.conf.json gives it its
//! own identifier (so its own data folder, webview storage and
//! single-instance lock), name, link scheme and no update feed.
//! tauri.production.conf.json turns a build back into the real app, and
//! scripts/release.mjs is what applies it.

/// The installed app's identifier (tauri.production.conf.json).
pub const PRODUCTION_IDENTIFIER: &str = "com.budgetmint.desktop";
/// A dev build's (tauri.conf.json).
pub const DEV_IDENTIFIER: &str = "com.budgetmint.desktop.dev";
/// The installed app's links (tauri.production.conf.json registers it).
pub const PRODUCTION_DEEP_LINK_SCHEME: &str = "budgetmint";
/// A dev build's links (tauri.conf.json registers it).
pub const DEV_DEEP_LINK_SCHEME: &str = "budgetmint-dev";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Production,
    Dev,
}

impl Environment {
    /// This build's.
    pub fn current() -> Environment {
        Environment::named(env!("BUDGETMINT_ENV"))
    }

    /// build.rs refuses any name but these two.
    fn named(name: &str) -> Environment {
        if name == "production" {
            Environment::Production
        } else {
            Environment::Dev
        }
    }

    /// The scheme of the links the app answers (window.rs): Google
    /// sign-in's page opens one to bring the app back.
    pub fn deep_link_scheme(self) -> &'static str {
        match self {
            Environment::Production => PRODUCTION_DEEP_LINK_SCHEME,
            Environment::Dev => DEV_DEEP_LINK_SCHEME,
        }
    }

    /// Whether a build of this environment may run as the app with
    /// `identifier`. A production build has to be the installed app, and a
    /// dev build must never be it: either mix would sign one environment's
    /// accounts in with the other's stored sign-in and cache.
    pub fn check_identifier(self, identifier: &str) -> Result<(), String> {
        match self {
            Environment::Production if identifier != PRODUCTION_IDENTIFIER => Err(format!(
                "This production build (BUDGETMINT_ENV=production) is {identifier}, not \
                 {PRODUCTION_IDENTIFIER}: build it with --config src-tauri/tauri.production.conf.json, \
                 as scripts/release.mjs does."
            )),
            Environment::Dev if identifier == PRODUCTION_IDENTIFIER => Err(format!(
                "This dev build is {PRODUCTION_IDENTIFIER}, the installed app: build it with \
                 BUDGETMINT_ENV=production, or without tauri.production.conf.json."
            )),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn config(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_build_is_dev_unless_made_for_production() {
        assert_eq!(Environment::named("production"), Environment::Production);
        assert_eq!(Environment::named("dev"), Environment::Dev);
        // Tests are built as dev (BUDGETMINT_ENV unset)
        assert_eq!(Environment::current(), Environment::Dev);
    }

    #[test]
    fn dev_has_its_own_scheme() {
        assert_eq!(Environment::Production.deep_link_scheme(), "budgetmint");
        assert_eq!(Environment::Dev.deep_link_scheme(), "budgetmint-dev");
    }

    #[test]
    fn each_build_runs_only_as_its_own_app() {
        assert_eq!(
            Environment::Production.check_identifier(PRODUCTION_IDENTIFIER),
            Ok(())
        );
        assert!(Environment::Production
            .check_identifier(DEV_IDENTIFIER)
            .unwrap_err()
            .contains("tauri.production.conf.json"));
        assert_eq!(Environment::Dev.check_identifier(DEV_IDENTIFIER), Ok(()));
        // A hand check's own identifier (--config '{"identifier": …}') is dev too
        assert_eq!(
            Environment::Dev.check_identifier("com.budgetmint.desktop.handcheck"),
            Ok(())
        );
        assert!(Environment::Dev
            .check_identifier(PRODUCTION_IDENTIFIER)
            .unwrap_err()
            .contains("BUDGETMINT_ENV=production"));
    }

    #[test]
    fn the_tauri_configs_match() {
        let base = config(include_str!("../tauri.conf.json"));
        let production = config(include_str!("../tauri.production.conf.json"));
        let android = config(include_str!("../tauri.android.conf.json"));
        let scheme = |config: &Value| config["plugins"]["deep-link"]["desktop"]["schemes"].clone();

        assert_eq!(base["identifier"], DEV_IDENTIFIER);
        assert_eq!(base["productName"], "BudgetMint Dev");
        assert_eq!(scheme(&base), serde_json::json!([DEV_DEEP_LINK_SCHEME]));
        // A dev build has no update feed
        assert_eq!(
            base["plugins"]["updater"]["endpoints"],
            serde_json::json!([])
        );

        assert_eq!(production["identifier"], PRODUCTION_IDENTIFIER);
        assert_eq!(production["productName"], "BudgetMint");
        assert_eq!(
            scheme(&production),
            serde_json::json!([PRODUCTION_DEEP_LINK_SCHEME])
        );
        assert_eq!(
            production["plugins"]["updater"]["endpoints"],
            serde_json::json!([
                "https://github.com/BeardedUnicorn/BudgetMint/releases/latest/download/latest.json"
            ])
        );

        // Android's name and package are Gradle's, by BUDGETMINT_ENV
        // (gen/android/app/build.gradle.kts)
        assert_eq!(android["productName"], "BudgetMint");
        assert_eq!(android["identifier"], "com.budgetmint.android");
    }
}
