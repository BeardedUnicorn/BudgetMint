// Adapted from TaskMint apps/web/src/__tests__/analytics.test.ts @ ce9f22f.
import { describe, expect, it, vi } from 'vitest';
import { createWebAnalytics, webAnalytics } from '../analytics';
import { webCloud } from '../firebaseConfig';

function sdk(supported = true) {
  return {
    isSupported: vi.fn(async () => supported),
    initializeAnalytics: vi.fn(() => 'analytics'),
    setAnalyticsCollectionEnabled: vi.fn(),
    logEvent: vi.fn(),
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('web analytics', () => {
  it('never start while turned off, then count each page and follow the choice', async () => {
    const analytics = sdk();
    const load = vi.fn(async () => [analytics, { getApp: () => 'app' }] as never);
    const web = createWebAnalytics(load);

    web.setEnabled(false);
    web.screen('overview');
    await settle();
    expect(load).not.toHaveBeenCalled();

    web.setEnabled(true);
    await settle();
    expect(analytics.initializeAnalytics).toHaveBeenCalledWith('app', {
      config: { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false },
    });
    expect(analytics.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith('analytics', true);
    web.screen('forecast');
    await settle();
    expect(analytics.logEvent).toHaveBeenCalledWith('analytics', 'screen_view', {
      firebase_screen: 'forecast',
      firebase_screen_class: 'BudgetMint',
    });
    web.setEnabled(false);
    await settle();
    expect(analytics.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith('analytics', false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('do nothing where the browser has no analytics', async () => {
    const analytics = sdk(false);
    const web = createWebAnalytics(async () => [analytics, { getApp: () => 'app' }] as never);
    web.setEnabled(true);
    web.screen('forecast');
    await settle();
    expect(analytics.initializeAnalytics).not.toHaveBeenCalled();
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it("load Firebase's SDK by default", async () => {
    const web = createWebAnalytics();
    web.setEnabled(true);
    // jsdom has no IndexedDB, so the SDK says analytics aren't supported
    await settle();
    web.screen('forecast');
  });

  it('come only with a Google Analytics stream, and never on the emulators', () => {
    const cloud = webCloud({ DEV: false, BUDGETMINT_ENV: 'production' });
    const withStream = { ...cloud, firebase: { ...cloud.firebase, measurementId: 'G-TEST' } };
    expect(webAnalytics(withStream)).toBeDefined();
    expect(webAnalytics({ ...withStream, emulatorHost: 'localhost' })).toBeUndefined();
    expect(webAnalytics({ ...cloud, firebase: { ...cloud.firebase, measurementId: undefined } })).toBeUndefined();
    // The dev project has no stream, so a dev build counts nothing
    expect(webAnalytics(webCloud({ DEV: false, BUDGETMINT_ENV: 'dev' }))).toBeUndefined();
  });
});
