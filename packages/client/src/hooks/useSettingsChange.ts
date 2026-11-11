/**
 * Settings save as they change: this saves a change to them (the
 * balance is set apart, with set_balance).
 */

import { useCallback } from 'react';
import type { Settings } from '@budgetmint/contracts';
import { useBudgetChange, useCoreQuery } from '../data/BudgetContext';
import { useNotification } from '../contexts/NotificationContext';

export function useSettings(): [Settings, (change: (settings: Settings) => Settings) => void] {
  const { settings } = useCoreQuery('get_settings');
  const change = useBudgetChange();
  const { showError } = useNotification();
  const save = useCallback(
    (update: (settings: Settings) => Settings) => {
      try {
        change('save_settings', { settings: update(settings) });
      } catch (error) {
        showError((error as Error).message);
      }
    },
    [change, settings, showError]
  );
  return [settings, save];
}
