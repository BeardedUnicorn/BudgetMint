// Copied from TaskMint packages/client/src/__tests__/setup/test-helpers.tsx @ 1623bee: keep the two in step.
import React, { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { NotificationProvider } from '../../contexts/NotificationContext';

const theme = createTheme();

interface TestWrapperProps {
  children: ReactNode;
}

const TestWrapper: React.FC<TestWrapperProps> = ({ children }) => (
  <ThemeProvider theme={theme}>
    <NotificationProvider>{children}</NotificationProvider>
  </ThemeProvider>
);

const customRender = (ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  render(ui, { wrapper: TestWrapper, ...options });

export * from '@testing-library/react';
export { customRender as render };
