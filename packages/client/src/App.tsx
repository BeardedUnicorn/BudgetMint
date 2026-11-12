/**
 * The app: signing in until someone is, onboarding until the settings are
 * saved, then the pages in TaskMint's frame: the sidebar (a slide-in menu
 * and a top bar on a phone) and the page beside it.
 */

import { ComponentType, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, CssBaseline, Stack } from '@mui/material';
import type { CoreClient } from './core';
import type { BudgetSession } from './cloud/session';
import { AppExtensionsContext } from './app/extensions';
import { AuthLayout } from './components/auth/AuthLayout';
import { SignInForm } from './components/auth/SignInForm';
import { BalanceFooter } from './components/layout/BalanceFooter';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { ShortcutsDialog } from './components/layout/ShortcutsDialog';
import { CompactTopBar } from './components/layout/CompactTopBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusNotices } from './components/layout/StatusNotices';
import { Onboarding } from './components/onboarding/Onboarding';
import { CalendarPage } from './components/pages/calendar/CalendarPage';
import { ForecastPage } from './components/pages/forecast/ForecastPage';
import { ItemsPage } from './components/pages/items/ItemsPage';
import { OverviewPage } from './components/pages/overview/OverviewPage';
import { ReportsPage } from './components/pages/reports/ReportsPage';
import { SavingsPage } from './components/pages/savings/SavingsPage';
import { SettingsPage } from './components/pages/settings/SettingsPage';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { BudgetProvider, useBudget, useCoreQuery } from './data/BudgetContext';
import { useCompactLayout } from './hooks/useCompactLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useReminders } from './hooks/useReminders';
import { useSystemBarsTheme } from './hooks/useSystemBarsTheme';
import { useTrayStatus } from './hooks/useTrayStatus';
import { VIEW_LABELS, type SidebarView } from './navigation/views';
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
      return (
        <AuthLayout title="Sign in to BudgetMint">
          <SignInForm engine={session} onPhone={getShell().capabilities.runtime === 'mobile'} />
        </AuthLayout>
      );
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
  return saved ? (
    <NavigationProvider persist>
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
 * system bars, the pages opened (for usage analytics) and shortcuts.
 */
function BackgroundJobs() {
  const [listing, setListing] = useState(false);
  useReminders();
  useTrayStatus();
  useSystemBarsTheme();
  useAnalyticsScreens();
  useKeyboardShortcuts(getShell().capabilities.runtime === 'web', () => setListing(true));
  return <ShortcutsDialog open={listing} onClose={() => setListing(false)} />;
}

function AppShell() {
  const { view: activeView, navigate } = useNavigation();
  const compact = useCompactLayout();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const Page = PAGES[activeView];
  const footer = (collapsed: boolean) => <BalanceFooter collapsed={collapsed} />;

  return (
    <>
      <BackgroundJobs />
      {/* dvh: a phone's browser bars and keyboard don't hide the bottom */}
      <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex' }}>
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
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
            pb: 'env(safe-area-inset-bottom)',
          }}
        >
          {compact && (
            <CompactTopBar title={VIEW_LABELS[activeView]} onOpenNavigation={() => setNavigationOpen(true)} />
          )}
          <StatusNotices />
          <Page />
        </Box>
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
            {/* A page that fails says so, and the shell's work below goes on */}
            <ErrorBoundary>
              <Gate />
            </ErrorBoundary>
            {/* The shell's own work (the desktop's update check) runs whatever
                the phase, so an update can reach an app that can't sign in */}
            {Background && <Background />}
          </AppExtensionsContext.Provider>
        </BudgetProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}
