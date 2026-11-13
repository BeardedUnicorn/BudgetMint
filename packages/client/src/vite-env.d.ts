/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The pair of Firebase projects the build talks to: "production" for a
   * release, "dev" for every other build (scripts/environment.mjs's Vite
   * plugin).
   */
  readonly BUDGETMINT_ENV: 'production' | 'dev';
  /** Development builds: the Firebase emulators on this host. */
  readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  /** The desktop's Google sign-in client ("Desktop app" OAuth client). */
  readonly VITE_GOOGLE_DESKTOP_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DESKTOP_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
