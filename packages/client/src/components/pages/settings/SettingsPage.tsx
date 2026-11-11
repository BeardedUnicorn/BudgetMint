/**
 * Settings: one page of sections (TaskMint's layout), with the shell's own
 * (the desktop's Updates) before About. A link can open it at a section.
 */

import { useEffect } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { Info as AboutIcon, Palette as AppearanceIcon } from '@mui/icons-material';
import { useAppExtensions } from '../../../app/extensions';
import { useNavigation } from '../../../contexts/NavigationContext';
import { APP_VERSION } from '../../../utils/appVersion';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { AccountSection } from './AccountSection';
import { ForecastSection } from './ForecastSection';
import { RemindersSection } from './RemindersSection';
import { SettingsSection } from './SettingsSection';
import { TaskMintSection } from './TaskMintSection';
import { ThemeSelector } from './ThemeSelector';

export function SettingsPage() {
  const { settingsSections = [] } = useAppExtensions();
  const { params, clearParams } = useNavigation();

  useEffect(() => {
    if (!params.section) return;
    document.getElementById(`settings-${params.section}`)?.scrollIntoView({ block: 'start' });
    clearParams();
  }, [params.section, clearParams]);

  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <Box id="settings-account">
        <AccountSection />
      </Box>
      <Box id="settings-forecast">
        <ForecastSection />
      </Box>
      <Box id="settings-taskmint">
        <TaskMintSection />
      </Box>
      <Box id="settings-reminders">
        <RemindersSection />
      </Box>
      <Box id="settings-appearance">
        <SettingsSection title="Appearance" icon={<AppearanceIcon />}>
          <ThemeSelector />
        </SettingsSection>
      </Box>
      {settingsSections.map(({ id, Section }) => (
        <Box key={id} id={`settings-${id}`}>
          <Section />
        </Box>
      ))}
      <Box id="settings-about">
        <SettingsSection title="About" icon={<AboutIcon />}>
          <Typography variant="body2">
            BudgetMint {APP_VERSION}, TaskMint’s companion for bills and cash flow.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Open source under the MIT license.{' '}
            <Link href="https://github.com/BeardedUnicorn/BudgetMint" target="_blank" rel="noreferrer">
              Source and releases
            </Link>
          </Typography>
        </SettingsSection>
      </Box>
    </PageContainer>
  );
}
