// Adapted from TaskMint packages/client/src/hooks/useSystemBottomInset.ts @ 5c802e7: every edge, not only the bottom (BudgetMint's wide layout has no top bar, and a phone on its side has bars and a cutout at its sides).
/**
 * A phone's status bar, navigation bar or gesture area, and camera cutout
 * cover the app's edges (Android draws it edge to edge), and Android's
 * webview doesn't say so in env(safe-area-inset-*). This puts the system's
 * answer in the root's --system-top-inset, --system-right-inset,
 * --system-bottom-inset and --system-left-inset, which SAFE_TOP and the rest
 * (theme/layout, theme/media) keep clear of. Read again when the system says
 * it changed, or the window resizes (a turn of the phone). Nothing where
 * there are no system bars.
 */

import { useEffect } from 'react';
import { getShell } from '../shell';

const EDGES = ['top', 'right', 'bottom', 'left'] as const;

export function useSystemInsets(): void {
  useEffect(() => {
    const systemBars = getShell().platform.systemBars;
    if (!systemBars) return;
    const root = document.documentElement;
    const update = () => {
      const insets = systemBars.insets();
      for (const edge of EDGES) root.style.setProperty(`--system-${edge}-inset`, `${insets[edge]}px`);
    };
    update();
    window.addEventListener('resize', update);
    const stop = systemBars.onInsetsChange(update);
    return () => {
      window.removeEventListener('resize', update);
      stop();
      for (const edge of EDGES) root.style.removeProperty(`--system-${edge}-inset`);
    };
  }, []);
}
