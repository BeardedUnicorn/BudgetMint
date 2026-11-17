/**
 * The client's Shell in the desktop and Android app. Every call goes through
 * the app's one IPC command, `dispatch` (apps/desktop/src-tauri/src/dispatch.rs);
 * events are Tauri events. The data isn't here: it's the cloud's, read and
 * written in the webview on every platform.
 *
 * - Both save the files the client makes through the system's save dialog
 *   (on Android its document picker).
 * - A desktop has the tray, and shows reminders while the app runs (closing
 *   the window keeps it in the tray); it can open at login, in the tray. Its
 *   menus' items for the client (menu.rs) come as MENU_COMMAND events.
 * - A phone or tablet (runtime 'mobile') has no tray; the system keeps its
 *   reminders as alarms, which come with the app closed. On Android it also
 *   has the status bar, the launch screen, Google's account picker,
 *   Firebase Analytics, screen privacy, what the app was opened for (a
 *   shortcut, a widget, a reminder), the widgets' contents and the app's
 *   own update, which MainActivity.kt hands the webview directly, outside
 *   dispatch.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Capabilities, Platform, Shell } from '@budgetmint/client/shell';

/** A click on one of the menus' items the client does: the item's id (src-tauri/src/events.rs). */
export const MENU_COMMAND = 'menu-command';

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
  /** 'light' or 'dark': the bars' icons and buttons then read on that theme. */
  setTheme(theme: string): void;
  /** What the bars, the gesture area and a camera cutout cover of an edge, in dp (CSS px). */
  topInset(): number;
  rightInset(): number;
  bottomInset(): number;
  leftInset(): number;
  /** The keyboard's height from the screen's bottom, in dp (0 while it's down). */
  keyboardInset(): number;
}

/** What listens for MainActivity's inset changes. */
const insetListeners = new Set<() => void>();

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

/** What Android's MainActivity.kt adds for Firebase Analytics (its native SDK). */
interface AndroidAnalytics {
  setEnabled(enabled: boolean): void;
  screen(name: string): void;
}

/** What Android's MainActivity.kt adds for keeping the app out of screenshots and recents. */
interface AndroidScreen {
  isPrivate(): boolean;
  setPrivate(on: boolean): void;
}

/**
 * What Android's MainActivity.kt adds for what the app was opened for: a
 * launcher shortcut, a widget or a reminder, as one of the menu's ids.
 */
interface AndroidLaunch {
  /** The id waiting, once ('' when there's none). */
  take(): string;
  /**
   * What a tap on each reminder opens: `{ [reminder id]: menu id }` as
   * JSON. A tapped notification's intent says only which one it was, so
   * MainActivity keeps this to look it up, with the app closed too.
   */
  setReminderTargets(targets: string): void;
}

/** What Android's MainActivity.kt adds for the home screen's widgets. */
interface AndroidWidgets {
  /** What they show, as JSON ('' for nothing). */
  set(snapshot: string): void;
}

/** What Android's MainActivity.kt adds for the app's own update (as TaskMint's AppTask, 94318ec). */
interface AndroidUpdate {
  /** Whether the phone won't install an update (Advanced Protection is on). */
  installsBlocked(): boolean;
  /** The phone's Security settings, where Advanced Protection is turned off. */
  openSecuritySettings(): void;
  /** Downloads a release and opens Android's installer on it; `window.__budgetmintUpdate` hears how far it is. */
  download(version: string): void;
}

/** What AppUpdate.kt reports of a download: how far it is, that the installer is open, or why it isn't. */
type UpdateReport = { downloaded: number; total: number | null } | { done: true } | { error: string };

/** What listens for what the app was opened for. */
const launchListeners = new Set<(id: string) => void>();

type GoogleAnswer = { idToken: string } | { error: string };

declare global {
  interface Window {
    __budgetmintGoogleSignIn?: (answer: GoogleAnswer) => void;
    /** MainActivity calls it when the bars' insets or the keyboard's change. */
    __budgetmintInsets?: () => void;
    BudgetMintSystemBars?: AndroidSystemBars;
    BudgetMintSplash?: AndroidSplash;
    BudgetMintGoogleSignIn?: AndroidGoogleSignIn;
    BudgetMintAnalytics?: AndroidAnalytics;
    /** MainActivity calls it when the app is opened for something while it runs. */
    __budgetmintLaunch?: () => void;
    BudgetMintScreen?: AndroidScreen;
    BudgetMintLaunch?: AndroidLaunch;
    BudgetMintWidgets?: AndroidWidgets;
    /** AppUpdate.kt calls it as a download goes. */
    __budgetmintUpdate?: (report: UpdateReport) => void;
    BudgetMintUpdate?: AndroidUpdate;
  }
}

/**
 * Whether the phone won't install an update it downloads: Android's
 * Advanced Protection blocks apps that don't come from the Play Store, as
 * BudgetMint's updates don't. False anywhere else.
 */
export function sideloadingBlocked(): boolean {
  return window.BudgetMintUpdate?.installsBlocked() ?? false;
}

/** Opens the phone's Security settings, where Advanced Protection is turned off. Nothing anywhere else. */
export function openSecuritySettings(): void {
  window.BudgetMintUpdate?.openSecuritySettings();
}

