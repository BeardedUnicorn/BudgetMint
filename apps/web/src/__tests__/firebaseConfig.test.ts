import { describe, expect, it } from 'vitest';
import { TASKMINT_WEB_FIREBASE, WEB_FIREBASE, webCloud } from '../firebaseConfig';

describe("the web app's cloud", () => {
  it('keeps a cache the tabs share, and signs in with Google in a popup', () => {
    expect(webCloud({ DEV: false, BUDGETMINT_ENV: 'production' })).toEqual({
      firebase: WEB_FIREBASE.production,
      taskmint: TASKMINT_WEB_FIREBASE.production,
      cache: 'tabs',
      popupSignIn: true,
    });
  });

  it('is the build’s pair of projects: BudgetMint’s own, and TaskMint’s for the forecast', () => {
    expect(WEB_FIREBASE.production.projectId).toBe('budgetmint');
    expect(TASKMINT_WEB_FIREBASE.production.projectId).toBe('taskmint-f9a05');
    const dev = webCloud({ DEV: false, BUDGETMINT_ENV: 'dev' });
    expect(dev.firebase).toBe(WEB_FIREBASE.dev);
    expect(dev.taskmint).toBe(TASKMINT_WEB_FIREBASE.dev);
    expect(WEB_FIREBASE.dev).toMatchObject({
      projectId: 'budgetmint-dev',
      authDomain: 'budgetmint-dev.firebaseapp.com',
      appId: '1:598380315327:web:40c1284ed0be3ed0b73c0a',
    });
    expect(TASKMINT_WEB_FIREBASE.dev).toMatchObject({
      projectId: 'taskmint-dev',
      appId: '1:888820927672:web:865a7d8ce31f9745a9b84d',
    });
  });

  it('counts usage in production only: dev has no Analytics', () => {
    expect(WEB_FIREBASE.production.measurementId).toBe('G-D5MP3TWGFK');
    expect(WEB_FIREBASE.dev.measurementId).toBeUndefined();
  });

  it('uses the emulators on the host a development build names, and only a development build', () => {
    expect(webCloud({ DEV: true, BUDGETMINT_ENV: 'dev', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' }).emulatorHost).toBe(
      '127.0.0.1'
    );
    expect(webCloud({ DEV: true, BUDGETMINT_ENV: 'dev' }).emulatorHost).toBeUndefined();
    expect(
      webCloud({ DEV: false, BUDGETMINT_ENV: 'dev', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' }).emulatorHost
    ).toBeUndefined();
  });
});
