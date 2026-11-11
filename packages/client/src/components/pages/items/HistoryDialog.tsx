/**
 * An item's occurrences over the past year and the next three months,
 * newest first, each open to change.
 */

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { ItemView } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { addDays } from '../../../utils/dates';
import { OccurrenceList } from '../../budget/OccurrenceList';

export function HistoryDialog({ view, today, onClose }: { view: ItemView; today: string; onClose: () => void }) {
  const history = useCoreQuery('get_item_history', {
    itemId: view.item.id,
    from: addDays(today, -365),
    to: addDays(today, 92),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{view.item.name}</DialogTitle>
      <DialogContent>
        {history.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing in the past year or the next three months.
          </Typography>
        ) : (
          <OccurrenceList occurrences={history} today={today} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
