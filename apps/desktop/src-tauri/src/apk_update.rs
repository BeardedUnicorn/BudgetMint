// Adapted from TaskMint apps/desktop/src-tauri/src/apk_update.rs @ 94318ec.
//! A phone's updates. The Android app isn't in a store, so it reads the same
//! release feed as a desktop's updater (latest.json). For a newer version
//! the app downloads that release's APK and hands it to Android's installer
//! (AppUpdate.kt), which asks first; where that fails, the browser downloads
//! it instead. The decisions are here; fetching the feed and opening the
//! browser are platform/os.rs's.

use crate::platform::AvailableUpdate;
use serde::Deserialize;

/// BudgetMint's releases on GitHub.
const RELEASES_URL: &str = "https://github.com/BeardedUnicorn/BudgetMint/releases";

/// The parts of latest.json a phone reads.
#[derive(Debug, Deserialize)]
struct Feed {
    version: String,
    notes: Option<String>,
    changelog: Option<String>,
    pub_date: Option<String>,
}

/// A version's numbers ("2.8.0", or "v2.8.0"); None for anything else.
fn numbers(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let found = (next()?, next()?, next()?);
    parts.next().is_none().then_some(found)
}

/// The release the feed announces, if it's newer than `current`.
pub fn newer(feed: &str, current: &str) -> Result<Option<AvailableUpdate>, String> {
    let feed: Feed = serde_json::from_str(feed)
        .map_err(|error| format!("the release feed couldn't be read ({})", error))?;
    let latest = numbers(&feed.version).ok_or_else(|| {
        format!(
            "the release feed names no version BudgetMint knows ({})",
            feed.version
        )
    })?;
    let running =
        numbers(current).ok_or_else(|| format!("this version ({}) can't be compared", current))?;
    let version = feed.version.trim_start_matches('v').to_string();
    Ok((latest > running).then(|| AvailableUpdate {
        version,
        current_version: current.to_string(),
        notes: feed.notes,
        changelog: feed.changelog,
        date: feed.pub_date,
    }))
}

/// Where a release's APK downloads from (scripts/release/lib.mjs names it,
/// and AppUpdate.kt downloads the same file).
pub fn download_url(version: &str) -> String {
    format!(
        "{}/download/v{}/BudgetMint-{}-android-arm64.apk",
        RELEASES_URL, version, version
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn feed(version: &str) -> String {
        json!({
            "version": version,
            "notes": "### Added\n- Goals",
            "changelog": "## 2.9.0\n\n### Added\n- Goals\n\n## 2.8.1\n\n- A fix",
            "pub_date": "2026-11-20T10:00:00Z",
            "platforms": { "darwin-aarch64": { "url": "x", "signature": "y" } }
        })
        .to_string()
    }

    #[test]
    fn a_newer_release_is_announced_with_its_notes() {
        assert_eq!(
            newer(&feed("2.9.0"), "2.8.0"),
            Ok(Some(AvailableUpdate {
                version: "2.9.0".to_string(),
                current_version: "2.8.0".to_string(),
                notes: Some("### Added\n- Goals".to_string()),
                changelog: Some(
                    "## 2.9.0\n\n### Added\n- Goals\n\n## 2.8.1\n\n- A fix".to_string()
                ),
                date: Some("2026-11-20T10:00:00Z".to_string()),
            }))
        );
        // A tag-style version, and a newer major with smaller minor numbers
        assert_eq!(
            newer(&feed("v2.8.1"), "2.8.0").unwrap().unwrap().version,
            "2.8.1"
        );
        assert!(newer(&feed("3.0.0"), "2.12.3").unwrap().is_some());
    }

    #[test]
    fn the_same_or_an_older_release_is_nothing_to_do() {
        assert_eq!(newer(&feed("2.8.0"), "2.8.0"), Ok(None));
        assert_eq!(newer(&feed("2.7.9"), "2.8.0"), Ok(None));
        // Notes and a date are optional
        assert_eq!(newer(r#"{"version":"2.8.0"}"#, "2.8.0"), Ok(None));
    }

    #[test]
    fn a_feed_from_before_the_changelog_still_announces_its_release() {
        let update = newer(r#"{"version":"2.9.0","notes":"- A fix"}"#, "2.8.0")
            .unwrap()
            .unwrap();
        assert_eq!(update.notes.as_deref(), Some("- A fix"));
        assert_eq!(update.changelog, None);
        assert_eq!(update.date, None);
    }

    #[test]
    fn a_feed_or_version_it_cant_read_is_an_error() {
        assert!(newer("not json", "2.8.0")
            .unwrap_err()
            .starts_with("the release feed couldn't be read"));
        assert_eq!(
            newer(&feed("2.9"), "2.8.0"),
            Err("the release feed names no version BudgetMint knows (2.9)".to_string())
        );
        assert!(newer(&feed("2.9.0.1"), "2.8.0").is_err());
        assert!(newer(&feed("2.x.0"), "2.8.0").is_err());
        assert_eq!(
            newer(&feed("2.9.0"), "dev"),
            Err("this version (dev) can't be compared".to_string())
        );
    }

    #[test]
    fn the_apk_downloads_from_its_release() {
        assert_eq!(
            download_url("2.9.0"),
            "https://github.com/BeardedUnicorn/BudgetMint/releases/download/v2.9.0/BudgetMint-2.9.0-android-arm64.apk"
        );
    }

    /// Android's own download (AppUpdate.kt) can't call download_url, so it
    /// spells the address out again: the two have to stay the same file.
    #[test]
    fn the_app_downloads_the_same_apk_the_browser_would() {
        let kotlin =
            include_str!("../gen/android/app/src/main/java/com/budgetmint/android/AppUpdate.kt");
        let address = kotlin
            .lines()
            .find_map(|line| line.trim().strip_prefix("private const val RELEASES = "))
            .expect("AppUpdate.kt names where releases download from")
            .trim_matches('"');
        assert!(kotlin.contains("\"$RELEASES/v$version/BudgetMint-$version-android-arm64.apk\""));
        assert_eq!(
            format!("{address}/v2.9.0/BudgetMint-2.9.0-android-arm64.apk"),
            download_url("2.9.0")
        );
    }
}
