// Adapted from TaskMint packages/client/src/components/ui/display/ReleaseNotes.tsx @ a2b0156.
import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';
import type { ReleaseNotes as Release } from '../../../utils/changelog';
import { formatDayInYear } from '../../../utils/dates';

/** Text with its **bold** spans in bold (the changelog's Markdown). */
function Strong({ text }: { text: string }) {
  return (
    <>
      {text
        .split('**')
        .map((part, index) =>
          index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
        )}
    </>
  );
}

/**
 * A Markdown link as its label alone. The app opens only its own named
 * links, and notes can come from the update feed, so a link isn't one here.
 */
const withoutLinks = (text: string) => text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');

/** A bullet's text, with `code` spans set in monospace, **bold** in bold, and links as their labels. */
function NoteText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) =>
        index % 2 === 1 ? (
          <Box key={index} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
            {part}
          </Box>
        ) : (
          <Strong key={index} text={withoutLinks(part)} />
        )
      )}
    </>
  );
}

/**
 * A release's intro, then its bullets under their headings (Added, Fixed…).
 * `headings` is those headings' level: h5 under a heading for the release.
 */
export function ReleaseNotes({ release, headings = 'h4' }: { release: Release; headings?: 'h4' | 'h5' }) {
  return (
    <Box>
      {release.intro.map(paragraph => (
        <Typography key={paragraph} variant="body2" sx={{ mb: 1 }}>
          <NoteText text={paragraph} />
        </Typography>
      ))}
      {release.groups.map(({ type, items }, index) => (
        <Box key={`${type}-${index}`} sx={{ mb: 1.5 }}>
          {type && (
            <Typography variant="subtitle2" component={headings} sx={{ fontWeight: 600 }}>
              {type}
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {items.map(item => (
              <Typography key={item} component="li" variant="body2" sx={{ mb: 0.5 }}>
                <NoteText text={item} />
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** Several releases' notes, each under its version and when it came out. */
export function ReleaseNotesList({ releases }: { releases: Release[] }) {
  return (
    <>
      {releases.map(release => (
        <Box key={release.version} component="section" aria-label={release.version} sx={{ mb: 2 }}>
          <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 600, mb: 0.5 }}>
            {release.version}
            {release.date && (
              <Typography variant="body2" component="span" color="text.secondary">
                {` · ${formatDayInYear(release.date)}`}
              </Typography>
            )}
          </Typography>
          <ReleaseNotes release={release} headings="h5" />
        </Box>
      ))}
    </>
  );
}
