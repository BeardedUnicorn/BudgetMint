// Adapted from TaskMint packages/client/src/components/pages/settings/PrivacySettingsSection.tsx @ ce9f22f.
/**
 * Privacy: whether this device shares usage statistics (the web and
 * Android apps), and whether the app stays out of screenshots and the
 * recent apps' previews (Android). Each only where the shell has it;
 * SettingsPage leaves the section out where it has neither.
 */

import { useState } from 'react';
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { PrivacyTip as PrivacyIcon } from '@mui/icons-material';
import { getShell } from '../../../shell';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '../../../utils/analytics';
import { SettingsSection } from './SettingsSection';

export function PrivacySection() {
  const { analytics, screenPrivacy } = getShell().platform;
  const [on, setOn] = useState(isAnalyticsEnabled);
  const [hidden, setHidden] = useState(() => screenPrivacy?.isOn() ?? false);

  return (
    <SettingsSection title="Privacy" icon={<PrivacyIcon color="primary" />}>
      <Stack spacing={2}>
        {analytics && (
          <div>
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
              Which pages you open, through Firebase Analytics, so we can see what’s used. Your bills, amounts and
              balances never go with it.
            </Typography>
          </div>
        )}
        {screenPrivacy && (
          <div>
            <FormControlLabel
              control={
                <Switch
                  checked={hidden}
                  onChange={(_, checked) => {
                    setHidden(checked);
                    screenPrivacy.set(checked);
                  }}
                />
              }
              label="Hide BudgetMint in screenshots and recent apps"
            />
            <Typography variant="body2" color="text.secondary">
              Screenshots and screen recordings of BudgetMint come out blank, and the recent apps’ list shows no preview
              of it. On this device only.
            </Typography>
          </div>
        )}
      </Stack>
    </SettingsSection>
  );
}
