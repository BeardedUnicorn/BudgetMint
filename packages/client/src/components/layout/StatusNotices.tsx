/**
 * Notices above every page: offline, data from a newer BudgetMint or that
 * can't be read, and the data deleted on another device.
 */

import { Alert, Box, Button } from '@mui/material';
import { useBudget } from '../../data/BudgetContext';

export function StatusNotices() {
  const { session, view } = useBudget();
  if (!view.offline && view.held === 0 && view.unreadable === 0 && !view.resetElsewhere) return null;
  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, maxWidth: 1200, width: '100%', mx: 'auto', boxSizing: 'border-box' }}>
      {view.offline && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Offline: showing what’s on this device. Changes go once you’re back online.
        </Alert>
      )}
      {view.held > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Some of your data is from a newer BudgetMint, and isn’t shown here. Update BudgetMint.
        </Alert>
      )}
      {view.unreadable > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {view.unreadable === 1 ? 'One of your records' : `${view.unreadable} of your records`} can’t be read here, so{' '}
          {view.unreadable === 1 ? 'it’s' : 'they’re'} left out. Updating BudgetMint may help.
        </Alert>
      )}
      {view.resetElsewhere && (
        <Alert
          severity="info"
          sx={{ mb: 1 }}
          action={
            <Button color="inherit" size="small" onClick={session.dismissReset}>
              OK
            </Button>
          }
        >
          Your BudgetMint data was deleted on another device, so this one starts again.
        </Alert>
      )}
    </Box>
  );
}
