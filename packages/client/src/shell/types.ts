/**
 * What each app's shell gives the client (TaskMint's Backend, without the
 * data: BudgetMint's data is the cloud's on every platform). A platform
 * member that's missing is a feature that build doesn't have, and the UI
 * leaves it out.
 */

import type { ComponentType } from 'react';

export interface Capabilities {
  runtime: 'desktop' | 'mobile' | 'web';
}

/** A reminder, worded, for the shell to show at its time. */
export interface ScheduledNotification {
  /** Stable per reminder (core's 31-bit id), so scheduling again replaces it. */
  id: number;
  atMs: number;
  title: string;
  body: string;
  /**
   * What a tap on it opens, where the shell can say (Android): one of the
   * menu's ids (menuCommands.ts), as a click on that item would.
   */
  open?: string;
}

export interface Notifications {
  /** Whether notifications may be shown (asking for permission if it hasn't been yet). */
  request(): Promise<boolean>;
  /**
   * Whether they may be shown now, without asking. Only where asking needs
   * the user's click (a browser): the app then offers the click.
   */
  granted?(): Promise<boolean>;
  /** Shows one now: the test from Settings, to see that the system lets them through. */
  show(title: string, body: string): Promise<void>;
  /** Replaces the reminders waiting to be shown with `list`. */
  schedule(list: ScheduledNotification[]): Promise<void>;
  /** They come even while the app is closed (Android); elsewhere only while it runs. */
  readonly firesWhenClosed: boolean;
}

/** Usage analytics (Firebase Analytics): the web app's, and Android's native SDK. */
export interface AnalyticsPlatform {
  /** On or off, as Settings → Privacy says. */
  setEnabled(enabled: boolean): void;
  /** A page the app showed, by its view's name. */
  screen(name: string): void;
}

/** How much of each edge of the screen (CSS px) the system covers. */
export interface SystemInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Android's status and navigation bars. The app draws under them (edge to
 * edge), so they follow its theme, and the app keeps what matters clear of
 * them: Android's webview doesn't say how much they cover in
 * env(safe-area-inset-*), nor shrink the page for the keyboard.
 */
export interface SystemBarsPlatform {
  /** Their clock, icons and buttons read on a dark theme, or a light one. */
  setDark(dark: boolean): void;
  /** What the bars, the gesture area and a camera cutout cover of each edge. */
  insets(): SystemInsets;
  /** How much of the screen's bottom the on-screen keyboard covers, 0 while it's down. */
  keyboardInset(): number;
  /** Calls `listener` when any of those changes. Returns a function that stops it. */
  onInsetsChange(listener: () => void): () => void;
}

export interface Platform {
  notifications: Notifications;
  /** A Google ID token, got the shell's own way (desktop, Android). */
  googleSignIn?: () => Promise<string>;
  /** Opening at login, started in the tray (the desktop's). */
  autostart?: { isEnabled(): Promise<boolean>; setEnabled(enabled: boolean): Promise<void> };
  /** The tray's lines (the desktop's menu-bar item). */
  tray?: { setStatus(lines: string[]): Promise<void> };
  /** Android's status and navigation bars. */
  systemBars?: SystemBarsPlatform;
  /** Android's launch screen, held until the app has drawn. */
  splashScreen?: { hide(): void };
  /**
   * Saves a file where the user picks (a save dialog); false if they didn't.
   * Without it a browser downloads the file, and an app's webview can't save one.
   */
  saveFile?: (name: string, text: string, type: string) => Promise<boolean>;
  /** Which pages are opened (the web and Android apps; the desktop has none). */
  analytics?: AnalyticsPlatform;
  /**
   * The menu bar's and the tray's items that the app does (the desktop's);
   * on Android, what the app was opened for: a launcher shortcut, a widget
   * or a reminder that was tapped.
   */
  menu?: MenuPlatform;
  /**
   * Keeping the app out of screenshots and the recent apps' previews
   * (Android). The device keeps the choice itself, so it holds from the
   * moment the app starts.
   */
  screenPrivacy?: { isOn(): boolean; set(on: boolean): void };
  /**
   * The home screen's widgets (Android): what they show, worded, as JSON
   * (useWidgetSnapshot.ts), or '' for nothing (signed out).
   */
  widgets?: { set(snapshot: string): void };
}

/**
 * The desktop's menus (the macOS menu bar, the tray): a click on one of
 * the items the app does comes as its id (menuCommands.ts lists them). On
 * Android the same ids come from a launcher shortcut, a widget or a
 * reminder that was tapped.
 */
export interface MenuPlatform {
  /** Each click, until the returned stop. */
  subscribe(listener: (id: string) => void): () => void;
  /**
   * Whether the budget is open (signed in, past onboarding): the items for
   * it (New Bill, the pages, Sign Out…) are greyed out until it is. On
   * Android, what the app was opened for waits until it is.
   */
  setBudgetOpen(open: boolean): void;
}

export interface Shell {
  readonly capabilities: Capabilities;
  readonly platform: Platform;
}

/** A shell's own Settings section (the desktop's Updates). */
export interface SettingsExtension {
  id: string;
  label: string;
  Section: ComponentType;
}

/**
 * What a shell adds to the app: Settings sections, work behind the pages
 * (the update prompt), and About's word on updates (the desktop's check).
 */
export interface AppExtensions {
  settingsSections?: SettingsExtension[];
  Background?: ComponentType;
  AboutUpdates?: ComponentType;
}
