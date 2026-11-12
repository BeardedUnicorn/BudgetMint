/**
 * The app: signing in until someone is, onboarding until the settings are
 * saved, then the pages in TaskMint's frame: the sidebar (a slide-in menu,
 * a top bar and a bar of the main pages on a phone) and the page beside it.
 */

import { ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, CssBaseline, Stack } from '@mui/material';
import type { CoreClient } from './core';
import type { BudgetSession } from './cloud/session';
import { AppExtensionsContext } from './app/extensions';
import { AuthLayout } from './components/auth/AuthLayout';
import { SignInForm, type FormMode } from './components/auth/SignInForm';
import { AccountMenu } from './components/account/AccountMenu';
import { BalanceFooter } from './components/layout/BalanceFooter';
import { BottomNav } from './components/layout/BottomNav';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { CompactTopBar } from './components/layout/CompactTopBar';
import { Sidebar, SIDEBAR_COLLAPSED_KEY } from './components/layout/Sidebar';
import { StatusNotices } from './components/layout/StatusNotices';
import { Onboarding } from './components/onboarding/Onboarding';
import { CalendarPage } from './components/pages/calendar/CalendarPage';
import { ForecastPage } from './components/pages/forecast/ForecastPage';
import { ItemsPage } from './components/pages/items/ItemsPage';
import { OverviewPage } from './components/pages/overview/OverviewPage';
import { ReportsPage } from './components/pages/reports/ReportsPage';
import { SavingsPage } from './components/pages/savings/SavingsPage';
import { SettingsPage } from './components/pages/settings/SettingsPage';
import { AppDialogsProvider, useAppDialogs } from './contexts/AppDialogsContext';
import { activeViewKey, NavigationProvider, useBackDismiss, useNavigation } from './contexts/NavigationContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { BudgetProvider, useBudget, useCoreQuery } from './data/BudgetContext';
import { useCompactLayout } from './hooks/useCompactLayout';
import { somethingOnTop, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLocalStorage } from './hooks/useLocalStorage';
import { goTo, MENU, useMenuCommands } from './hooks/useMenuCommands';
import { useReminders } from './hooks/useReminders';
import { useSystemBarsTheme } from './hooks/useSystemBarsTheme';
import { useTrayStatus } from './hooks/useTrayStatus';
import { VIEW_LABELS, VIEWS, type SidebarView } from './navigation/views';
import { getShell } from './shell';
import type { AppExtensions } from './shell/types';
import { useAnalyticsScreens } from './utils/analytics';

const PAGES: Record<SidebarView, ComponentType> = {
  overview: OverviewPage,
  bills: () => <ItemsPage kind="bill" />,
  income: () => <ItemsPage kind="income" />,
  savings: SavingsPage,
  calendar: CalendarPage,
  forecast: ForecastPage,
  reports: ReportsPage,
  settings: SettingsPage,
};

/** Firebase (or core) couldn't load when the app opened. */
export function StartupError({ message, extensions = {} }: { message: string; extensions?: AppExtensions }) {
  const { Background } = extensions;
  return (
    <ThemeProvider>
      <CssBaseline enableColorScheme />
      <AuthLayout title="BudgetMint can’t start">
        <Stack spacing={2}>
          <Alert severity="error">{message}</Alert>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </Stack>
      </AuthLayout>
      {/* A release that can't start is the one that most needs the next: the shell's update check still runs */}
      {Background && <Background />}
    </ThemeProvider>
  );
}

function Loading() {
  return (
    <Box
      role="status"
      aria-label="Loading your budget"
      sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}
    >
      <CircularProgress />
    </Box>
  );
}

/** The page's title for what the form is doing. */
const SIGN_IN_TITLES: Record<FormMode, string> = {
  signIn: 'Sign in to BudgetMint',
  signUp: 'Create your BudgetMint account',
  reset: 'Reset your password',
};

/** Signing in, or making an account, or a reset link: the title says which. */
function SignInPage({ session }: { session: BudgetSession }) {
  const [mode, setMode] = useState<FormMode>('signIn');
  return (
    <AuthLayout title={SIGN_IN_TITLES[mode]}>
      <SignInForm engine={session} onPhone={getShell().capabilities.runtime === 'mobile'} onModeChange={setMode} />
    </AuthLayout>
  );
}

/** What the session's phase shows: signing in, loading, an error, or the app. */
function Gate() {
  const { session, view } = useBudget();
  // Android's launch screen holds until the app has something to show
  useEffect(() => {
    if (view.phase !== 'loading') getShell().platform.splashScreen?.hide();
  }, [view.phase]);

  switch (view.phase) {
    case 'loading':
    case 'starting':
      return <Loading />;
    case 'signedOut':
      return <SignInPage session={session} />;
    case 'error':
      return (
        <AuthLayout title="BudgetMint can’t reach your data">
          <Stack spacing={2}>
            <Alert severity="error">{view.error}</Alert>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => void session.retry()}>
                Try again
              </Button>
              <Button onClick={() => void session.signOut()}>Sign out</Button>
            </Stack>
          </Stack>
        </AuthLayout>
      );
    default:
      return <Ready />;
  }
}

