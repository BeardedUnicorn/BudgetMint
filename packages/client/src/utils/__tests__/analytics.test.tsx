// Adapted from TaskMint packages/client/src/utils/__tests__/analytics.test.tsx @ ce9f22f.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { setShell } from '../../shell';
import { createFakeShell } from '../../testing';
import { isAnalyticsEnabled, setAnalyticsEnabled, useAnalyticsScreens } from '../analytics';

function useScreens() {
  useAnalyticsScreens();
  return useNavigation();
}

/** The fake shell, installed for the client. */
function installShell(options: Parameters<typeof createFakeShell>[0] = {}) {
  const shell = createFakeShell(options);
  setShell(shell);
  return shell;
}

beforeEach(() => localStorage.clear());

describe('usage analytics', () => {
  it('are on until turned off, and follow the choice', () => {
    const { analytics } = installShell().platform;
    expect(isAnalyticsEnabled()).toBe(true);
    setAnalyticsEnabled(false);
    expect(isAnalyticsEnabled()).toBe(false);
    expect(analytics.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('count each page opened, by name only, and nothing once turned off', () => {
    const { analytics } = installShell().platform;
    const { result } = renderHook(useScreens, { wrapper: NavigationProvider });
    expect(analytics.setEnabled).toHaveBeenCalledWith(true);
    expect(analytics.screen).toHaveBeenLastCalledWith('overview');
    act(() => result.current.navigate('forecast'));
    expect(analytics.screen).toHaveBeenLastCalledWith('forecast');

    setAnalyticsEnabled(false);
    act(() => result.current.navigate('reports'));
    expect(analytics.screen).toHaveBeenCalledTimes(2);
  });

  it('are nothing where the shell has none', () => {
    installShell({ without: ['analytics'] });
    renderHook(useScreens, { wrapper: NavigationProvider });
    setAnalyticsEnabled(true);
    expect(isAnalyticsEnabled()).toBe(true);
  });
});
