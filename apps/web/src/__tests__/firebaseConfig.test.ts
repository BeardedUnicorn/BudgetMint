import { describe, expect, it } from 'vitest';
import { TASKMINT_WEB_FIREBASE, WEB_FIREBASE, webCloud } from '../firebaseConfig';

describe("the web app's cloud", () => {
  it('keeps a cache the tabs share, and signs in with Google in a popup', () => {
    expect(webCloud({ DEV: false })).toEqual({
      firebase: WEB_FIREBASE,
      taskmint: TASKMINT_WEB_FIREBASE,
      cache: 'tabs',
      popupSignIn: true,
    });
  });

  it('is BudgetMint’s own project, and TaskMint’s for the forecast', () => {
    expect(WEB_FIREBASE.projectId).toBe('budgetmint');
    expect(TASKMINT_WEB_FIREBASE.projectId).toBe('taskmint-f9a05');
  });

  it('uses the emulators on the host a development build names, and only a development build', () => {
    expect(webCloud({ DEV: true, VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' }).emulatorHost).toBe('127.0.0.1');
    expect(webCloud({ DEV: true }).emulatorHost).toBeUndefined();
    expect(webCloud({ DEV: false, VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' }).emulatorHost).toBeUndefined();
  });
});
