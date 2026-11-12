// Adapted from TaskMint apps/web/src/analytics.ts @ ce9f22f.
/**
 * Firebase Analytics in the browser: which pages are opened, and nothing
 * else (utils/analytics in the client decides when). Google's tag only
 * loads once analytics is on, so a page whose user turned it off never
 * starts it.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';
import type { AnalyticsPlatform } from '@budgetmint/client/shell';

type Sdk = typeof import('firebase/analytics');
type Started = { sdk: Sdk; analytics: ReturnType<Sdk['initializeAnalytics']> } | null;

const loadSdk = () => Promise.all([import('firebase/analytics'), import('firebase/app')]);

export function createWebAnalytics(
  load: () => Promise<[Sdk, { getApp(): never }]> = loadSdk as never
): AnalyticsPlatform {
  let ready: Promise<Started> | null = null;
  // The Firebase app is budgetmint's, the one the store opened as the default
  const start = () =>
    (ready ??= load().then(async ([sdk, app]) =>
      (await sdk.isSupported())
        ? { sdk, analytics: sdk.initializeAnalytics(app.getApp(), { config: { send_page_view: false } }) }
        : null
    ));
  return {
    setEnabled(enabled) {
      if (!enabled && !ready) return;
      void start().then(started => started?.sdk.setAnalyticsCollectionEnabled(started.analytics, enabled));
    },
    screen(name) {
      void ready?.then(started =>
        started?.sdk.logEvent(started.analytics, 'screen_view', {
          firebase_screen: name,
          firebase_screen_class: 'BudgetMint',
        })
      );
    },
  };
}

/**
 * The web app's analytics, when its Firebase app has a Google Analytics
 * stream (a measurementId) and the build isn't on the emulators, whose app
 * isn't the default one and shouldn't count.
 */
export function webAnalytics(cloud: CloudConfig): AnalyticsPlatform | undefined {
  return cloud.firebase.measurementId && !cloud.emulatorHost ? createWebAnalytics() : undefined;
}
