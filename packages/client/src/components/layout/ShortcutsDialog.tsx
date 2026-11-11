/**
 * Every keyboard shortcut (⌘/ opens it), so they aren't only in the
 * sidebar's tooltips.
 */

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@mui/material';
import { modifierLabel } from '../../hooks/useKeyboardShortcuts';
import { VIEW_LABELS, VIEWS } from '../../navigation/views';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const key = modifierLabel();
  const rows: [string, string][] = [
    ...VIEWS.map((view, index): [string, string] => [`${key}${index + 1}`, `Open ${VIEW_LABELS[view]}`]),
    [`${key},`, 'Open Settings'],
    [`${key}N`, 'Add a bill (income, on the Income page)'],
    [`${key}/`, 'These shortcuts'],
  ];
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableBody>
            {rows.map(([keys, does]) => (
              <TableRow key={keys}>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ fontFamily: '"Roboto Mono", monospace', whiteSpace: 'nowrap' }}
                >
                  {keys}
                </TableCell>
                <TableCell>{does}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