/** Signed in, with the data read: onboarding the first time, then the app. */
function Ready() {
  const { saved } = useCoreQuery('get_settings');
  const { view } = useBudget();
  return saved ? (
    <NavigationProvider persist={activeViewKey(view.user!.uid)}>
      <AppShell />
    </NavigationProvider>
  ) : (
    <>
      {/* Offline, or settings a newer BudgetMint wrote: said here too, before anything is started over them */}
      <StatusNotices />
      <Onboarding />
    </>
  );
}

/**
 * What runs behind the pages once signed in: reminders, the tray, the
 * system bars, the pages opened (for usage analytics), shortcuts, and the
 * menu bar's items for the budget.
 */
function BackgroundJobs() {
  const { navigate } = useNavigation();
  const dialogs = useAppDialogs();
  const [, setCollapsed] = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false);
  useReminders();
  useTrayStatus();
  useSystemBarsTheme();
  useAnalyticsScreens();
  useKeyboardShortcuts(getShell().capabilities.runtime === 'web', () => dialogs.open('shortcuts'));

  // The menu bar's items for the budget are greyed out until it's open
  useEffect(() => {
    const menu = getShell().platform.menu;
    menu?.setBudgetOpen(true);
    return () => menu?.setBudgetOpen(false);
  }, []);
  // As the shortcuts, they wait while a dialog or menu is open
  const unlessOnTop = (action: () => void) => () => {
    if (!somethingOnTop()) action();
  };
  useMenuCommands({
    [MENU.settings]: unlessOnTop(() => navigate('settings')),
    [MENU.signOut]: unlessOnTop(() => dialogs.open('signOut')),
    [MENU.newBill]: unlessOnTop(() => navigate('bills', { add: true })),
    [MENU.newIncome]: unlessOnTop(() => navigate('income', { add: true })),
    [MENU.updateBalance]: unlessOnTop(() => navigate('overview', { open: 'balance' })),
    [MENU.importStatement]: unlessOnTop(() => navigate('settings', { section: 'data' })),
    [MENU.downloadBackup]: unlessOnTop(() => navigate('settings', { section: 'data', open: 'backup' })),
    [MENU.downloadSpreadsheet]: unlessOnTop(() => navigate('settings', { section: 'data', open: 'spreadsheet' })),
    [MENU.shortcuts]: unlessOnTop(() => dialogs.open('shortcuts')),
    [MENU.toggleSidebar]: () => setCollapsed(collapsed => !collapsed),
    ...Object.fromEntries(VIEWS.map(view => [goTo(view), unlessOnTop(() => navigate(view))])),
  });
  return null;
}

function AppShell() {
  const { view: activeView, navigate } = useNavigation();
  const compact = useCompactLayout();
  const [navigationOpen, setNavigationOpen] = useState(false);
  // Back closes the phone's slid-in sidebar first
  useBackDismiss(compact && navigationOpen, () => setNavigationOpen(false));
  const Page = PAGES[activeView];
  const footer = (collapsed: boolean) => (
    <>
      <AccountMenu collapsed={collapsed} onPicked={() => setNavigationOpen(false)} />
      <BalanceFooter collapsed={collapsed} />
    </>
  );
  const main = useRef<HTMLElement>(null);
  // A page opens at its top, not where the last one was scrolled to: before the page's
  // own effects, which may scroll it somewhere (Settings to a section)
  useLayoutEffect(() => {
    main.current!.scrollTop = 0;
  }, [activeView]);

  return (
    <>
      <BackgroundJobs />
      {/* dvh: a phone's browser bars and keyboard don't hide the bottom. On a phone the page is
          above the bottom bar; the sidebar slides in over both */}
      <Box
        sx={{
          height: '100vh',
          '@supports (height: 100dvh)': { height: '100dvh' },
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
        }}
      >
        <Sidebar
          variant={compact ? 'temporary' : 'permanent'}
          open={navigationOpen}
          onClose={() => setNavigationOpen(false)}
          activeView={activeView}
          onViewChange={navigate}
          footer={footer}
        />
        <Box
          component="main"
          ref={main}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
            // The bottom bar keeps clear of the gesture bar on a phone
            pb: compact ? 0 : 'env(safe-area-inset-bottom)',
          }}
        >
          {compact && <CompactTopBar title={VIEW_LABELS[activeView]} />}
          <StatusNotices />
          <Page />
        </Box>
        {compact && (
          <BottomNav activeView={activeView} onViewChange={navigate} onMore={() => setNavigationOpen(true)} />
        )}
      </Box>
    </>
  );
}

export interface AppProps {
  session: BudgetSession;
  core: CoreClient;
  extensions?: AppExtensions;
}

export function App({ session, core, extensions = {} }: AppProps) {
  const { Background } = extensions;
  return (
    <ThemeProvider>
      <CssBaseline enableColorScheme />
      <NotificationProvider>
        <BudgetProvider session={session} core={core}>
          <AppExtensionsContext.Provider value={extensions}>
            <AppDialogsProvider>
              {/* A page that fails says so, and the shell's work below goes on */}
              <ErrorBoundary>
                <Gate />
              </ErrorBoundary>
              {/* The shell's own work (the desktop's update check) runs whatever
                    the phase, so an update can reach an app that can't sign in */}
              {Background && <Background />}
            </AppDialogsProvider>
          </AppExtensionsContext.Provider>
        </BudgetProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}
