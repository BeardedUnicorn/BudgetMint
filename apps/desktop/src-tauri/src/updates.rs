// Adapted from TaskMint apps/desktop/src-tauri/src/updates.rs @ 1623bee.
//! Updates from BudgetMint's GitHub releases. The webview decides when to
//! check and asks the user before anything downloads; this installs the
//! update that check found and restarts into it, sending the download's
//! progress as it goes. The update feed, the signature check and the install
//! itself are the updater plugin's (platform/os.rs).

use crate::events::{emit_quiet, UPDATE_PROGRESS};
use crate::platform::DownloadEvent;
use crate::state::AppState;
use serde::Serialize;

/// How far a download of unknown size gets between progress events.
const UNKNOWN_SIZE_STEP: u64 = 512 * 1024;

/// UPDATE_PROGRESS's payload.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Bytes downloaded so far.
    pub downloaded: u64,
    /// The download's size, when the server says.
    pub total: Option<u64>,
    /// The download is done and the update is being installed.
    pub installing: bool,
}

/// The download's progress, sent once per whole percent (or per
/// UNKNOWN_SIZE_STEP of a download of unknown size) rather than once per
/// chunk, which would be thousands of events.
#[derive(Debug, Default)]
struct Reporter {
    downloaded: u64,
    total: Option<u64>,
    /// The step the last event was sent at.
    sent: Option<u64>,
}

impl Reporter {
    /// The event to send for `event`, if any.
    fn next(&mut self, event: DownloadEvent) -> Option<Progress> {
        match event {
            DownloadEvent::Chunk { bytes, total } => {
                self.downloaded += bytes;
                self.total = total.or(self.total);
                let step = match self.total {
                    Some(total) if total > 0 => self.downloaded.min(total) * 100 / total,
                    _ => self.downloaded / UNKNOWN_SIZE_STEP,
                };
                if self.sent == Some(step) {
                    return None;
                }
                self.sent = Some(step);
                Some(self.progress(false))
            }
            DownloadEvent::Downloaded => Some(self.progress(true)),
        }
    }

    fn progress(&self, installing: bool) -> Progress {
        Progress {
            downloaded: self.downloaded,
            total: self.total,
            installing,
        }
    }
}

/// Downloads and installs the update the last check found, then restarts
/// into it. Nothing is lost: the data is the cloud's.
pub fn install(state: &AppState) -> Result<(), String> {
    let mut reporter = Reporter::default();
    state.platform.install_update(&mut |event| {
        if let Some(progress) = reporter.next(event) {
            emit_quiet(state.platform.as_ref(), UPDATE_PROGRESS, progress);
        }
    })?;
    log::info!("Installed an update; restarting into it");
    state.platform.restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;
    use serde_json::{json, Value};

    fn chunk(bytes: u64, total: Option<u64>) -> DownloadEvent {
        DownloadEvent::Chunk { bytes, total }
    }

    fn progress_events(f: &crate::testing::Fixture) -> Vec<Value> {
        f.platform
            .recorded()
            .events
            .iter()
            .filter(|(name, _)| name == UPDATE_PROGRESS)
            .map(|(_, payload)| payload.clone())
            .collect()
    }

    #[test]
    fn it_installs_then_restarts_sending_progress_once_per_percent() {
        let f = fixture();
        // 1000 bytes in chunks of 4: 250 chunks, but 101 whole percents (0–100)
        let mut events = vec![chunk(4, Some(1000)); 250];
        events.push(DownloadEvent::Downloaded);
        f.platform.download_goes(events);

        assert_eq!(install(&f.state), Ok(()));

        let sent = progress_events(&f);
        assert_eq!(sent.len(), 101 + 1);
        assert_eq!(
            sent[0],
            json!({ "downloaded": 4, "total": 1000, "installing": false })
        );
        assert_eq!(
            sent[100],
            json!({ "downloaded": 1000, "total": 1000, "installing": false })
        );
        assert_eq!(
            sent[101],
            json!({ "downloaded": 1000, "total": 1000, "installing": true })
        );
        let recorded = f.platform.recorded();
        assert_eq!(recorded.updates_installed, 1);
        assert_eq!(recorded.restarts, 1);
    }

    #[test]
    fn a_download_of_unknown_size_is_reported_every_half_megabyte() {
        let f = fixture();
        let kb = 1024;
        f.platform.download_goes(vec![
            chunk(100 * kb, None),
            chunk(300 * kb, None),
            chunk(200 * kb, None),
            chunk(200 * kb, Some(0)),
            DownloadEvent::Downloaded,
        ]);

        install(&f.state).unwrap();

        // 100 KB (step 0), 600 KB (step 1), then the end
        let downloaded: Vec<_> = progress_events(&f)
            .iter()
            .map(|p| (p["downloaded"].clone(), p["installing"].clone()))
            .collect();
        assert_eq!(
            downloaded,
            [
                (json!(100 * kb), json!(false)),
                (json!(600 * kb), json!(false)),
                (json!(800 * kb), json!(true)),
            ]
        );
    }

    #[test]
    fn a_size_seen_once_is_kept_and_more_than_it_counts_as_done() {
        let mut reporter = Reporter::default();
        assert_eq!(
            reporter.next(chunk(50, Some(100))).map(|p| p.total),
            Some(Some(100))
        );
        assert_eq!(reporter.next(chunk(0, None)), None);
        // A server that sent more than it said stops at 100%
        assert_eq!(
            reporter.next(chunk(80, None)),
            Some(Progress {
                downloaded: 130,
                total: Some(100),
                installing: false
            })
        );
        assert_eq!(reporter.next(chunk(10, None)), None);
    }

    #[test]
    fn a_failed_install_reports_why_and_doesnt_restart() {
        let f = fixture();
        f.platform
            .download_goes(vec![chunk(10, Some(10)), DownloadEvent::Downloaded]);
        f.platform.fail("install_update");

        assert_eq!(install(&f.state), Err("install_update failed".to_string()));

        assert_eq!(progress_events(&f).len(), 2);
        assert_eq!(f.platform.recorded().restarts, 0);
    }
}
