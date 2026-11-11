// Adapted from TaskMint apps/desktop/src/__tests__/firebaseConfig.test.ts @ 1623bee.
import { describe, expect, it } from 'vitest';
import { DESKTOP_FIREBASE, desktopCloud, googleDesktopClient } from '../firebaseConfig';

describe("the desktop's cloud sync", () => {
  it("is the desktop web app's, with its own cache and no popups", () => {
    expect(desktopCloud({ DEV: false })).toEqual({
      firebase: DESKTOP_FIREBASE,
      cache: 'single',
      popupSignIn: false,
    });
    expect(DESKTOP_FIREBASE.projectId).toBe('taskmint-f9a05');
  });

  it('uses the emulators on the host a development build names, and only a development build', () => {
    expect(desktopCloud({ DEV: true, VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2' }).emulatorHost).toBe('10.0.2.2');
    expect(desktopCloud({ DEV: true }).emulatorHost).toBeUndefined();
    expect(desktopCloud({ DEV: false, VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2' }).emulatorHost).toBeUndefined();
  });

  it('signs in with Google only when the build names both halves of its client', () => {
    expect(
      googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id', VITE_GOOGLE_DESKTOP_CLIENT_SECRET: 'secret' })
    ).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id' })).toBeUndefined();
    expect(googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_SECRET: 'secret' })).toBeUndefined();
  });
});
