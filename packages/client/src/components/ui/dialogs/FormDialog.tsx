// Copied from TaskMint packages/client/src/components/ui/dialogs/FormDialog.tsx @ 1623bee: keep the two in step.
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box } from '@mui/material';
import { FormDialogProps } from '../../../types/ui';

/**
 * A form in a dialog, with Cancel and Save. Rendered while it's open (the
 * caller mounts it for the item being edited).
 */
export function FormDialog({ onClose, title, children, onSubmit }: FormDialogProps) {
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      {/* noValidate: dialogs do their own validation and render MUI helper
          text; native constraint bubbles would block submit before it runs. */}
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{title}</DialogTitle>

        <DialogContent>
          <Box sx={{ pt: 1 }}>{children}</Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="secondary">
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="primary">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
