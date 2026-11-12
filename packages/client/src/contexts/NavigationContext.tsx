// Adapted from TaskMint packages/client/src/contexts/NavigationContext.tsx @ 1623bee: Back goes back.
/**
 * Which page is showing, and Back. Each page opened is an entry in the
 * window's history (the address doesn't change), so the browser's Back and
 * Android's back gesture (Tauri goes back in the webview while it can) return
 * to the page before. A dialog, menu or drawer open on top is closed by Back
 * first (useBackDismiss): while any is open, one more entry sits on top of
 * the page's, and Back takes that.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type NavigationParams, type SidebarView, VIEWS } from '../navigation/views';
import { readLocal, writeLocal } from '../utils/localStore';

/** The page showing when the app was last closed (with `persist`). */
export const ACTIVE_VIEW_KEY = 'activeView';

function storedView(fallback: SidebarView): SidebarView {
  const stored = readLocal<unknown>(ACTIVE_VIEW_KEY, null);
  return VIEWS.includes(stored as SidebarView) ? (stored as SidebarView) : fallback;
}

interface NavigationValue {
  view: SidebarView;
  params: NavigationParams;
  /** Open a page, optionally with context for it (a settings section, a bill to show). */
  navigate: (view: SidebarView, params?: NavigationParams) => void;
  /** Called by a page once it has acted on its params. */
  clearParams: () => void;
}

/** Something on top of the page that Back closes: false from `back` when it stays open (it asks first). */
interface Overlay {
  back: () => boolean;
}

interface BackStack {
  /** Puts it on top; the function returned takes it off once it's closed. */
  open: (overlay: Overlay) => () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);
const BackStackContext = createContext<BackStack | null>(null);

const NO_PARAMS: NavigationParams = {};

/** What the window's history keeps for an entry of BudgetMint's. */
interface Entry {
  budgetmint: { view: SidebarView; overlay?: true };
}

const viewOf = (state: unknown): SidebarView | null => {
  const view = (state as Entry | null)?.budgetmint?.view;
  return VIEWS.includes(view as SidebarView) ? (view as SidebarView) : null;
};

/**
 * Which page is showing. Mounted above the other providers so anything (a
 * toast's button, a reminder) can switch pages.
 */
export function NavigationProvider({
  children,
  initialView = 'overview',
  persist = false,
}: {
  children: ReactNode;
  initialView?: SidebarView;
  /** Reopen on the page that was showing last time. */
  persist?: boolean;
}) {
  const [state, setState] = useState<{ view: SidebarView; params: NavigationParams }>(() => ({
    view: persist ? storedView(initialView) : initialView,
    params: NO_PARAMS,
  }));
  const current = useRef(state.view);
  /** What's open on top, the last on top. */
  const overlays = useRef<Overlay[]>([]);
  /** The overlays' entry is on top of the history. */
  const covered = useRef(false);
  /** Going back to take the overlays' entry off: its popstate isn't the user's. */
  const ignoring = useRef(0);

  const show = useCallback(
    (view: SidebarView, params: NavigationParams) => {
      current.current = view;
      setState({ view, params });
      if (persist) writeLocal<SidebarView | null>(ACTIVE_VIEW_KEY, view, null);
    },
    [persist]
  );

  const navigate = useCallback(
    (view: SidebarView, params?: NavigationParams) => {
      if (view !== current.current) {
        const entry: Entry = { budgetmint: { view } };
        // Opened from a drawer or a dialog: the page takes the overlays' entry, which their closing leaves alone
        if (covered.current) window.history.replaceState(entry, '');
        else window.history.pushState(entry, '');
        covered.current = false;
      }
      show(view, params ?? NO_PARAMS);
    },
    [show]
  );

  useEffect(() => {
    // The page showing now is where Back stops: before it, the window's own history
    window.history.replaceState({ budgetmint: { view: current.current } } satisfies Entry, '');
    const popped = (event: PopStateEvent) => {
      if (ignoring.current > 0) {
        ignoring.current -= 1;
        return;
      }
      const top = overlays.current.at(-1);
      if (covered.current && top) {
        covered.current = false;
        // It stays open (asking first), or others are open under it: they keep an entry to go back from
        if (!top.back() || overlays.current.length > 1) {
          window.history.pushState({ budgetmint: { view: current.current, overlay: true } } satisfies Entry, '');
          covered.current = true;
        }
        return;
      }
      covered.current = false;
      const view = viewOf(event.state);
      if (view) show(view, NO_PARAMS);
    };
    window.addEventListener('popstate', popped);
    return () => window.removeEventListener('popstate', popped);
  }, [show]);

  const backStack = useMemo<BackStack>(
    () => ({
      open: overlay => {
        overlays.current = [...overlays.current, overlay];
        if (!covered.current) {
          window.history.pushState({ budgetmint: { view: current.current, overlay: true } } satisfies Entry, '');
          covered.current = true;
        }
        return () => {
          overlays.current = overlays.current.filter(open => open !== overlay);
          // After this render (an overlay that closes as another opens hands the entry on), the last one
          // closed by itself takes the entry off again
          queueMicrotask(() => {
            if (overlays.current.length > 0 || !covered.current) return;
            covered.current = false;
            ignoring.current += 1;
            window.history.back();
          });
        };
      },
    }),
    []
  );

  const clearParams = useCallback(() => {
    setState(prev => (prev.params === NO_PARAMS ? prev : { ...prev, params: NO_PARAMS }));
  }, []);

  const value = useMemo(
    () => ({ view: state.view, params: state.params, navigate, clearParams }),
    [state, navigate, clearParams]
  );

  return (
    <NavigationContext.Provider value={value}>
      <BackStackContext.Provider value={backStack}>{children}</BackStackContext.Provider>
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}

/**
 * While `open`, Back calls `onBack` instead of leaving the page: it closes
 * what's open (or returns false when it stays open, asking first). Nothing
 * outside the pages (onboarding) has a Back to take.
 */
export function useBackDismiss(open: boolean, onBack: () => unknown): void {
  const stack = useContext(BackStackContext);
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!open || !stack) return;
    return stack.open({ back: () => latest.current() !== false });
  }, [open, stack]);
}
