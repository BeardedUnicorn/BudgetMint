// Copied from TaskMint packages/client/src/contexts/__tests__/ThemeContext.test.tsx @ 1623bee: keep the two in step.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { ThemeProvider, useTheme, type ThemeMode } from '../ThemeContext';
import { writeLocal } from '../../utils/localStore';

/** The system's dark-mode query, as matchMedia answers it, with its listeners. */
function systemPrefers(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    addEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener)
    ),
  };
  vi.mocked(window.matchMedia).mockReturnValue(query as unknown as MediaQueryList);
  return {
    listeners,
    change: (nowDark: boolean) => listeners.forEach(listener => listener({ matches: nowDark } as MediaQueryListEvent)),
  };
}

const themed = () => renderHook(() => ({ app: useTheme(), mui: useMuiTheme() }), { wrapper: ThemeProvider });

const chosen = (mode: string) => writeLocal<ThemeMode>('theme-mode', mode as ThemeMode, 'dark');

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    systemPrefers(false);
  });

  it('is dark until another mode is chosen, for the app and MUI', () => {
    const { result } = themed();

    expect(result.current.app).toMatchObject({ mode: 'dark', isDark: true });
    expect(result.current.mui.palette.mode).toBe('dark');
  });

  it('is light when chosen, and saves the choice', () => {
    const { result } = themed();

    act(() => result.current.app.setMode('light'));

    expect(result.current.app.isDark).toBe(false);
    expect(result.current.mui.palette.mode).toBe('light');
    expect(JSON.parse(window.localStorage.getItem('theme-mode')!).data).toBe('light');
  });

  it('follows the system in System mode, as it changes', () => {
    const system = systemPrefers(true);
    chosen('system');
    const { result, unmount } = themed();
    expect(result.current.app.isDark).toBe(true);

    act(() => system.change(false));
    expect(result.current.app.isDark).toBe(false);
    expect(result.current.mui.palette.mode).toBe('light');
    act(() => system.change(true));
    expect(result.current.app.isDark).toBe(true);

    unmount();
    expect(system.listeners.size).toBe(0);
  });

  it('toggles between light and dark, from System to the opposite of what shows', () => {
    systemPrefers(true);
    chosen('system');
    const { result } = themed();

    act(() => result.current.app.toggleTheme());
    expect(result.current.app.mode).toBe('light');

    act(() => result.current.app.toggleTheme());
    expect(result.current.app.mode).toBe('dark');
  });

  it("is dark for a stored mode it doesn't know", () => {
    chosen('sepia');
    expect(themed().result.current.app.isDark).toBe(true);
  });
});

describe('useTheme', () => {
  it('needs the provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
  });
});
