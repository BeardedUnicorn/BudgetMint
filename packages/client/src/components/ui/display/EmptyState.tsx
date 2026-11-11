// Copied from TaskMint packages/client/src/components/ui/display/EmptyState.tsx @ 1623bee: keep the two in step.
/**
 * Empty State Component
 *
 * Shared placeholder for "nothing here yet" and "no results" moments: a
 * centered panel with an optional icon, a title, supporting copy, and an
 * optional call-to-action.
 */

import { ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** No panel of its own: for use inside a pane or card. */
  plain?: boolean;
}

export function EmptyState({ icon, title, description, action, plain = false }: EmptyStateProps) {
  return (
    <Paper
      elevation={plain ? 0 : 1}
      sx={{ p: plain ? 4 : 6, textAlign: 'center', ...(plain && { bgcolor: 'transparent' }) }}
    >
      {icon && <Box sx={{ color: 'text.secondary', mb: 1, '& svg': { fontSize: 48 } }}>{icon}</Box>}
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Paper>
  );
}
