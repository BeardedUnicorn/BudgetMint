/**
 * The client's Shell in the desktop and Android app. Every call goes through
 * the app's one IPC command, `dispatch` (apps/desktop/src-tauri/src/dispatch.rs);
 * events are Tauri events. The data isn't here: it's the cloud's, read and
 * written in the webview on every platform.
 *
 * - A desktop has the tray, and shows reminders while the app runs (closing
 *   the window keeps it in the tray); it can open at login, in the tray.
 * - A phone or tablet (runtime 'mobile') has no tray; the system keeps its
 *   reminders as alarms, which come with the app closed. On Android it also
 *   has the status bar, the launch screen and Google's account picker, which
 *   MainActivity.kt hands the webview directly, outside dispatch.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Capabilities, Platform, Shell } from '@budgetmint/client/shell';

/** Runs a command in the app's Rust side (dispatch takes `{}` for no arguments). */
export function command<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>('dispatch', { command: name, args });
}

/**
 * Listens for a Tauri event. Tauri registers a listener asynchronously;
 * unsubscribing before that finishes still removes it once it exists.
 */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let disposed = false;
  listen<T>(event, ({ payload }) => handler(payload)).then(
    stop => {
      if (disposed) stop();
      else unlisten = stop;
    },
    error => console.error(`Failed to listen for ${event}:`, error)
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** What Android's MainActivity.kt adds to the webview, before the page loads. */
interface AndroidSystemBars {
  /** 'light' or 'dark': the status bar's icons then read on that theme. */
  setTheme(theme: string): void;
}

/** What Android's MainActivity.kt adds for its launch screen. */
interface AndroidSplash {
  /** The page has drawn: the launch screen fades out. */
  hide(): void;
}

/** What Android's MainActivity.kt adds for Google sign-in (Credential Manager). */
interface AndroidGoogleSignIn {
  /** Shows the account picker; the answer comes to `window.__budgetmintGoogleSignIn`. */
  start(): void;
}

type GoogleAnswer = { idToken: string } | { error: string };

declare global {
  interface Window {
    __budgetmintGoogleSignIn?: (answer: GoogleAnswer) => void;
    BudgetMintSystemBars?: AndroidSystemBars;
    BudgetMintSplash?: AndroidSplash;
    BudgetMintGoogleSignIn?: AndroidGoogleSignIn;
  }
}

/** The "Desktop app" OAuth client Google sign-in uses (the build's VITE_GOOGLE_DESKTOP_CLIENT_*). */
export interface GoogleDesktopClient {
  clientId: string;
  clientSecret: string;
}

/** Android's status bar and launch screen; elsewhere there are none. */
function androidParts(): Pick<Platform, 'systemBars' | 'splashScreen'> {
  const { BudgetMintSystemBars: bars, BudgetMintSplash: splash } = window;
  return {
    // Called on the bridge itself: Android refuses a method taken off it
    ...(bars ? { systemBars: { setDark: dark => bars.setTheme(dark ? 'dark' : 'light') } } : {}),
    ...(splash ? { splashScreen: { hide: () => splash.hide() } } : {}),
  };
}

/** Google sign-in: Android's account picker, or the desktop's browser when the build has a client. */
function googleSignIn(runtime: Capabilities['runtime'], client?: GoogleDesktopClient): Pick<Platform, 'googleSignIn'> {
  if (runtime === 'mobile') {
    const android = window.BudgetMintGoogleSignIn;
    if (!android) return {};
    return {
      googleSignIn: () =>
        new Promise<string>((resolve, reject) => {
          window.__budgetmintGoogleSignIn = answer =>
            'idToken' in answer ? resolve(answer.idToken) : reject(answer.error);
          android.start();
        }),
    };
  }
  if (!client) return {};
  return {
    googleSignIn: () => command<{ idToken: string }>('google_sign_in', { ...client }).then(({ idToken }) => idToken),
  };
}

/** `capabilities` are what get_capabilities said, before the client started. */
export function createTauriShell(capabilities: Capabilities, google?: GoogleDesktopClient): Shell {
  const mobile = capabilities.runtime === 'mobile';
  return {
    capabilities,
    platform: {
      notifications: {
        request: () => command<boolean>('request_notifications'),
        schedule: reminders => command<void>('schedule_reminders', { reminders }),
        show: (title, body) => command<void>('show_notification', { title, body }),
        firesWhenClosed: mobile,
      },
      ...(mobile
        ? androidParts()
        : {
            tray: { setStatus: lines => command<void>('set_tray_status', { lines }) },
            autostart: {
              isEnabled: () => command<boolean>('get_autostart'),
              setEnabled: enabled => command<void>('set_autostart', { enabled }),
            },
          }),
      ...googleSignIn(capabilities.runtime, google),
    },
  };
}
