// Copied from TaskMint packages/client/src/components/pages/settings/SettingsSection.tsx @ 1623bee: keep the two in step.
import { Box, Paper, PaperProps, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { PHONE } from '../../../theme/media';

interface SettingsSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  headerChildren?: ReactNode;
  paperProps?: PaperProps;
}

export function SettingsSection({ title, icon, children, headerChildren, paperProps }: SettingsSectionProps) {
  return (
    <Paper {...paperProps} sx={{ p: 3, mb: 4, [PHONE]: { p: 2, mb: 3 }, ...(paperProps?.sx || {}) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {headerChildren}
      </Box>
      {children}
    </Paper>
  );
}
