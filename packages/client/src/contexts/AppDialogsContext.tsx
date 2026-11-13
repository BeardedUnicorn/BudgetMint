/**
 * The dialogs any part of the app opens, from any page or none (About
 * opens from the menu bar before sign-in too): About BudgetMint, signing
 * out, and the keyboard shortcuts.
 */

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AboutDialog } from '../components/about/AboutDialog';
import { SignOutDialog } from '../components/account/SignOutDialog';
import { ShortcutsDialog } from '../components/layout/ShortcutsDialog';
import { MENU, useMenuCommands } from '../hooks/useMenuCommands';

export type AppDialog = 'about' | 'signOut' | 'shortcuts';

interface AppDialogsValue {
  open: (dialog: AppDialog) => void;
}

interface Host {
  shown: AppDialog | null;
  close: () => void;
  /** The pages show the dialogs themselves (AppDialogsHost) until the returned function is called. */
  host: () => () => void;
}

const HostContext = createContext<Host | null>(null);

function Dialogs({ shown, close }: Pick<Host, 'shown' | 'close'>) {
  return (
    <>
      <AboutDialog open={shown === 'about'} onClose={close} />
      <SignOutDialog open={shown === 'signOut'} onClose={close} />
      <ShortcutsDialog open={shown === 'shortcuts'} onClose={close} />
    </>
  );
}

/**
 * Where the pages show the dialogs: inside the navigation, so Back closes
 * one that's open instead of changing the page under it. Without it (before
 * sign-in, in onboarding) the provider shows them, and there's no Back to take.
 */
export function AppDialogsHost() {
  const { shown, close, host } = useContext(HostContext)!;
  useEffect(() => host(), [host]);
  return <Dialogs shown={shown} close={close} />;
}

const AppDialogsContext = createContext<AppDialogsValue | null>(null);

/** Inside the budget's provider (signing out is the session's). */
export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<AppDialog | null>(null);
  const [hosted, setHosted] = useState(false);
  const value = useMemo(() => ({ open: setShown }), []);
  const host = useMemo<Host>(
    () => ({
      shown,
      close: () => setShown(null),
      host: () => {
        setHosted(true);
        return () => setHosted(false);
      },
    }),
    [shown]
  );
  // The menu bar's About, before sign-in too
  useMenuCommands({ [MENU.about]: () => setShown('about') });
  return (
    <AppDialogsContext.Provider value={value}>
      <HostContext.Provider value={host}>{children}</HostContext.Provider>
      {!hosted && <Dialogs shown={shown} close={host.close} />}
    </AppDialogsContext.Provider>
  );
}

export function useAppDialogs(): AppDialogsValue {
  const context = useContext(AppDialogsContext);
  if (!context) throw new Error('useAppDialogs must be used within an AppDialogsProvider');
  return context;
}
