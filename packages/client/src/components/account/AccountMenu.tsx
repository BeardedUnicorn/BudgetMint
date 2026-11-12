/**
 * Who's signed in, at the sidebar's foot (and the phone's menu): their
 * initial, with the email beside it unless the sidebar is collapsed. Its
 * menu opens the account's settings or About, and signs out.
 */

import { useState } from 'react';
import { Avatar, Box, ButtonBase, Divider, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { UnfoldMore as OpenIcon } from '@mui/icons-material';
import { useAppDialogs } from '../../contexts/AppDialogsContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useBudget } from '../../data/BudgetContext';

interface AccountMenuProps {
  collapsed: boolean;
  /** After an item is picked: the phone's menu closes. */
  onPicked?: () => void;
}

export function AccountMenu({ collapsed, onPicked }: AccountMenuProps) {
  const { view } = useBudget();
  const { navigate } = useNavigation();
  const dialogs = useAppDialogs();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const email = view.user?.email ?? 'your account';
  const label = `Account: ${email}`;
  const initial = (view.user?.email?.[0] ?? '?').toUpperCase();
  const avatar = (
    <Avatar sx={{ width: 32, height: 32, fontSize: '0.9rem', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
      {initial}
    </Avatar>
  );
  const pick = (action: () => void) => () => {
    setAnchor(null);
    onPicked?.();
    action();
  };

  return (
    // Above the balance, with room between
    <Box sx={{ mb: 1.5 }}>
      {collapsed ? (
        <Tooltip title={email} placement="right">
          <IconButton aria-label={label} onClick={event => setAnchor(event.currentTarget)}>
            {avatar}
          </IconButton>
        </Tooltip>
      ) : (
        <ButtonBase
          aria-label={label}
          onClick={event => setAnchor(event.currentTarget)}
          sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, p: 1, borderRadius: 1, textAlign: 'left' }}
        >
          {avatar}
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {email}
          </Typography>
          <OpenIcon fontSize="small" color="action" />
        </ButtonBase>
      )}
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <Typography variant="caption" color="text.secondary">
            Signed in as
          </Typography>
          <Typography variant="body2" noWrap>
            {email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={pick(() => navigate('settings', { section: 'account' }))}>Account settings</MenuItem>
        <MenuItem onClick={pick(() => dialogs.open('about'))}>About BudgetMint</MenuItem>
        <Divider />
        <MenuItem onClick={pick(() => dialogs.open('signOut'))}>Sign out…</MenuItem>
      </Menu>
    </Box>
  );
}
