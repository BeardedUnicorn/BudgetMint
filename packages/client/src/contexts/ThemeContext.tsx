// Copied from TaskMint packages/client/src/contexts/ThemeContext.tsx @ 1623bee: keep the two in step.
/**
 * Theme Context Provider
 *
 * This context provides theme switching functionality between light and dark modes
 * with persistence and system preference detection.
 */

import { createContext, useCallback, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { createAppTheme } from '../theme';

// Theme mode type
export type ThemeMode = 'light' | 'dark' | 'system';

// Theme context interface
interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

// Built once: switching modes swaps between these
const THEMES = { light: createAppTheme('light'), dark: createAppTheme('dark') };

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Hook to use theme context
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Theme Provider Component
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useLocalStorage<ThemeMode>('theme-mode', 'dark');
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

  // Follow the system's light/dark changes
  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Dark unless chosen otherwise (also for a stored mode this version doesn't know)
  const isDark = mode === 'system' ? systemTheme === 'dark' : mode !== 'light';

  // Toggle between light and dark (from System: the opposite of what the
  // system shows now)
  const toggleTheme = useCallback(() => {
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  const contextValue = useMemo<ThemeContextType>(
    () => ({ mode, isDark, setMode, toggleTheme }),
    [mode, isDark, setMode, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={isDark ? THEMES.dark : THEMES.light}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
}
