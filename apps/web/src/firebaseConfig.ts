/**
 * The web app's Firebase app, in TaskMint's project taskmint-f9a05:
 * BudgetMint signs in to the same accounts. These values only name the
 * project; TaskMint's firebase/firestore.rules (pinned in firebase/) keep
 * each user's data their own.
 *
 * Until BudgetMint has its own web app and Hosting site registered in the
 * project, this is TaskMint web's: Auth and Firestore don't tell them apart,
 * only the console's per-app figures do.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';

export const WEB_FIREBASE: CloudConfig['firebase'] = {
  apiKey: 'AIzaSyCOyTKQkIpE8WkRx-PDqFx53ROCN_TkSz8',
  authDomain: 'taskmint-f9a05.firebaseapp.com',
  projectId: 'taskmint-f9a05',
  storageBucket: 'taskmint-f9a05.firebasestorage.app',
  messagingSenderId: '695801278605',
  appId: '1:695801278605:web:b6fd0dd1b5b9590e68b2c4',
};

/**
 * Firestore's cache is shared by the browser's tabs and kept across reloads;
 * Google sign-in opens in a popup. A development build with
 * VITE_FIREBASE_EMULATOR_HOST set uses the Auth and Firestore emulators.
 */
export function webCloud(env: { DEV: boolean; VITE_FIREBASE_EMULATOR_HOST?: string }): CloudConfig {
  const emulatorHost = env.DEV ? env.VITE_FIREBASE_EMULATOR_HOST : undefined;
  return {
    firebase: WEB_FIREBASE,
    cache: 'tabs',
    popupSignIn: true,
    ...(emulatorHost ? { emulatorHost } : {}),
  };
}
