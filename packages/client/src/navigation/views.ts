/**
 * The app's pages (sidebar order) and the settings sections a link can open.
 */

export const VIEWS = ['overview', 'bills', 'income', 'calendar', 'forecast', 'settings'] as const;

export type SidebarView = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<SidebarView, string> = {
  overview: 'Overview',
  bills: 'Bills',
  income: 'Income',
  calendar: 'Calendar',
  forecast: 'Forecast',
  settings: 'Settings',
};

export type SettingsSectionId = 'account' | 'balance' | 'taskmint' | 'forecast' | 'reminders' | 'appearance' | 'about';

/** Settings' sections, in page order. */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  account: 'Account',
  balance: 'Balance',
  taskmint: 'TaskMint',
  forecast: 'Forecast',
  reminders: 'Reminders',
  appearance: 'Appearance',
  about: 'About',
};

/** What a page is opened for: a settings section, or a bill to show. */
export interface NavigationParams {
  section?: SettingsSectionId;
  itemId?: string;
}
