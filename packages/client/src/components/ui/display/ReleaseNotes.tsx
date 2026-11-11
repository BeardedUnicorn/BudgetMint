// Copied from TaskMint packages/client/src/components/ui/display/ReleaseNotes.tsx @ 1623bee.
import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';
import type { ReleaseNotes as Release } from '../../../utils/changelog';

/** A bullet's text, with `code` spans set in monospace. */
function NoteText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) =>
        index % 2 === 1 ? (
          <Box key={index} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
            {part}
          </Box>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

/** A release's intro, then its bullets under their headings (Added, Fixed…). */
export function ReleaseNotes({ release }: { release: Release }) {
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
            <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 600 }}>
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
