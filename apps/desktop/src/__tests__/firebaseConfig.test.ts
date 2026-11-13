// Adapted from TaskMint apps/desktop/src/__tests__/firebaseConfig.test.ts @ 1623bee.
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_FIREBASE, desktopCloud, googleDesktopClient, TASKMINT_DESKTOP_FIREBASE } from '../firebaseConfig';

describe("the desktop's cloud sync", () => {
  it("is the desktop web apps', with its own cache and no popups", () => {
    expect(desktopCloud({ DEV: false, BUDGETMINT_ENV: 'production' })).toEqual({
      firebase: DESKTOP_FIREBASE.production,
      taskmint: TASKMINT_DESKTOP_FIREBASE.production,
      cache: 'single',
      popupSignIn: false,
    });
    // BudgetMint's own project, and TaskMint's for the forecast
    expect(DESKTOP_FIREBASE.production.projectId).toBe('budgetmint');
    expect(TASKMINT_DESKTOP_FIREBASE.production.projectId).toBe('taskmint-f9a05');
  });

  it("is the dev projects' pair in every build but a release", () => {
    const dev = desktopCloud({ DEV: false, BUDGETMINT_ENV: 'dev' });
    expect(dev.firebase).toBe(DESKTOP_FIREBASE.dev);
    expect(dev.taskmint).toBe(TASKMINT_DESKTOP_FIREBASE.dev);
    expect(DESKTOP_FIREBASE.dev).toMatchObject({
      projectId: 'budgetmint-dev',
      appId: '1:598380315327:web:9ac57f0abe9f602fb73c0a',
    });
    expect(TASKMINT_DESKTOP_FIREBASE.dev).toMatchObject({
      projectId: 'taskmint-dev',
      appId: '1:888820927672:web:4f388531663a69a5a9b84d',
    });
  });

  it('uses the emulators on the host a development build names, and only a development build', () => {
    expect(
      desktopCloud({ DEV: true, BUDGETMINT_ENV: 'dev', VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2' }).emulatorHost
    ).toBe('10.0.2.2');
    expect(desktopCloud({ DEV: true, BUDGETMINT_ENV: 'dev' }).emulatorHost).toBeUndefined();
    expect(
      desktopCloud({ DEV: false, BUDGETMINT_ENV: 'dev', VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2' }).emulatorHost
    ).toBeUndefined();
  });

  it('signs in with Google only when the build names both halves of its client', () => {
    expect(
      googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id', VITE_GOOGLE_DESKTOP_CLIENT_SECRET: 'secret' })
    ).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id' })).toBeUndefined();
    expect(googleDesktopClient({ VITE_GOOGLE_DESKTOP_CLIENT_SECRET: 'secret' })).toBeUndefined();
  });

  it('says in a development build that Google sign-in is off without a client, and not in a release', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    googleDesktopClient({ DEV: false });
    expect(warn).not.toHaveBeenCalled();
    googleDesktopClient({ DEV: true, VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Google sign-in is off in this build'));
    warn.mockClear();
    googleDesktopClient({
      DEV: true,
      VITE_GOOGLE_DESKTOP_CLIENT_ID: 'id',
      VITE_GOOGLE_DESKTOP_CLIENT_SECRET: 'secret',
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
