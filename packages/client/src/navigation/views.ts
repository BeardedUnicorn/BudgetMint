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
export type SettingsSectionId = 'account' | 'data' | 'forecast' | 'taskmint' | 'reminders' | 'appearance' | 'about';

/** What a page is opened for: a settings section, or (Bills, Income, Overview) adding one. */
export interface NavigationParams {
  section?: SettingsSectionId;
  add?: boolean;
}
