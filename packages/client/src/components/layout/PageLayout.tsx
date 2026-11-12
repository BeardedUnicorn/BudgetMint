// Adapted from TaskMint packages/client/src/components/layout/PageLayout.tsx @ 1623bee (without PageSkeleton: no page loads lazily).
/**
 * The frame every page shares: a centered column (PageContainer) under a
 * header with the page's title, a line about it, and its main actions
 * (PageHeader).
 */

import { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { PHONE } from '../../theme/media';
import { VISUALLY_HIDDEN } from '../ui/visuallyHidden';

/** Widest a page's content gets. */
export const PAGE_MAX_WIDTH = 1200;

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        p: { xs: 2, sm: 3 },
        width: '100%',
        maxWidth: PAGE_MAX_WIDTH,
        mx: 'auto',
      }}
    >
      {children}
    </Box>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** The page's main buttons, on the right. */
  actions?: ReactNode;
  /** Below the title: tabs, a status line. */
  children?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  // On a phone the top bar names the page: the title is for screen readers
  // there (its subtitle shows, smaller), and a header with nothing else to
  // show takes no room
  const phoneShowsRow = Boolean(actions || subtitle);
  return (
    <Box component="header" sx={{ mb: 3, flexShrink: 0, [PHONE]: { mb: phoneShowsRow || children ? 2 : 0 } }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          ...(!phoneShowsRow && { [PHONE]: VISUALLY_HIDDEN }),
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 600, [PHONE]: VISUALLY_HIDDEN }}>
              {title}
            </Typography>
          </Box>
          {subtitle && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, [PHONE]: { mt: 0, typography: 'caption' } }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>}
      </Box>
      {children}
    </Box>
  );
}
