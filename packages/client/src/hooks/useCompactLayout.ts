// Copied from TaskMint packages/client/src/hooks/useCompactLayout.ts @ 1623bee: keep the two in step.
import useMediaQuery from '@mui/material/useMediaQuery';
import { PHONE } from '../theme/media';

/**
 * True on a phone-sized screen (narrower than 600px), where the app swaps
 * the sidebar for a top bar and shrinks what CSS alone can't (chart sizes).
 * Read on the first render, so the desktop layout never flashes on a phone.
 */
export function useCompactLayout(): boolean {
  return useMediaQuery(PHONE, { noSsr: true });
}
