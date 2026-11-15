// Adapted from TaskMint packages/client/src/components/pages/settings/AboutSettingsSection.tsx @ a2b0156.
import { useId, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  ButtonBase,
  Collapse,
  Link,
  Pagination,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Info as AboutIcon } from '@mui/icons-material';
import { useAppDialogs } from '../../../contexts/AppDialogsContext';
import { SettingsSection } from './SettingsSection';
import { PHONE } from '../../../theme/media';
import { APP_VERSION, compareVersions } from '../../../utils/appVersion';
import {
  groupReleasesByMajor,
  type MajorReleases,
  RELEASES,
  type ReleaseNotes as Release,
  summarizeRelease,
} from '../../../utils/changelog';
import { ReleaseNotes } from '../../ui/display/ReleaseNotes';
import { formatDayInYear } from '../../../utils/dates';

/** How many of a major version's releases show at once. */
const RELEASES_PER_PAGE = 5;

/** "Oct 23, 2026 – Nov 14, 2026": when a major version's releases came out. */
function releasedBetween(releases: Release[]): string | null {
  const dates = releases.flatMap(release => (release.date ? [release.date] : [])).sort();
  if (dates.length === 0) return null;
  const [first, last] = [dates[0], dates[dates.length - 1]];
  return first === last ? formatDayInYear(first) : `${formatDayInYear(first)} – ${formatDayInYear(last)}`;
}

/** One major version's releases: folded under a heading, a page at a time. */
function MajorVersion({ group, defaultOpen }: { group: MajorReleases; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  const id = useId();
  const { major, releases } = group;
  const pages = Math.ceil(releases.length / RELEASES_PER_PAGE);
  const shown = releases.slice((page - 1) * RELEASES_PER_PAGE, page * RELEASES_PER_PAGE);
  const summary = [`${releases.length} ${releases.length === 1 ? 'release' : 'releases'}`, releasedBetween(releases)]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
      <ButtonBase
        id={`${id}-heading`}
        aria-expanded={open}
        aria-controls={`${id}-releases`}
        onClick={() => setOpen(prev => !prev)}
        sx={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          px: 2,
          py: 1.5,
          textAlign: 'left',
          borderRadius: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle2" component="span" sx={{ display: 'block' }}>
            Version {major}
          </Typography>
          <Typography variant="body2" component="span" color="text.secondary" sx={{ display: 'block' }}>
            {summary}
          </Typography>
        </Box>
        <ExpandMoreIcon
          color="action"
          sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        />
      </ButtonBase>
      {/* Rendered once opened, so the whole history isn't on the page */}
      <Collapse in={open} unmountOnExit>
        <Box id={`${id}-releases`} role="group" aria-labelledby={`${id}-heading`} sx={{ px: 1, pb: 1 }}>
          {shown.map(release => (
            <Accordion
              key={release.version}
              disableGutters
              variant="outlined"
              slotProps={{ transition: { unmountOnExit: true } }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                id={`release-${release.version}`}
                aria-controls={`release-${release.version}-notes`}
                sx={{ '& .MuiAccordionSummary-content': { flexWrap: 'wrap', alignItems: 'baseline' } }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, mr: 2 }}>
                  {release.version}
                </Typography>
                {release.date && (
                  <Typography variant="body2" color="text.secondary">
                    {formatDayInYear(release.date)}
                  </Typography>
                )}
                {/* How much it changed: at the row's end, or on a phone under the version */}
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: 'auto', pl: 2, mr: 1, [PHONE]: { flexBasis: '100%', ml: 0, pl: 0 } }}
                >
                  {summarizeRelease(release)}
                </Typography>
              </AccordionSummary>
              <AccordionDetails id={`release-${release.version}-notes`}>
                <ReleaseNotes release={release} />
              </AccordionDetails>
            </Accordion>
          ))}
          {pages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
              <Pagination
                size="small"
                color="primary"
                count={pages}
                page={page}
                onChange={(_, next) => setPage(next)}
                aria-label={`Version ${major} releases, by page`}
              />
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * The app's version, with the way to About BudgetMint (which has what's new
 * in this version), and the releases before it: folded under their major
 * versions, the newest open.
 */
export function AboutSettingsSection() {
  const dialogs = useAppDialogs();
  const earlier = RELEASES.filter(release => compareVersions(release.version, APP_VERSION) < 0);

  return (
    <SettingsSection title="About" icon={<AboutIcon />}>
      <Typography variant="body2">BudgetMint {APP_VERSION}: your bills, income and the balance ahead.</Typography>
      <Typography variant="body2" color="text.secondary">
        Open source under the MIT license.{' '}
        <Link href="https://github.com/BeardedUnicorn/BudgetMint" target="_blank" rel="noreferrer">
          Source and releases
        </Link>
      </Typography>
      <Button variant="outlined" sx={{ mt: 2 }} onClick={() => dialogs.open('about')}>
        About BudgetMint…
      </Button>

      {earlier.length > 0 && (
        <>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>
            Earlier releases
          </Typography>
          {groupReleasesByMajor(earlier).map((group, index) => (
            <MajorVersion key={group.major} group={group} defaultOpen={index === 0} />
          ))}
        </>
      )}
    </SettingsSection>
  );
}
