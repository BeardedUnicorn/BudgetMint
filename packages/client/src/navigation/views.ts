/**
 * The app's pages (sidebar order) and the settings sections a link can open.
 */

export const VIEWS = ['overview', 'bills', 'income', 'savings', 'calendar', 'forecast', 'reports', 'settings'] as const;

export type SidebarView = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<SidebarView, string> = {
  overview: 'Overview',
  bills: 'Bills',
  income: 'Income',
  savings: 'Savings',
  calendar: 'Calendar',
  forecast: 'Forecast',
  reports: 'Reports',
  settings: 'Settings',
};

/** Settings' sections, as the page anchors them (a shell's own are its ids). */
export type SettingsSectionId =
  | 'account'
  | 'data'
  | 'forecast'
  | 'accounts'
  | 'taskmint'
  | 'reminders'
  | 'appearance'
  | 'privacy'
  | 'about';

/** Settings' sections, in page order, as its section list names them. */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  account: 'Account',
  data: 'Your data',
  forecast: 'Forecast',
  accounts: 'Bank accounts',
  taskmint: 'TaskMint',
  reminders: 'Reminders',
  appearance: 'Appearance',
  privacy: 'Privacy',
  about: 'About',
};

/**
 * The Settings sections this platform can use: Privacy needs usage
 * statistics or screen privacy to offer (the desktop has neither).
 */
export function availableSettingsSections(platform: {
  analytics?: unknown;
  screenPrivacy?: unknown;
}): SettingsSectionId[] {
  return (Object.keys(SETTINGS_SECTION_LABELS) as SettingsSectionId[]).filter(
    id => id !== 'privacy' || Boolean(platform.analytics || platform.screenPrivacy)
  );
}

/**
 * What a page is opened for: a settings section, (Bills, Income) adding
 * one, or (from the menu bar, or an Android shortcut) Overview's balance or
 * its one-off spend, or saving Your data's backup or spreadsheet.
 */
export interface NavigationParams {
  section?: SettingsSectionId;
  add?: boolean;
  open?: 'balance' | 'record' | 'backup' | 'spreadsheet';
}
