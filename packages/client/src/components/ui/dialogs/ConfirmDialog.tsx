// Adapted from TaskMint packages/client/src/components/ui/dialogs/ConfirmDialog.tsx @ 1623bee: Back closes it.
import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useBackDismiss } from '../../../contexts/NavigationContext';
import { ConfirmDialogProps } from '../../../types/ui';

/**
 * Reusable confirmation dialog component
 * Provides consistent styling for delete confirmations and other destructive actions.
 * For a destructive (error) confirmation, focus starts on Cancel so Enter
 * can't confirm by accident. An async onConfirm keeps the dialog open, with
 * its buttons disabled, until it settles.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'warning',
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  // Back cancels, as Cancel does (not while it's confirming)
  useBackDismiss(open && !isConfirming, onClose);

  const handleConfirm = async () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) {
      onClose();
      return;
    }
    setIsConfirming(true);
    try {
      await result;
      onClose();
    } catch {
      // The caller reports the failure; stay open so the user can retry.
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Dialog open={open} onClose={isConfirming ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        <Alert severity={severity} sx={{ mb: 2 }}>
          <DialogContentText component="div">{message}</DialogContentText>
        </Alert>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="secondary" disabled={isConfirming} autoFocus={severity === 'error'}>
          {cancelLabel}
        </Button>
        <Button
          onClick={() => void handleConfirm()}
          variant="contained"
          color={severity}
          disabled={isConfirming}
          autoFocus={severity !== 'error'}
          startIcon={isConfirming ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
