// Adapted from TaskMint packages/client/src/contexts/NavigationContext.tsx @ 1623bee.
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { NavigationParams, SidebarView, VIEWS } from '../navigation/views';
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

const NavigationContext = createContext<NavigationValue | null>(null);

const NO_PARAMS: NavigationParams = {};

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

  const navigate = useCallback(
    (view: SidebarView, params?: NavigationParams) => {
      setState({ view, params: params ?? NO_PARAMS });
      if (persist) writeLocal<SidebarView | null>(ACTIVE_VIEW_KEY, view, null);
    },
    [persist]
  );

  const clearParams = useCallback(() => {
    setState(prev => (prev.params === NO_PARAMS ? prev : { ...prev, params: NO_PARAMS }));
  }, []);

  const value = useMemo(
    () => ({ view: state.view, params: state.params, navigate, clearParams }),
    [state, navigate, clearParams]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
