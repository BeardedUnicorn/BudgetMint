/**
 * The webview's errors and warnings, in the app's log file with the Rust
 * side's own (src-tauri/src/logs.rs), so the log attached to a bug report
 * has them: console.error and console.warn (the client's reports, React's),
 * and errors nothing caught. They still reach the console too.
 */

import { command } from './tauriShell';

type Level = 'error' | 'warn';

/** One of console's arguments as text: an error with its stack, anything else as JSON where it can be. */
export function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A cycle, or a BigInt
    return String(value);
  }
}

/** Sends a line to the log. One that can't be sent is dropped: saying so would be another line to send. */
function send(level: Level, parts: unknown[]): void {
  command<void>('log', { level, message: parts.map(describe).join(' ') }).catch(() => undefined);
}

/** Starts sending the webview's errors and warnings to the log; what it returns stops it. */
export function forwardLogs(): () => void {
  const { error, warn } = console;
  console.error = (...parts: unknown[]) => {
    error.apply(console, parts);
    send('error', parts);
  };
  console.warn = (...parts: unknown[]) => {
    warn.apply(console, parts);
    send('warn', parts);
  };
  const onError = (event: ErrorEvent) => send('error', ['Uncaught', event.error ?? event.message]);
  const onRejection = (event: PromiseRejectionEvent) => send('error', ['Unhandled rejection:', event.reason]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    console.error = error;
    console.warn = warn;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
