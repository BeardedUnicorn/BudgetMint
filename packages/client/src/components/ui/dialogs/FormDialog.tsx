// Adapted from TaskMint packages/client/src/components/ui/dialogs/FormDialog.tsx @ 1623bee: a click outside doesn't close it, and Escape asks before throwing a change away.
import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box } from '@mui/material';
import { FormDialogProps } from '../../../types/ui';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * A form in a dialog, with Cancel and Save. Rendered while it's open (the
 * caller mounts it for the item being edited).
 */
export function FormDialog({ onClose, title, children, onSubmit, dirty = false }: FormDialogProps) {
  const [asking, setAsking] = useState(false);
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <>
      <Dialog
        open
        // A click outside is too easy to make by accident to throw the form away; Escape is a key
        // pressed to close a menu or a date picker too, so with something changed it asks first
        onClose={(_event, reason) => {
          if (reason === 'backdropClick') return;
          if (dirty) setAsking(true);
          else onClose();
        }}
        maxWidth="sm"
        fullWidth
      >
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
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={onClose}
        title="Discard your changes?"
        message="What you changed here isn’t saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        // Focus starts on Keep editing: a second Escape or Enter keeps the form
        severity="error"
      />
    </>
  );
}
