/**
 * Settings' Appearance: light or dark, the currency, and the day a week
 * starts on.
 */

import { Palette as AppearanceIcon } from '@mui/icons-material';
import { RegionSettings } from './RegionSettings';
import { SettingsSection } from './SettingsSection';
import { ThemeSelector } from './ThemeSelector';

export function AppearanceSection() {
  return (
    <SettingsSection title="Appearance" icon={<AppearanceIcon color="primary" />}>
      <ThemeSelector />
      <RegionSettings />
    </SettingsSection>
  );
}
