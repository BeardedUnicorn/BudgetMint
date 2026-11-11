// Copied from TaskMint packages/client/src/utils/locale.ts @ 1623bee: keep the two in step.
/**
 * The locale dates, times and amounts are written in: the system's, unless
 * one is pinned (the tests pin en-US so their expected text holds on any
 * machine). Every formatter in the app goes through here.
 */

let pinned: string | undefined;

/** Pin a locale (undefined: back to the system's). */
export function setFormattingLocale(locale: string | undefined): void {
  pinned = locale;
}

/** The locale to pass to Intl and toLocale*String; undefined means the system's. */
export function formattingLocale(): string | undefined {
  return pinned;
}

const asDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));

/** A file's size ("512 B", "820 KB", "1.4 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString(pinned)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(pinned, { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(pinned, { maximumFractionDigits: 1 })} MB`;
}

/** "Oct 14" */
export function formatShortDate(value: Date | string | number): string {
  return asDate(value).toLocaleDateString(pinned, { month: 'short', day: 'numeric' });
}

/** "2:43 PM" */
export function formatClockTime(value: Date | string | number): string {
  return asDate(value).toLocaleTimeString(pinned, { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 14, 2:43 PM" */
export function formatShortDateTime(value: Date | string | number): string {
  return asDate(value).toLocaleString(pinned, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Mon, Oct 14" */
export function formatWeekdayDate(value: Date | string | number): string {
  return asDate(value).toLocaleDateString(pinned, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Mon, Oct 14, 2:43 PM" */
export function formatWeekdayDateTime(value: Date | string | number): string {
  return asDate(value).toLocaleString(pinned, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "October 2026" */
export function formatMonthYear(value: Date | string | number): string {
  return asDate(value).toLocaleDateString(pinned, { month: 'long', year: 'numeric' });
}

/** The date and time in full ("10/14/2026, 2:43:05 PM"). */
export function formatDateTime(value: Date | string | number): string {
  return asDate(value).toLocaleString(pinned);
}
