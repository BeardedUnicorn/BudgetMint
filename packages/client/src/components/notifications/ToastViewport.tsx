// Adapted from TaskMint packages/client/src/components/notifications/ToastViewport.tsx @ 1623bee.
/**
 * The toasts, stacked in the bottom-right corner (newest at the bottom).
 * Clicking elsewhere never dismisses one; Escape dismisses the toast that has
 * keyboard focus. A toast's time stops while the pointer is on it or it has
 * focus.
 */

import { memo, KeyboardEvent } from 'react';
import { Box, Button, Collapse, Fade, IconButton, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  CheckCircleOutlined,
  Close as CloseIcon,
  ErrorOutlined,
  InfoOutlined,
  WarningAmberOutlined,
} from '@mui/icons-material';

export type Severity = 'success' | 'info' | 'warning' | 'error';

/** A toast's button: it acts, and the toast goes. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  severity: Severity;
  title?: string;
  message: string;
  actions: ToastAction[];
  /** On its way out (animating). */
  exiting: boolean;
}

type ToastModel = Toast;
type NotificationAction = ToastAction;

const ICONS: Record<Severity, typeof InfoOutlined> = {
  success: CheckCircleOutlined,
  info: InfoOutlined,
  warning: WarningAmberOutlined,
  error: ErrorOutlined,
};

interface ToastProps {
  toast: ToastModel;
  onDismiss: (id: string) => void;
  onAction: (action: NotificationAction, toastId: string) => void;
  onHold: (id: string) => void;
  onRelease: (id: string) => void;
}

const ToastCard = memo(function ToastCard({ toast, onDismiss, onAction, onHold, onRelease }: ToastProps) {
  const theme = useTheme();
  const color = theme.palette[toast.severity].main;
  const Icon = ICONS[toast.severity];
  // Errors and warnings interrupt a screen reader (an alert is read when it
  // appears); the rest wait their turn, read by the viewport's live region
  const urgent = toast.severity === 'error' || toast.severity === 'warning';

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss(toast.id);
    }
  };

  return (
    <Paper
      elevation={8}
      {...(urgent ? { role: 'alert', 'aria-live': 'assertive' } : { role: 'group' })}
      aria-atomic="true"
      tabIndex={-1}
      // A mouse resting on it holds it; a tap mustn't hold it until the
      // next tap somewhere else
      onPointerEnter={event => event.pointerType === 'mouse' && onHold(toast.id)}
      onPointerLeave={event => event.pointerType === 'mouse' && onRelease(toast.id)}
      onFocus={() => onHold(toast.id)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onRelease(toast.id);
        }
      }}
      onKeyDown={handleKeyDown}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        pl: 2,
        pr: 1,
        py: 1.5,
        borderLeft: `4px solid ${color}`,
        backgroundImage: 'none',
        bgcolor: 'background.paper',
        pointerEvents: 'auto',
        outline: 'none',
        '&:focus-visible': { boxShadow: `0 0 0 2px ${alpha(color, 0.6)}` },
      }}
    >
      <Icon sx={{ color, mt: '2px', flexShrink: 0 }} fontSize="small" aria-hidden />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
            {toast.title}
          </Typography>
        )}
        <Typography
          variant="body2"
          color={toast.title ? 'text.secondary' : 'text.primary'}
          sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
        >
          {toast.message}
        </Typography>
        {toast.actions.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, ml: -1 }}>
            {toast.actions.map(action => (
              <Button
                key={action.label}
                size="small"
                onClick={() => onAction(action, toast.id)}
                sx={{ color, minHeight: 28, py: 0.25, fontWeight: 600 }}
              >
                {action.label}
              </Button>
            ))}
          </Stack>
        )}
      </Box>
      <IconButton
        size="small"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        sx={{ minWidth: 32, minHeight: 32, mt: -0.5 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
});

interface ToastViewportProps {
  toasts: readonly ToastModel[];
  onDismiss: (id: string) => void;
  onAction: (action: NotificationAction, toastId: string) => void;
  onHold: (id: string) => void;
  onRelease: (id: string) => void;
}

export function ToastViewport({ toasts, ...handlers }: ToastViewportProps) {
  return (
    <Stack
      component="section"
      aria-label="Notifications"
      // The live region is here, always in the page: a screen reader reads
      // what's added to a region it already knows, but often not a region
      // that arrives together with its text (as each toast would be)
      aria-live="polite"
      aria-relevant="additions"
      spacing={0}
      sx={{
        position: 'fixed',
        right: 16,
        // Above the gesture bar on an edge-to-edge phone screen, and the bottom bar there (BottomNav)
        bottom: 'calc(16px + var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom))',
        zIndex: theme => theme.zIndex.snackbar,
        alignItems: 'flex-end',
        // The empty area between toasts mustn't swallow clicks
        pointerEvents: 'none',
      }}
    >
      {toasts.map(toast => (
        <Collapse key={toast.id} in={!toast.exiting} appear timeout={200}>
          <Fade in={!toast.exiting} appear timeout={200}>
            <Box sx={{ pt: 1 }}>
              <ToastCard toast={toast} {...handlers} />
            </Box>
          </Fade>
        </Collapse>
      ))}
    </Stack>
  );
}
