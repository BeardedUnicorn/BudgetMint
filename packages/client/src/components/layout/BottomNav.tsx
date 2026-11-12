/**
 * The phone's navigation, along the bottom where a thumb reaches: the pages
 * used most, one tap away, and More for the rest (the sidebar, slid in).
 * While it's there, it says how tall it is (BOTTOM_NAV_HEIGHT_VAR), so what
 * floats at the bottom (toasts) sits above it.
 */

import { useEffect } from 'react';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { MoreHoriz as MoreIcon } from '@mui/icons-material';
import { type SidebarView, VIEW_LABELS } from '../../navigation/views';
import { VIEW_ICONS } from '../../navigation/icons';

/** The pages on the bar; the others are under More. */
export const BAR_VIEWS: SidebarView[] = ['overview', 'bills', 'calendar', 'forecast'];

/** The bar's height (MUI's), above the gesture bar's room, as a CSS variable while it shows. */
export const BOTTOM_NAV_HEIGHT_VAR = '--bottom-nav-height';
const HEIGHT = '56px';

export function BottomNav({
  activeView,
  onViewChange,
  onMore,
}: {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onMore: () => void;
}) {
  const value = BAR_VIEWS.includes(activeView) ? activeView : 'more';
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty(BOTTOM_NAV_HEIGHT_VAR, HEIGHT);
    return () => {
      root.removeProperty(BOTTOM_NAV_HEIGHT_VAR);
    };
  }, []);
  return (
    <Paper
      component="nav"
      aria-label="Pages"
      square
      elevation={0}
      sx={{
        flexShrink: 0,
        borderTop: 1,
        borderColor: 'divider',
        // Clear of the gesture bar on an edge-to-edge screen
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation
        showLabels
        value={value}
        onChange={(_event, next: SidebarView | 'more') => (next === 'more' ? onMore() : onViewChange(next))}
        // Five share a phone's width: MUI's 80px each is more than a 375px screen has
        sx={{ bgcolor: 'background.paper', '& .MuiBottomNavigationAction-root': { minWidth: 0, px: 0.5 } }}
      >
        {BAR_VIEWS.map(view => {
          const Icon = VIEW_ICONS[view];
          return (
            <BottomNavigationAction
              key={view}
              value={view}
              label={VIEW_LABELS[view]}
              icon={<Icon />}
              aria-current={view === activeView ? 'page' : undefined}
            />
          );
        })}
        <BottomNavigationAction value="more" label="More" icon={<MoreIcon />} />
      </BottomNavigation>
    </Paper>
  );
}
