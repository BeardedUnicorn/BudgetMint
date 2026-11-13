/**
 * The web app's Firebase apps, in each environment's pair of projects
 * (scripts/environment.mjs): production's for a release, dev's for every
 * other build. "BudgetMint web", in BudgetMint's project (budgetmint, or
 * budgetmint-dev), holds the accounts and data. TaskMint's project
 * (taskmint-f9a05, or taskmint-dev) is signed in to alongside for TaskMint's
 * forecast, as TaskMint web's app (Auth and Firestore don't tell apps apart,
 * only the console's per-app figures do). These values only name the
 * projects; each project's rules keep each user's data their own. Dev has no
 * Analytics.
 */

import type { CloudConfig } from '@budgetmint/client/cloud';

type Environment = ImportMetaEnv['BUDGETMINT_ENV'];

export const WEB_FIREBASE: Record<Environment, CloudConfig['firebase']> = {
  production: {
    apiKey: 'AIzaSyCiHOTXw-OsPtGQhprCogLla-hg3w85-yk',
    authDomain: 'budgetmint.firebaseapp.com',
    projectId: 'budgetmint',
    storageBucket: 'budgetmint.firebasestorage.app',
    messagingSenderId: '554414035346',
    appId: '1:554414035346:web:5c5e0ccc1ae069f0e9b14b',
    // Its Google Analytics stream: usage analytics (analytics.ts)
    measurementId: 'G-D5MP3TWGFK',
  },
  dev: {
    apiKey: 'AIzaSyAfm6ZfbW1Wg0l8fG9RXb4f9Vvo6uFBURI',
    authDomain: 'budgetmint-dev.firebaseapp.com',
    projectId: 'budgetmint-dev',
    storageBucket: 'budgetmint-dev.firebasestorage.app',
    messagingSenderId: '598380315327',
    appId: '1:598380315327:web:40c1284ed0be3ed0b73c0a',
  },
};

export const TASKMINT_WEB_FIREBASE: Record<Environment, CloudConfig['taskmint']> = {
  production: {
    apiKey: 'AIzaSyCOyTKQkIpE8WkRx-PDqFx53ROCN_TkSz8',
    authDomain: 'taskmint-f9a05.firebaseapp.com',
    projectId: 'taskmint-f9a05',
    storageBucket: 'taskmint-f9a05.firebasestorage.app',
    messagingSenderId: '695801278605',
    appId: '1:695801278605:web:b6fd0dd1b5b9590e68b2c4',
  },
  dev: {
    apiKey: 'AIzaSyAyB_tJga9LPTPbbuj_CMP8i0TT9enphwk',
    authDomain: 'taskmint-dev.firebaseapp.com',
    projectId: 'taskmint-dev',
    storageBucket: 'taskmint-dev.firebasestorage.app',
    messagingSenderId: '888820927672',
    appId: '1:888820927672:web:865a7d8ce31f9745a9b84d',
  },
};

/**
 * Firestore's cache is shared by the browser's tabs and kept across reloads;
 * Google sign-in opens in a popup. A development build with
 * VITE_FIREBASE_EMULATOR_HOST set uses the Auth and Firestore emulators.
 */
export function webCloud(env: {
  DEV: boolean;
  BUDGETMINT_ENV: Environment;
  VITE_FIREBASE_EMULATOR_HOST?: string;
}): CloudConfig {
  const emulatorHost = env.DEV ? env.VITE_FIREBASE_EMULATOR_HOST : undefined;
  return {
    firebase: WEB_FIREBASE[env.BUDGETMINT_ENV],
    taskmint: TASKMINT_WEB_FIREBASE[env.BUDGETMINT_ENV],
    cache: 'tabs',
    popupSignIn: true,
    ...(emulatorHost ? { emulatorHost } : {}),
  };
}
