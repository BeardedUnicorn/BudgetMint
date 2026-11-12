/**
 * The web app's Firebase apps. "BudgetMint web", in BudgetMint's project
 * budgetmint, holds the accounts and data. TaskMint's project taskmint-f9a05
 * is signed in to alongside for TaskMint's forecast, as TaskMint web's app
 * (Auth and Firestore don't tell apps apart, only the console's per-app
 * figures do). These values only name the projects; each project's rules
 * keep each user's data their own.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';

export const WEB_FIREBASE: CloudConfig['firebase'] = {
  apiKey: 'AIzaSyCiHOTXw-OsPtGQhprCogLla-hg3w85-yk',
  authDomain: 'budgetmint.firebaseapp.com',
  projectId: 'budgetmint',
  storageBucket: 'budgetmint.firebasestorage.app',
  messagingSenderId: '554414035346',
  appId: '1:554414035346:web:5c5e0ccc1ae069f0e9b14b',
  // Its Google Analytics stream: usage analytics (analytics.ts)
  measurementId: 'G-D5MP3TWGFK',
};

export const TASKMINT_WEB_FIREBASE: CloudConfig['taskmint'] = {
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
    taskmint: TASKMINT_WEB_FIREBASE,
    cache: 'tabs',
    popupSignIn: true,
    ...(emulatorHost ? { emulatorHost } : {}),
  };
}
