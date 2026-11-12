// Adapted from TaskMint packages/client/src/components/layout/Sidebar.tsx @ 1623bee.
import { ReactNode } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { viewShortcut } from '../../hooks/useKeyboardShortcuts';
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  ButtonBase,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Menu as MenuIcon, ChevronLeft as ChevronLeftIcon } from '@mui/icons-material';

import { VIEW_ICONS } from '../../navigation/icons';
import { VIEWS, VIEW_LABELS, type SidebarView } from '../../navigation/views';
import { getShell } from '../../shell';
import { HOVER } from '../../theme/media';
import { Wordmark } from '../ui/display/Wordmark';

export type { SidebarView };

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  /** Pinned to the bottom of the sidebar (today's balance). */
  footer?: (collapsed: boolean) => ReactNode;
  /**
   * `temporary` is the phone's menu: it slides in over the page while
   * `open`, always expanded (no collapse toggle, no shortcut hints), and
   * picking a page or tapping outside it calls `onClose`.
   */
  variant?: 'permanent' | 'temporary';
  open?: boolean;
  onClose?: () => void;
}

/** Whether the sidebar is collapsed: remembered across launches (the menu bar's View menu toggles it too). */
export const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

const navigationItems = VIEWS.map(id => ({ id, label: VIEW_LABELS[id], icon: VIEW_ICONS[id] }));

export function Sidebar({
  activeView,
  onViewChange,
  footer,
  variant = 'permanent',
  open = false,
  onClose,
}: SidebarProps) {
  const inBrowser = getShell().capabilities.runtime === 'web';
  const [collapsedSetting, setIsCollapsed] = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false);
  const temporary = variant === 'temporary';
  const isCollapsed = !temporary && collapsedSetting;

  return (
    <Drawer
      variant={variant}
      {...(temporary
        ? {
            open,
            onClose,
            // Clear of the status and navigation bars on an edge-to-edge screen
            slotProps: {
              paper: {
                sx: {
                  width: SIDEBAR_WIDTH,
                  maxWidth: 'calc(100vw - 56px)',
                  pt: 'env(safe-area-inset-top)',
                  pb: 'env(safe-area-inset-bottom)',
                  backgroundColor: 'background.paper',
                },
              },
            },
          }
        : {
            sx: {
              width: isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH,
                boxSizing: 'border-box',
                backgroundColor: 'background.paper',
                borderRight: '1px solid',
                borderColor: 'divider',
                transition: theme =>
                  theme.transitions.create('width', {
                    easing: theme.transitions.easing.sharp,
                    duration: theme.transitions.duration.enteringScreen,
                  }),
              },
            },
          })}
    >
      {/* Header with Title and Toggle Button */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          flexDirection: isCollapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: isCollapsed ? 1 : 0.5,
        }}
      >
        {!isCollapsed && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* The name goes home, as on most sites */}
            <ButtonBase
              aria-label="BudgetMint home"
              onClick={() => {
                onViewChange('overview');
                onClose?.();
              }}
              sx={{ borderRadius: 1 }}
            >
              <Wordmark height={28} />
            </ButtonBase>
          </Box>
        )}
        {!temporary && (
          <IconButton
            onClick={() => setIsCollapsed(!isCollapsed)}
            size="small"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <MenuIcon /> : <ChevronLeftIcon />}
          </IconButton>
        )}
      </Box>

      <Divider />

      <List sx={{ pt: 1 }}>
        {navigationItems.map(item => {
          const IconComponent = item.icon;
          const isSelected = activeView === item.id;

          const listItemButton = (
            <ListItemButton
              key={item.id}
              selected={isSelected}
              aria-current={isSelected ? 'page' : undefined}
              onClick={() => {
                onViewChange(item.id);
                onClose?.();
              }}
              aria-label={item.label}
              sx={{
                mx: 1,
                borderRadius: 1,
                '&.Mui-selected': {
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': {
                    backgroundColor: 'primary.dark',
                  },
                  '& .MuiListItemIcon-root': {
                    color: 'primary.contrastText',
                  },
                },
                [HOVER]: {
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                },
              }}
            >
              <ListItemIcon
                sx={
                  isCollapsed
                    ? {
                        minWidth: 'auto',
                        pr: 0,
                        justifyContent: 'center',
                      }
                    : {}
                }
              >
                <IconComponent />
              </ListItemIcon>
              {!isCollapsed && <ListItemText primary={item.label} />}
            </ListItemButton>
          );

          // No keyboard shortcuts to hint at on a phone, nor in a browser (which keeps them for its tabs)
          if (temporary || (inBrowser && !isCollapsed)) return listItemButton;

          // The page's shortcut on hover; its name too when collapsed
          const shortcut = viewShortcut(item.id);
          return (
            <Tooltip
              key={item.id}
              title={inBrowser ? item.label : isCollapsed ? `${item.label}  ${shortcut}` : shortcut}
              placement="right"
              enterDelay={isCollapsed ? 100 : 600}
              // The label already names the button; the shortcut is extra
              describeChild
            >
              {listItemButton}
            </Tooltip>
          );
        })}
      </List>

      {footer && (
        <Box
          sx={{
            mt: 'auto',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: isCollapsed ? 'center' : 'stretch',
            // Nothing to show: no padding either
            '&:empty': { p: 0 },
          }}
        >
          {footer(isCollapsed)}
        </Box>
      )}
    </Drawer>
  );
}
