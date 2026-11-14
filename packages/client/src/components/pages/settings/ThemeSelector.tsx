// Adapted from TaskMint packages/client/src/components/pages/settings/ThemeSelector.tsx @ 1623bee: on a phone the three share the row's width, where the third used to wrap alone.
import type { ReactNode } from 'react';
import { Box, Button } from '@mui/material';
import { LightMode, DarkMode, Computer } from '@mui/icons-material';
import { useTheme, type ThemeMode } from '../../../contexts/ThemeContext';
import { PHONE } from '../../../theme/media';

const OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <LightMode fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkMode fontSize="small" /> },
  { value: 'system', label: 'System', icon: <Computer fontSize="small" /> },
];

/** Light / Dark / System, as a row of buttons with the current one filled. */
export function ThemeSelector() {
  const { mode, setMode } = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        [PHONE]: {
          flexWrap: 'wrap',
          '& > *': { flex: '1 1 88px', minWidth: 0, px: 1 },
          '& .MuiButton-startIcon': { mr: 0.5 },
        },
      }}
    >
      {OPTIONS.map(option => (
        <Button
          key={option.value}
          onClick={() => setMode(option.value)}
          variant={mode === option.value ? 'contained' : 'outlined'}
          startIcon={option.icon}
          aria-pressed={mode === option.value}
        >
          {option.label}
        </Button>
      ))}
    </Box>
  );
}
