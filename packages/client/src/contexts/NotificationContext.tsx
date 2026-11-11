/**
 * Toasts: a message in the bottom-right corner that goes after a while
 * (longer for errors, and for ones with a button such as Undo). A toast
 * holds while the pointer is on it or it has focus. The look is TaskMint's
 * (components/notifications/ToastViewport).
 */

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ToastViewport, type Toast, type ToastAction, type Severity } from '../components/notifications/ToastViewport';

export type { Severity, ToastAction };

export interface NotifyOptions {
  severity?: Severity;
  title?: string;
  actions?: ToastAction[];
  /** How long it shows (ms); 0 keeps it until dismissed. */
  durationMs?: number;
}

interface NotificationValue {
  notify(message: string, options?: NotifyOptions): string;
  showSuccess(message: string, options?: Omit<NotifyOptions, 'severity'>): string;
  showError(message: string, options?: Omit<NotifyOptions, 'severity'>): string;
  showInfo(message: string, options?: Omit<NotifyOptions, 'severity'>): string;
  showWarning(message: string, options?: Omit<NotifyOptions, 'severity'>): string;
  dismiss(id: string): void;
}

/** How long toasts show, and the most at once. */
export const TOAST_MS = 5000;
export const LONG_TOAST_MS = 8000;
export const MAX_TOASTS = 4;
/** How long a toast takes to leave. */
const EXIT_MS = 200;

const NotificationContext = createContext<NotificationValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const durations = useRef(new Map<string, number>());
  const nextId = useRef(0);

  const remove = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    durations.current.delete(id);
    setToasts(current => current.map(toast => (toast.id === id ? { ...toast, exiting: true } : toast)));
    setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), EXIT_MS);
  }, []);

  const schedule = useCallback(
    (id: string) => {
      const duration = durations.current.get(id);
      if (!duration) return;
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => remove(id), duration)
      );
    },
    [remove]
  );

  const notify = useCallback(
    (message: string, options: NotifyOptions = {}) => {
      const id = `toast-${++nextId.current}`;
      const severity = options.severity ?? 'info';
      const actions = options.actions ?? [];
      const long = severity === 'error' || actions.length > 0;
      durations.current.set(id, options.durationMs ?? (long ? LONG_TOAST_MS : TOAST_MS));
      setToasts(current => {
        const shown = current.filter(toast => !toast.exiting);
        // The oldest go when there are too many
        for (const old of shown.slice(0, Math.max(0, shown.length - MAX_TOASTS + 1))) {
          setTimeout(() => remove(old.id), 0);
        }
        return [...current, { id, severity, title: options.title, message, actions, exiting: false }];
      });
      schedule(id);
      return id;
    },
    [remove, schedule]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const value = useMemo<NotificationValue>(
    () => ({
      notify,
      showSuccess: (message, options) => notify(message, { ...options, severity: 'success' }),
      showError: (message, options) => notify(message, { ...options, severity: 'error' }),
      showInfo: (message, options) => notify(message, { ...options, severity: 'info' }),
      showWarning: (message, options) => notify(message, { ...options, severity: 'warning' }),
      dismiss: remove,
    }),
    [notify, remove]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={remove}
        onAction={(action, id) => {
          action.onClick();
          remove(id);
        }}
        onHold={id => clearTimeout(timers.current.get(id))}
        onRelease={schedule}
      />
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within a NotificationProvider');
  return context;
}
