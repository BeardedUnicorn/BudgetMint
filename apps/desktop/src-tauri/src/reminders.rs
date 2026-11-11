//! Reminders, as the webview words them (packages/client hooks/useReminders),
//! shown at their times.
//!
//! - On a phone or tablet the system keeps them: each is set as an alarm
//!   (it fires with the app closed), and one no longer in the list is taken
//!   back.
//! - On a desktop the app times them itself, while it runs (closing the
//!   window keeps it in the tray): a thread waits for the next one
//!   (app.rs runs `tick` in a loop), and each is shown once.

use crate::platform::{Platform, ScheduledNotification};
use serde::Deserialize;
use std::collections::BTreeSet;
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// The longest the desktop's thread waits before looking again (the clock
/// may jump: sleep, a time change).
pub const MAX_WAIT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Core's stable 31-bit id: the same reminder always has it.
    pub id: u32,
    pub at_ms: i64,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Default)]
struct Waiting {
    list: Vec<Reminder>,
    /// Shown already (this run): not shown again when the list comes again.
    shown: BTreeSet<u32>,
}

#[derive(Debug, Default)]
pub struct Scheduler {
    waiting: Mutex<Waiting>,
    changed: Condvar,
}

impl Scheduler {
    /// The list, even if a thread panicked holding it (it's whole: every
    /// change to it is one assignment).
    fn lock(&self) -> MutexGuard<'_, Waiting> {
        self.waiting.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The reminders to show from now on, in place of the ones before.
    /// Returns the ids that were there and aren't any more.
    pub fn replace(&self, list: Vec<Reminder>) -> Vec<u32> {
        let mut waiting = self.lock();
        let gone = waiting
            .list
            .iter()
            .map(|reminder| reminder.id)
            .filter(|id| !list.iter().any(|reminder| reminder.id == *id))
            .collect();
        waiting.list = list;
        self.changed.notify_all();
        gone
    }

    /// The reminders due by `now_ms` not yet shown, taken as shown.
    pub fn take_due(&self, now_ms: i64) -> Vec<Reminder> {
        let mut waiting = self.lock();
        let due: Vec<Reminder> = waiting
            .list
            .iter()
            .filter(|reminder| reminder.at_ms <= now_ms)
            .filter(|reminder| !waiting.shown.contains(&reminder.id))
            .cloned()
            .collect();
        for reminder in &due {
            waiting.shown.insert(reminder.id);
        }
        due
    }

    /// How long until the next reminder not yet shown (MAX_WAIT at most).
    pub fn wait_for(&self, now_ms: i64) -> Duration {
        let waiting = self.lock();
        waiting
            .list
            .iter()
            .filter(|reminder| !waiting.shown.contains(&reminder.id))
            .map(|reminder| {
                Duration::from_millis(reminder.at_ms.saturating_sub(now_ms).max(0) as u64)
            })
            .min()
            .unwrap_or(MAX_WAIT)
            .min(MAX_WAIT)
    }

    /// Waits up to `timeout`, or until the list changes.
    pub fn sleep(&self, timeout: Duration) {
        let waiting = self.lock();
        let _ = self
            .changed
            .wait_timeout(waiting, timeout)
            .unwrap_or_else(PoisonError::into_inner);
    }
}

/// One turn of the desktop's thread: shows what's due, and says how long to
/// wait for the next.
pub fn tick(scheduler: &Scheduler, platform: &dyn Platform, now_ms: i64) -> Duration {
    for reminder in scheduler.take_due(now_ms) {
        if let Err(error) = platform.notify(&reminder.title, &reminder.body) {
            log::warn!("Failed to show a reminder: {}", error);
        }
    }
    scheduler.wait_for(now_ms)
}

/// schedule_reminders: the reminders from now on. A phone's go to the system.
pub fn schedule(
    scheduler: &Scheduler,
    platform: &dyn Platform,
    list: Vec<Reminder>,
) -> Result<(), String> {
    let gone = scheduler.replace(list.clone());
    if !platform.is_mobile() {
        return Ok(());
    }
    for id in gone {
        platform.cancel_notification(id as i32)?;
    }
    for reminder in list {
        platform.schedule_notification(&ScheduledNotification {
            id: reminder.id as i32,
            at_ms: reminder.at_ms,
            title: reminder.title,
            body: reminder.body,
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use std::sync::Arc;

    fn reminder(id: u32, at_ms: i64) -> Reminder {
        Reminder {
            id,
            at_ms,
            title: format!("Reminder {}", id),
            body: "Due".into(),
        }
    }

    #[test]
    fn a_desktop_shows_each_reminder_once_at_its_time() {
        let scheduler = Scheduler::default();
        let platform = FakePlatform::default();
        schedule(
            &scheduler,
            &platform,
            vec![reminder(1, 1_000), reminder(2, 5_000)],
        )
        .unwrap();
        // Before either: wait for the first
        assert_eq!(tick(&scheduler, &platform, 0), Duration::from_millis(1_000));
        // The first is due: shown, then wait for the second
        assert_eq!(
            tick(&scheduler, &platform, 1_500),
            Duration::from_millis(3_500)
        );
        assert_eq!(
            platform.recorded().notifications,
            vec![("Reminder 1".into(), "Due".into())]
        );
        // The same list again (the budget changed): not shown again
        schedule(
            &scheduler,
            &platform,
            vec![reminder(1, 1_000), reminder(2, 5_000)],
        )
        .unwrap();
        tick(&scheduler, &platform, 6_000);
        assert_eq!(platform.recorded().notifications.len(), 2);
        // Nothing left: look again in a minute
        assert_eq!(tick(&scheduler, &platform, 7_000), MAX_WAIT);
        // Far off: not more than a minute either
        schedule(&scheduler, &platform, vec![reminder(3, 10_000_000)]).unwrap();
        assert_eq!(tick(&scheduler, &platform, 7_000), MAX_WAIT);
        // The system schedules nothing on a desktop
        assert!(platform.recorded().scheduled.is_empty());
    }

    #[test]
    fn a_reminder_that_fails_to_show_is_logged() {
        let scheduler = Scheduler::default();
        let platform = FakePlatform::default();
        platform.fail("notify");
        schedule(&scheduler, &platform, vec![reminder(1, 0)]).unwrap();
        tick(&scheduler, &platform, 0);
        assert!(platform.recorded().notifications.is_empty());
    }

    #[test]
    fn a_phone_sets_them_with_the_system_and_takes_back_the_gone() {
        let scheduler = Scheduler::default();
        let platform = FakePlatform::mobile();
        schedule(
            &scheduler,
            &platform,
            vec![reminder(1, 1_000), reminder(2, 2_000)],
        )
        .unwrap();
        schedule(&scheduler, &platform, vec![reminder(2, 2_000)]).unwrap();
        let recorded = platform.recorded();
        assert_eq!(recorded.cancelled, vec![1]);
        assert_eq!(recorded.scheduled.len(), 3);
        assert_eq!(recorded.scheduled[2].at_ms, 2_000);
        platform.fail("schedule");
        assert!(schedule(&scheduler, &platform, vec![reminder(3, 1)]).is_err());
        platform.fail("cancel");
        assert!(schedule(&scheduler, &platform, vec![]).is_err());
    }

    #[test]
    fn its_thread_wakes_when_the_list_changes() {
        let scheduler = Arc::new(Scheduler::default());
        let waker = scheduler.clone();
        let started = std::time::Instant::now();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            waker.replace(vec![reminder(1, 0)]);
        });
        scheduler.sleep(Duration::from_secs(10));
        handle.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