/** The "Desktop app" OAuth client Google sign-in uses (the build's VITE_GOOGLE_DESKTOP_CLIENT_*). */
export interface GoogleDesktopClient {
  clientId: string;
  clientSecret: string;
}

/**
 * What the app was opened for, as the desktop's menu clicks: MainActivity
 * keeps the id until the budget is open (a cold start signs in and loads
 * first), then every listener hears it, as a click on that menu item.
 */
function androidLaunch(launch: AndroidLaunch): NonNullable<Platform['menu']> {
  let budgetOpen = false;
  const deliver = () => {
    if (!budgetOpen) return;
    const id = launch.take();
    if (id) for (const each of [...launchListeners]) each(id);
  };
  window.__budgetmintLaunch = deliver;
  return {
    subscribe: listener => {
      launchListeners.add(listener);
      return () => {
        launchListeners.delete(listener);
      };
    },
    setBudgetOpen: open => {
      budgetOpen = open;
      // After the effects that subscribe, which run with this one
      queueMicrotask(deliver);
    },
  };
}

/**
 * The app's own update: AppUpdate.kt downloads the release and opens
 * Android's installer on it, reporting to `window.__budgetmintUpdate` as it
 * goes.
 */
function androidUpdate(update: AndroidUpdate): NonNullable<Platform['appUpdate']> {
  return {
    download: (version, onProgress) =>
      new Promise<void>((resolve, reject) => {
        window.__budgetmintUpdate = report => {
          if ('done' in report) resolve();
          else if ('error' in report) reject(report.error);
          else onProgress(report);
        };
        update.download(version);
      }),
  };
}

/**
 * Android's status bar, launch screen, usage analytics, screen privacy,
 * what the app was opened for, its widgets and its own update; elsewhere
 * there are none. The desktop has no analytics: Google's tag would run in a
 * webview that can call every command.
 */
function androidParts(): Pick<
  Platform,
  'systemBars' | 'splashScreen' | 'analytics' | 'screenPrivacy' | 'menu' | 'widgets' | 'appUpdate'
> {
  const {
    BudgetMintSystemBars: bars,
    BudgetMintSplash: splash,
    BudgetMintAnalytics: analytics,
    BudgetMintScreen: screen,
    BudgetMintLaunch: launch,
    BudgetMintWidgets: widgets,
    BudgetMintUpdate: update,
  } = window;
  return {
    ...(screen ? { screenPrivacy: { isOn: () => screen.isPrivate(), set: on => screen.setPrivate(on) } } : {}),
    ...(launch ? { menu: androidLaunch(launch) } : {}),
    ...(widgets ? { widgets: { set: snapshot => widgets.set(snapshot) } } : {}),
    ...(update ? { appUpdate: androidUpdate(update) } : {}),
    // Called on the bridge itself: Android refuses a method taken off it
    ...(bars
      ? {
          systemBars: {
            setDark: dark => bars.setTheme(dark ? 'dark' : 'light'),
            insets: () => ({
              top: bars.topInset(),
              right: bars.rightInset(),
              bottom: bars.bottomInset(),
              left: bars.leftInset(),
            }),
            keyboardInset: () => bars.keyboardInset(),
            onInsetsChange: listener => {
              insetListeners.add(listener);
              window.__budgetmintInsets = () => {
                for (const each of [...insetListeners]) each();
              };
              return () => {
                insetListeners.delete(listener);
              };
            },
          },
        }
      : {}),
    ...(splash ? { splashScreen: { hide: () => splash.hide() } } : {}),
    ...(analytics
      ? { analytics: { setEnabled: enabled => analytics.setEnabled(enabled), screen: name => analytics.screen(name) } }
      : {}),
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
        // What a tap opens stays with Android (MainActivity looks it up); the rest is the Rust side's
        schedule: reminders => {
          window.BudgetMintLaunch?.setReminderTargets(
            JSON.stringify(Object.fromEntries(reminders.flatMap(({ id, open }) => (open ? [[id, open]] : []))))
          );
          return command<void>('schedule_reminders', {
            reminders: reminders.map(({ id, atMs, title, body }) => ({ id, atMs, title, body })),
          });
        },
        show: (title, body) => command<void>('show_notification', { title, body }),
        firesWhenClosed: mobile,
      },
      // The system's save dialog (Settings → Your data); false when it's cancelled
      saveFile: (name, text) => command<boolean>('save_file', { name, text }),
      ...(mobile
        ? androidParts()
        : {
            tray: { setStatus: lines => command<void>('set_tray_status', { lines }) },
            autostart: {
              isEnabled: () => command<boolean>('get_autostart'),
              setEnabled: enabled => command<void>('set_autostart', { enabled }),
            },
            menu: {
              subscribe: listener => subscribe<string>(MENU_COMMAND, listener),
              setBudgetOpen: open => {
                command<void>('set_menu_state', { budgetOpen: open }).catch(error =>
                  console.warn('Failed to change the menus:', error)
                );
              },
            },
          }),
      ...googleSignIn(capabilities.runtime, google),
    },
  };
}
