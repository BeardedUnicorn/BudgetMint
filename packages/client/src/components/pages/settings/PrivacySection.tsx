// Adapted from TaskMint packages/client/src/components/pages/settings/PrivacySettingsSection.tsx @ ce9f22f.
/**
 * Privacy: whether this device shares usage statistics. Only where the
 * shell has them (the web and Android apps); SettingsPage leaves it out
 * elsewhere.
 */

import { useState } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { PrivacyTip as PrivacyIcon } from '@mui/icons-material';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '../../../utils/analytics';
import { SettingsSection } from './SettingsSection';

export function PrivacySection() {
  const [on, setOn] = useState(isAnalyticsEnabled);

  return (
    <SettingsSection title="Privacy" icon={<PrivacyIcon />}>
      <FormControlLabel
        control={
          <Switch
            checked={on}
            onChange={(_, checked) => {
              setOn(checked);
              setAnalyticsEnabled(checked);
            }}
          />
        }
        label="Share usage statistics"
      />
      <Typography variant="body2" color="text.secondary">
        Which pages you open, through Firebase Analytics, so we can see what’s used. Your bills, amounts and balances
        never go with it.
      </Typography>
    </SettingsSection>
  );
}
