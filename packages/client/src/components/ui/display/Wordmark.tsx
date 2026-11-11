// Adapted from TaskMint packages/client/src/components/ui/display/Wordmark.tsx @ 1623bee.
import { Box, useTheme } from '@mui/material';

/** The BudgetMint wordmark (leaf + name), with light text on a dark theme. */
export function Wordmark({ height }: { height: number }) {
  const dark = useTheme().palette.mode === 'dark';
  return (
    <Box
      component="img"
      src={dark ? '/budgetmint-logo-dark.png' : '/budgetmint-logo.png'}
      alt="BudgetMint"
      sx={{ height, width: 'auto', display: 'block' }}
    />
  );
}
