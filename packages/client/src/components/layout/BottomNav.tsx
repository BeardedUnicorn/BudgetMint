/**
 * The phone's navigation, along the bottom where a thumb reaches: the pages
 * used most, one tap away, and More for the rest (the sidebar, slid in).
 */

import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { MoreHoriz as MoreIcon } from '@mui/icons-material';
import { type SidebarView, VIEW_LABELS } from '../../navigation/views';
import { VIEW_ICONS } from './Sidebar';

/** The pages on the bar; the others are under More. */
export const BAR_VIEWS: SidebarView[] = ['overview', 'bills', 'calendar', 'forecast'];

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
        sx={{ bgcolor: 'background.paper' }}
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
