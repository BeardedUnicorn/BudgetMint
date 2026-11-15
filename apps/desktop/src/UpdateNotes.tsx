// Adapted from TaskMint apps/desktop/src/UpdateNotes.tsx @ a2b0156.
import { useMemo, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import {
  combineReleases,
  hasUserFacingChanges,
  parseReleaseSection,
  ReleaseNotes,
  ReleaseNotesList,
  releasesBetween,
} from '@budgetmint/client/ui';
import type { AvailableUpdate } from './updates';

/** From this many releases behind, the notes start out by type: what changed matters more than when. */
export const BY_TYPE_FROM = 5;

type View = 'release' | 'type';

/** The releases an update brings: every one since the version running now, newest first. */
export function useReleasesSince(update: AvailableUpdate) {
  return useMemo(
    () => (update.changelog ? releasesBetween(update.changelog, update.currentVersion, update.version) : []),
    [update.changelog, update.currentVersion, update.version]
  );
}

/**
 * What the update brings. Some releases behind, that's each release since
 * this version (the feed's changelog), without those that changed nothing
 * a user would see: by release, or all together by type (Added, Fixed…),
 * which is how it starts from BY_TYPE_FROM releases. Otherwise the new
 * release's own notes.
 */
export function UpdateNotes({ update }: { update: AvailableUpdate }) {
  const since = useReleasesSince(update);
  const latest = useMemo(
    () => (update.notes ? parseReleaseSection(update.version, update.notes) : null),
    [update.version, update.notes]
  );
  const [chosen, setChosen] = useState<View | null>(null);
  const releases = since.filter(hasUserFacingChanges);
  const several = since.length > 1 && releases.length > 0;
  if (!several && !latest) return null;
  const view = chosen ?? (since.length >= BY_TYPE_FROM ? 'type' : 'release');
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600, mr: 'auto' }}>
          {several ? `What's new since ${update.currentVersion}` : "What's new"}
        </Typography>
        {several && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            // (Pressing the one already chosen keeps it)
            onChange={(_, next: View | null) => next && setChosen(next)}
            aria-label="How the notes are grouped"
          >
            <ToggleButton value="release" sx={{ py: 0.25, textTransform: 'none' }}>
              By release
            </ToggleButton>
            <ToggleButton value="type" sx={{ py: 0.25, textTransform: 'none' }}>
              By type
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
        {!several ? (
          latest && <ReleaseNotes release={latest} />
        ) : view === 'type' ? (
          <ReleaseNotes release={combineReleases(releases)} />
        ) : (
          <ReleaseNotesList releases={releases} />
        )}
      </Box>
    </Box>
  );
}
