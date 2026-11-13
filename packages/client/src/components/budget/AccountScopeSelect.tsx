/**
 * Which bank account a page is of: every account together, or one. The
 * Overview and the Forecast share the choice. Nothing, with one account.
 */

import { MenuItem, TextField } from '@mui/material';
import { useAccounts, useAccountScope } from '../../data/BudgetContext';

const ALL = 'all';

export function AccountScopeSelect() {
  const { live, several } = useAccounts();
  const [scope, setScope] = useAccountScope();
  if (!several) return null;
  return (
    <TextField
      select
      size="small"
      label="Showing"
      value={scope ?? ALL}
      onChange={event => setScope(event.target.value === ALL ? null : event.target.value)}
      sx={{ minWidth: 180 }}
    >
      <MenuItem value={ALL}>All accounts</MenuItem>
      {live.map(account => (
        <MenuItem key={account.id} value={account.id}>
          {account.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
