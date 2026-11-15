// Adapted from TaskMint packages/client/src/hooks/useUpdatedNotice.ts @ a2b0156.
import { useEffect } from 'react';
import { useAppDialogs } from '../contexts/AppDialogsContext';
import { useNotification } from '../contexts/NotificationContext';
import { readLocal, writeLocal } from '../utils/localStore';
import { APP_VERSION, compareVersions, isVersion } from '../utils/appVersion';
import { hasUserFacingChanges, RELEASES, releasesSince } from '../utils/changelog';

/** The version this browser or webview last ran. */
export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion';
/** The version the last update came from: About BudgetMint shows what's new since it. */
export const UPDATED_FROM_VERSION_KEY = 'updatedFromVersion';

/**
 * The releases an update from `from` to this version brought that changed
 * something to see, newest first: none when `from` isn't an older version.
 */
export function releasesSinceUpdate(from: unknown) {
  return isVersion(from) ? releasesSince(RELEASES, from, APP_VERSION).filter(hasUserFacingChanges) : [];
}

/**
 * Once per update: a toast that opens About BudgetMint, which shows what's
 * new (every release since the version before, when the update skipped
 * some). The first version a device runs, and a version older than the last
 * one seen (a dev build, a downgrade), are noted without one.
 */
export function useUpdatedNotice(): void {
  const { notify } = useNotification();
  const dialogs = useAppDialogs();
  useEffect(() => {
    const seen = readLocal<unknown>(LAST_SEEN_VERSION_KEY, null);
    if (seen === APP_VERSION) return;
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, APP_VERSION, null);
    if (!isVersion(seen) || compareVersions(APP_VERSION, seen) < 0) return;
    writeLocal<unknown>(UPDATED_FROM_VERSION_KEY, seen, null);
    const several = releasesSinceUpdate(seen).length > 1;
    notify(several ? `See what’s new since ${seen}.` : 'See what’s new in this version.', {
      title: `Updated to BudgetMint ${APP_VERSION}`,
      severity: 'info',
      actions: [{ label: 'What’s new', onClick: () => dialogs.open('about') }],
    });
    // (Running again does nothing: the version is stored by then)
  }, [notify, dialogs]);
}
