/**
 * Signing out, asked first wherever it's offered (Settings, the account
 * menu, the menu bar and the tray): the budget stays in the account, and
 * this device's copy goes. Changes the cloud hasn't got yet would be lost,
 * so it says when there are some.
 */

import { useBudget } from '../../data/BudgetContext';
import { useNotification } from '../../contexts/NotificationContext';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';

const KEPT = 'Your budget stays in your BudgetMint account: sign in again, here or on another device, to see it.';
const ERASED = 'This device’s copy of it is erased.';
const UNSAVED =
  'Some changes haven’t reached the cloud yet, and would be lost. Wait until they have (the sidebar stops saying Saving…), or sign out anyway.';

export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, view } = useBudget();
  const { showError } = useNotification();
  const signOut = async () => {
    try {
      await session.signOut();
    } catch (error) {
      showError((error as Error).message);
      throw error;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={signOut}
      title={view.saving ? 'Sign out before your changes are saved?' : 'Sign out of BudgetMint?'}
      message={view.saving ? `${UNSAVED} ${KEPT} ${ERASED}` : `${KEPT} ${ERASED}`}
      confirmLabel={view.saving ? 'Sign out anyway' : 'Sign out'}
    />
  );
}
