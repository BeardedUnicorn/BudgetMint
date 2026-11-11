/**
 * The Firebase apps for the desktop and phone apps (both run the same
 * webview code). "BudgetMint desktop", in BudgetMint's project budgetmint,
 * holds the accounts and data. TaskMint's project taskmint-f9a05 is signed
 * in to alongside for TaskMint's forecast, as TaskMint desktop's app (Auth
 * and Firestore don't tell apps apart, only the console's per-app figures
 * do). These values only name the projects; each project's rules keep each
 * user's data their own.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';
import type { GoogleDesktopClient } from './tauriShell';

export const DESKTOP_FIREBASE: CloudConfig['firebase'] = {
  apiKey: 'AIzaSyCiHOTXw-OsPtGQhprCogLla-hg3w85-yk',
  authDomain: 'budgetmint.firebaseapp.com',
  projectId: 'budgetmint',
  storageBucket: 'budgetmint.firebasestorage.app',
  messagingSenderId: '554414035346',
  appId: '1:554414035346:web:edd606330a2a3935e9b14b',
};

export const TASKMINT_DESKTOP_FIREBASE: CloudConfig['taskmint'] = {
  apiKey: 'AIzaSyCOyTKQkIpE8WkRx-PDqFx53ROCN_TkSz8',
  authDomain: 'taskmint-f9a05.firebaseapp.com',
  projectId: 'taskmint-f9a05',
  storageBucket: 'taskmint-f9a05.firebasestorage.app',
  messagingSenderId: '695801278605',
  appId: '1:695801278605:web:4d1a2fba9e5b026168b2c4',
};

/**
 * BudgetMint's "Desktop app" OAuth client for Google sign-in (Google Cloud
 * console → Credentials, "BudgetMint desktop", in taskmint-f9a05; both
 * projects' Google sign-in accept it), from the build's environment: repo
 * secrets in CI, the repo-root .env locally. Without one, the desktop signs
 * in by email only, and a development build says so.
 */
export function googleDesktopClient(env: {
  DEV?: boolean;
  VITE_GOOGLE_DESKTOP_CLIENT_ID?: string;
  VITE_GOOGLE_DESKTOP_CLIENT_SECRET?: string;
}): GoogleDesktopClient | undefined {
  const { VITE_GOOGLE_DESKTOP_CLIENT_ID: clientId, VITE_GOOGLE_DESKTOP_CLIENT_SECRET: clientSecret } = env;
  if (clientId && clientSecret) return { clientId, clientSecret };
  if (env.DEV) {
    console.warn(
      'Google sign-in is off in this build: set VITE_GOOGLE_DESKTOP_CLIENT_ID and VITE_GOOGLE_DESKTOP_CLIENT_SECRET in the repo-root .env (see .env.example).'
    );
  }
  return undefined;
}

/**
 * Firestore keeps its cache in the app's own webview storage (one window,
 * so one tab), and the webview can't open Google's sign-in popup. A
 * development build with VITE_FIREBASE_EMULATOR_HOST set (127.0.0.1, or
 * 10.0.2.2 from the Android emulator) uses the Auth and Firestore emulators.
 */
export function desktopCloud(env: { DEV: boolean; VITE_FIREBASE_EMULATOR_HOST?: string }): CloudConfig {
  const emulatorHost = env.DEV ? env.VITE_FIREBASE_EMULATOR_HOST : undefined;
  return {
    firebase: DESKTOP_FIREBASE,
    taskmint: TASKMINT_DESKTOP_FIREBASE,
    cache: 'single',
    popupSignIn: false,
    ...(emulatorHost ? { emulatorHost } : {}),
  };
}
