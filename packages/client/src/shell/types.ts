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

export interface Platform {
  notifications: Notifications;
  /** A Google ID token, got the shell's own way (desktop, Android). */
  googleSignIn?: () => Promise<string>;
  /** Opening at login, started in the tray (the desktop's). */
  autostart?: { isEnabled(): Promise<boolean>; setEnabled(enabled: boolean): Promise<void> };
  /** The tray's lines (the desktop's menu-bar item). */
  tray?: { setStatus(lines: string[]): Promise<void> };
  /** Android's status and navigation bars follow the theme. */
  systemBars?: { setDark(dark: boolean): void };
  /** Android's launch screen, held until the app has drawn. */
  splashScreen?: { hide(): void };
  /**
   * Saves a file where the user picks (a save dialog); false if they didn't.
   * Without it a browser downloads the file, and an app's webview can't save one.
   */
  saveFile?: (name: string, text: string, type: string) => Promise<boolean>;
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

/** What a shell adds to the app: Settings sections, and work behind the pages (the update prompt). */
export interface AppExtensions {
  settingsSections?: SettingsExtension[];
  Background?: ComponentType;
}
