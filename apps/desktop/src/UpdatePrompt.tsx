// Adapted from TaskMint apps/desktop/src/UpdatePrompt.tsx @ 94318ec.
import { useEffect, useReducer } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material';
import { AdvancedProtectionHelp } from './AdvancedProtectionHelp';
import { APP_VERSION } from './appVersion';
import { sideloadingBlocked } from './tauriShell';
import { UpdateNotes, useReleasesSince } from './UpdateNotes';
import {
  automaticCheckDue,
  downloadsUpdates,
  updates,
  useUpdates,
  type AvailableUpdate,
  type DownloadProgress,
  type UpdateState,
} from './updates';

/** The launch check waits this long, so it doesn't compete with startup. */
export const FIRST_CHECK_DELAY_MS = 10_000;
/**
 * How often to see whether the daily check is due. A timer in a window
 * hidden to the tray can be held back, so the daily check isn't one long
 * timer: this one, and the window showing again, catch up on it.
 */
export const DUE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Checks at launch and then daily, unless they're off or this is a development build. */
function useAutomaticChecks(): void {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const check = () => void updates.check({ manual: false });
    const checkIfOn = () => updates.get().autoCheck && check();
    const checkIfDue = () => automaticCheckDue(Date.now()) && check();
    const onVisible = () => document.visibilityState === 'visible' && checkIfDue();

    const first = window.setTimeout(checkIfOn, FIRST_CHECK_DELAY_MS);
    const hourly = window.setInterval(checkIfDue, DUE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(hourly);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function Progress({ progress }: { progress: DownloadProgress | null }) {
  if (progress?.installing) {
    return (
      <>
        <LinearProgress aria-label="Installing the update" />
        <Typography variant="body2" sx={{ mt: 1 }}>
          Installing… BudgetMint restarts when it's done.
        </Typography>
      </>
    );
  }
  const total = progress?.total ?? null;
  const percent = progress && total ? Math.min(100, Math.round((progress.downloaded / total) * 100)) : null;
  return (
    <>
      <LinearProgress
        aria-label="Downloading the update"
        variant={percent === null ? 'indeterminate' : 'determinate'}
        value={percent ?? undefined}
      />
      <Typography variant="body2" sx={{ mt: 1 }}>
        {progress === null
          ? 'Starting the download…'
          : `Downloading… ${megabytes(progress.downloaded)}${total ? ` of ${megabytes(total)}` : ''}`}
      </Typography>
    </>
  );
}

/** "You have 4.8.0, 3 releases behind." */
function Behind({ update }: { update: AvailableUpdate }) {
  const since = useReleasesSince(update);
  return (
    <>
      You have {update.currentVersion}
      {since.length > 1 && `, ${since.length} releases behind`}.
    </>
  );
}

/** A check's outcome, in words: the menus' Check for Updates… shows it. */
function reportOf(state: UpdateState): { title: string; text: string | null } | null {
  switch (state.status) {
    case 'checking':
      return { title: 'Checking for updates…', text: null };
    case 'upToDate':
      return { title: 'BudgetMint is up to date', text: `You have ${APP_VERSION}, the newest version.` };
    case 'checkFailed':
      return { title: "Couldn't check for updates", text: state.error };
    default:
      return null;
  }
}

/** The outcome of a check the menus asked for (one that finds an update opens the update dialog instead). */
function CheckReport({ state }: { state: UpdateState }) {
  const report = reportOf(state);
  if (!report) return null;
  return (
    <Dialog open onClose={updates.closeReport} maxWidth="xs" fullWidth aria-labelledby="update-check-title">
      <DialogTitle id="update-check-title">{report.title}</DialogTitle>
      <DialogContent>
        {report.text === null ? (
          <LinearProgress aria-label="Checking for updates" />
        ) : (
          <DialogContentText>{report.text}</DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={updates.closeReport}>{report.text === null ? 'Close' : 'OK'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The update check (the client's Background extension): it runs on its own
 * at launch and daily, and asks before installing what it finds, or on a
 * phone, before downloading it. A phone with Advanced Protection on won't
 * install the download, so there it shows how to turn that off instead
 * (AdvancedProtectionHelp).
 */
export function UpdatePrompt() {
  useAutomaticChecks();
  const { update: state, reporting } = useUpdates();
  // Advanced Protection is the phone's setting: asked again on each render
  const [, recheck] = useReducer((count: number) => count + 1, 0);

  const open =
    (state.status === 'available' && state.open) || state.status === 'installing' || state.status === 'installFailed';
  if (!open) return reporting ? <CheckReport state={state} /> : null;

  const { update } = state;
  const installing = state.status === 'installing';
  const phone = downloadsUpdates();
  if (phone && sideloadingBlocked()) {
    return <AdvancedProtectionHelp update={update} onRecheck={recheck} onSkip={updates.skip} onClose={updates.later} />;
  }
  return (
    <Dialog
      open
      // Nothing closes it mid-install; otherwise closing is Later
      onClose={() => !installing && updates.later()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="update-dialog-title"
    >
      <DialogTitle id="update-dialog-title">BudgetMint {update.version} is available</DialogTitle>
      <DialogContent>
        <DialogContentText>
          <Behind update={update} />{' '}
          {phone
            ? 'BudgetMint downloads the update, and Android asks before installing it. You stay signed in, and your budget is in the cloud, so nothing is lost.'
            : 'BudgetMint downloads the update, installs it and restarts. Your budget is in the cloud, so nothing is lost.'}
        </DialogContentText>
        <UpdateNotes update={update} />
        {installing && (
          <Box sx={{ mt: 3 }}>
            <Progress progress={state.progress} />
          </Box>
        )}
        {state.status === 'installFailed' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {phone ? "The update couldn't be downloaded." : "The update couldn't be installed."} {state.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {/* Apart from the others, on the left */}
        <Button onClick={updates.skip} disabled={installing} sx={{ mr: 'auto' }}>
          Skip this version
        </Button>
        <Button onClick={updates.later} disabled={installing}>
          {state.status === 'installFailed' ? 'Close' : 'Later'}
        </Button>
        {phone && state.status === 'installFailed' && (
          <Button onClick={() => void updates.openInBrowser()}>Open in browser</Button>
        )}
        <Button
          variant="contained"
          onClick={() => void (phone ? updates.download() : updates.install())}
          disabled={installing}
        >
          {state.status === 'installFailed' ? 'Try again' : phone ? 'Download' : 'Download and install'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
