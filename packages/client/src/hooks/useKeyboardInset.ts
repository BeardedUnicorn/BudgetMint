// Adapted from TaskMint packages/client/src/hooks/useKeyboardInset.ts @ 5c802e7: the field being typed in is also brought into view, since BudgetMint's pages (not only its dialogs) have fields.
/**
 * Where the on-screen keyboard leaves room. The Android app draws edge to
 * edge, so the system no longer shrinks the page for the keyboard: a
 * dialog's buttons, or a page's field, would stay under it. Newer webviews
 * shrink the visual viewport for it; older ones don't, and Android itself
 * says how tall it is (the system bars' keyboardInset). The root gets the
 * room as two CSS variables, `--keyboard-top` and `--keyboard-bottom` (0px
 * with no keyboard, as on a desktop), which the theme's dialogs and the
 * app's frame keep clear of; and as the keyboard comes up, the field it's
 * for is scrolled into what's left.
 */

import { useEffect } from 'react';
import { getShell } from '../shell';

export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const systemBars = getShell().platform.systemBars;
    if (!viewport && !systemBars) return;
    const root = document.documentElement;
    let shownBefore = 0;
    const update = () => {
      // Zoomed in (a pinch), the viewport shrinks without any keyboard
      const usable = viewport && viewport.scale === 1 ? viewport : null;
      const top = usable ? Math.max(0, Math.round(usable.offsetTop)) : 0;
      const shown = usable ? window.innerHeight - usable.height - usable.offsetTop : 0;
      const bottom = Math.max(0, Math.round(Math.max(shown, systemBars?.keyboardInset() ?? 0)));
      root.style.setProperty('--keyboard-top', `${top}px`);
      root.style.setProperty('--keyboard-bottom', `${bottom}px`);
      // It has just come up: once the page has made room, the field shows in it
      if (bottom > 0 && shownBefore === 0) {
        const field = document.activeElement;
        requestAnimationFrame(() => field?.scrollIntoView({ block: 'center' }));
      }
      shownBefore = bottom;
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    const stop = systemBars?.onInsetsChange(update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      stop?.();
      root.style.removeProperty('--keyboard-top');
      root.style.removeProperty('--keyboard-bottom');
    };
  }, []);
}
