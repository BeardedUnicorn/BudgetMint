// Adapted from TaskMint packages/client/src/components/layout/CompactTopBar.tsx @ 1623bee: no menu button (the bottom bar has More), and whether changes are still on their way.
import { AppBar, Chip, Toolbar, Typography } from '@mui/material';
import { useBudget } from '../../data/BudgetContext';

interface CompactTopBarProps {
  /** The page on screen. */
  title: string;
}

/**
 * The phone's top: the page's name, and (the sidebar's foot being out of
 * sight) whether changes are still being saved, or it's offline.
 */
export function CompactTopBar({ title }: CompactTopBarProps) {
  const { view } = useBudget();
  const status = view.offline ? 'Offline' : view.saving ? 'Saving…' : null;
  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        // Below the status bar on an edge-to-edge screen
        pt: 'env(safe-area-inset-top)',
      }}
    >
      <Toolbar sx={{ gap: 1, px: 2 }}>
        <Typography component="div" variant="h6" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
          {title}
        </Typography>
        {status && <Chip size="small" label={status} variant="outlined" />}
      </Toolbar>
    </AppBar>
  );
}
