// Adapted from TaskMint packages/client/src/components/layout/CompactTopBar.tsx @ 1623bee.
import { AppBar, IconButton, Toolbar, Typography } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';

interface CompactTopBarProps {
  /** The page on screen. */
  title: string;
  onOpenNavigation: () => void;
}

/**
 * The phone's stand-in for the sidebar: a menu button that slides the
 * sidebar in, and the page's name.
 */
export function CompactTopBar({ title, onOpenNavigation }: CompactTopBarProps) {
  return (
    <AppBar
      position="static"
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
      <Toolbar sx={{ gap: 1, px: 1 }}>
        <IconButton aria-label="Open navigation" onClick={onOpenNavigation}>
          <MenuIcon />
        </IconButton>
        <Typography component="div" variant="h6" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
          {title}
        </Typography>
      </Toolbar>
    </AppBar>
  );
}
