/**
 * The dialogs any part of the app opens, from any page or none (About
 * opens from the menu bar before sign-in too): About BudgetMint, signing
 * out, and the keyboard shortcuts.
 */

import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { AboutDialog } from '../components/about/AboutDialog';
import { SignOutDialog } from '../components/account/SignOutDialog';
import { ShortcutsDialog } from '../components/layout/ShortcutsDialog';
import { MENU, useMenuCommands } from '../hooks/useMenuCommands';

export type AppDialog = 'about' | 'signOut' | 'shortcuts';

interface AppDialogsValue {
  open: (dialog: AppDialog) => void;
}

const AppDialogsContext = createContext<AppDialogsValue | null>(null);

/** Inside the budget's provider (signing out is the session's). */
export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<AppDialog | null>(null);
  const value = useMemo(() => ({ open: setShown }), []);
  const close = () => setShown(null);
  // The menu bar's About, before sign-in too
  useMenuCommands({ [MENU.about]: () => setShown('about') });
  return (
    <AppDialogsContext.Provider value={value}>
      {children}
      <AboutDialog open={shown === 'about'} onClose={close} />
      <SignOutDialog open={shown === 'signOut'} onClose={close} />
      <ShortcutsDialog open={shown === 'shortcuts'} onClose={close} />
    </AppDialogsContext.Provider>
  );
}

export function useAppDialogs(): AppDialogsValue {
  const context = useContext(AppDialogsContext);
  if (!context) throw new Error('useAppDialogs must be used within an AppDialogsProvider');
  return context;
}
