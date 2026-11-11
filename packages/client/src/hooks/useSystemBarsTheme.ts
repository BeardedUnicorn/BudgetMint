// Adapted from TaskMint packages/client/src/hooks/useSystemBarsTheme.ts @ 1623bee.
/** Android's status and navigation bars follow the app's light or dark theme. */

import { useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getShell } from '../shell';

export function useSystemBarsTheme(): void {
  const { isDark } = useTheme();
  useEffect(() => {
    getShell().platform.systemBars?.setDark(isDark);
  }, [isDark]);
}
