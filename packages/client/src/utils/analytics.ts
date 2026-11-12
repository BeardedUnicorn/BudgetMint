// Adapted from TaskMint packages/client/src/utils/analytics.ts @ ce9f22f.
/**
 * Usage analytics (Firebase Analytics), where the shell has them: the web
 * app and the Android app; the desktop has none. What goes is which pages
 * are opened, by name, never bills, amounts, balances or anything else of
 * the budget. Settings → Privacy turns it off for this device.
 */

import { useEffect } from 'react';
import { useNavigation } from '../contexts/NavigationContext';
import { getShell } from '../shell';
import { readLocal, writeLocal } from './localStore';

/** Whether this device shares usage statistics: on until turned off. */
export const ANALYTICS_ON_KEY = 'analyticsOn';

export function isAnalyticsEnabled(): boolean {
  return readLocal(ANALYTICS_ON_KEY, true);
}

/** Saves the choice and applies it at once. */
export function setAnalyticsEnabled(enabled: boolean): void {
  writeLocal(ANALYTICS_ON_KEY, enabled, true);
  getShell().platform.analytics?.setEnabled(enabled);
}

/** The shell's analytics follow the saved choice, and each page opened is a screen view. */
export function useAnalyticsScreens(): void {
  const { view } = useNavigation();
  useEffect(() => {
    getShell().platform.analytics?.setEnabled(isAnalyticsEnabled());
  }, []);
  useEffect(() => {
    if (isAnalyticsEnabled()) getShell().platform.analytics?.screen(view);
  }, [view]);
}
