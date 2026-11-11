/**
 * The Firebase app for the desktop and phone apps (both run the same
 * webview code), in TaskMint's project taskmint-f9a05: BudgetMint signs in
 * to the same accounts. These values only name the project; TaskMint's
 * firebase/firestore.rules (pinned in firebase/) keep each user's data
 * their own.
 *
 * Until BudgetMint has its own web app registered in the project, this is
 * TaskMint desktop's: Auth and Firestore don't tell them apart, only the
 * console's per-app figures do.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';
import type { GoogleDesktopClient } from './tauriShell';

export const DESKTOP_FIREBASE: CloudConfig['firebase'] = {
  apiKey: 'AIzaSyCOyTKQkIpE8WkRx-PDqFx53ROCN_TkSz8',
  authDomain: 'taskmint-f9a05.firebaseapp.com',
  projectId: 'taskmint-f9a05',
  storageBucket: 'taskmint-f9a05.firebasestorage.app',
  messagingSenderId: '695801278605',
  appId: '1:695801278605:web:4d1a2fba9e5b026168b2c4',
};

/**
 * BudgetMint's "Desktop app" OAuth client for Google sign-in (Google Cloud
 * console → Credentials, "BudgetMint desktop"), from the build's
 * environment: repo secrets in CI, the repo-root .env locally. Without one,
 * the desktop signs in by email only, and a development build says so.
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
    cache: 'single',
    popupSignIn: false,
    ...(emulatorHost ? { emulatorHost } : {}),
  };
}
