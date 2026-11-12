/**
 * About BudgetMint: the version, whether it's the newest (the desktop
 * checks; Android and the web say how they update), what's new in it,
 * and the links a user looks for here: the release notes, reporting a
 * problem, the privacy policy and terms, and the source. Copy version
 * info puts what a bug report needs on the clipboard.
 */

import { Box, Button, Dialog, DialogActions, DialogContent, Divider, Link, Stack, Typography } from '@mui/material';
import changelog from '../../../../../CHANGELOG.md?raw';
import { useAppExtensions } from '../../app/extensions';
import { useBackDismiss } from '../../contexts/NavigationContext';
import { useNotification } from '../../contexts/NotificationContext';
import { getShell } from '../../shell';
import { APP_VERSION } from '../../utils/appVersion';
import { parseChangelog, type ReleaseNotes as Release } from '../../utils/changelog';
import { ReleaseNotes } from '../ui/display/ReleaseNotes';
import { Wordmark } from '../ui/display/Wordmark';

export const REPOSITORY = 'https://github.com/BeardedUnicorn/BudgetMint';
export const RELEASE_NOTES_URL = `${REPOSITORY}/blob/main/CHANGELOG.md`;
export const RELEASES_URL = `${REPOSITORY}/releases`;
export const LICENSE_URL = `${REPOSITORY}/blob/main/LICENSE`;
export const PRIVACY_URL = 'https://budgetmint.web.app/privacy';
export const TERMS_URL = 'https://budgetmint.web.app/terms';

/** A version's notes in `text` (a changelog), or null when it has none. */
export function releaseNotesFor(text: string, version: string): Release | null {
  return parseChangelog(text).find(release => release.version === version) ?? null;
}

/** This version's notes, from the changelog the release wrote before building it. */
const THIS_RELEASE = releaseNotesFor(changelog, APP_VERSION);

/** What's new in this version (nothing, for a build whose version the changelog hasn't yet). */
export function WhatsNew({ release }: { release: Release | null }) {
  if (!release) return null;
  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        What’s new in {release.version}
      </Typography>
      <Box sx={{ maxHeight: 220, overflowY: 'auto', pr: 1 }}>
        <ReleaseNotes release={release} />
      </Box>
    </Box>
  );
}

/** The system BudgetMint runs on, as a bug report wants it. */
export function systemName(userAgent = navigator.userAgent): string {
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Mac/.test(userAgent)) return 'macOS';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'another system';
}

/** "BudgetMint 2.1.0 · desktop · macOS": the version, the app and the system, for a bug report. */
export function versionInfo(): string {
  return `BudgetMint ${APP_VERSION} · ${getShell().capabilities.runtime} · ${systemName()}`;
}

/** A new issue on GitHub, with the version info under the space for what happened. */
export function reportProblemUrl(): string {
  return `${REPOSITORY}/issues/new?body=${encodeURIComponent(`What happened, and what you expected:\n\n\n---\n${versionInfo()}`)}`;
}

/** Android and the web update their own way: said where the desktop has its check. */
function HowItUpdates() {
  const { runtime } = getShell().capabilities;
  if (runtime === 'mobile') {
    return (
      <Typography variant="body2" color="text.secondary">
        Each release has an Android app to install over this one, which keeps you signed in.{' '}
        <Link href={RELEASES_URL} target="_blank" rel="noreferrer">
          Releases
        </Link>
      </Typography>
    );
  }
  if (runtime === 'web') {
    return (
      <Typography variant="body2" color="text.secondary">
        The web app is the newest version each time it opens online.
      </Typography>
    );
  }
  return null;
}

function OutLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} target="_blank" rel="noreferrer" variant="inherit">
      {children}
    </Link>
  );
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { AboutUpdates } = useAppExtensions();
  const { showSuccess, showError } = useNotification();
  useBackDismiss(open, onClose);

  const copy = () => {
    navigator.clipboard.writeText(versionInfo()).then(
      () => showSuccess('Version info copied'),
      () => showError('Couldn’t copy the version info')
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="about-title">
      <DialogContent>
        <Stack spacing={2}>
          <Stack spacing={0.5} sx={{ alignItems: 'center', textAlign: 'center', pt: 1 }}>
            <Wordmark height={40} />
            <Typography id="about-title" variant="h6" component="h2">
              About BudgetMint
            </Typography>
            <Typography variant="body2">Version {APP_VERSION}</Typography>
            <Typography variant="body2" color="text.secondary">
              Your bills, income and the balance ahead.
            </Typography>
          </Stack>

          {AboutUpdates ? <AboutUpdates /> : <HowItUpdates />}

          <WhatsNew release={THIS_RELEASE} />

          <Divider />
          <Stack
            component="nav"
            aria-label="About BudgetMint"
            direction="row"
            sx={{ flexWrap: 'wrap', columnGap: 2, rowGap: 1, typography: 'body2' }}
          >
            <OutLink href={RELEASE_NOTES_URL}>Release notes</OutLink>
            <OutLink href={reportProblemUrl()}>Report a problem</OutLink>
            <OutLink href={PRIVACY_URL}>Privacy policy</OutLink>
            <OutLink href={TERMS_URL}>Terms of use</OutLink>
            <OutLink href={REPOSITORY}>Source code</OutLink>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            © 2026 Mike Herold. Open source under the <OutLink href={LICENSE_URL}>MIT license</OutLink>.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={copy}>Copy version info</Button>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
