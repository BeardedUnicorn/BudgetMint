// Adapted from TaskMint packages/client/src/contexts/__tests__/NavigationContext.test.tsx @ 1623bee.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { NavigationProvider, useNavigation, ACTIVE_VIEW_KEY } from '../NavigationContext';
import { readLocal, writeLocal } from '../../utils/localStore';

const persisted = ({ children }: { children: ReactNode }) => (
  <NavigationProvider persist>{children}</NavigationProvider>
);

describe('NavigationProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('opens on the Overview, with params for the page and a way to clear them', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    expect(result.current.view).toBe('overview');

    act(() => result.current.navigate('settings', { section: 'reminders' }));
    expect(result.current.view).toBe('settings');
    expect(result.current.params).toEqual({ section: 'reminders' });

    act(() => result.current.clearParams());
    expect(result.current.params).toEqual({});
  });

  it('remembers the page across launches when asked to', () => {
    const first = renderHook(() => useNavigation(), { wrapper: persisted });
    act(() => first.result.current.navigate('forecast'));
    expect(readLocal(ACTIVE_VIEW_KEY, null)).toBe('forecast');
    first.unmount();

    const second = renderHook(() => useNavigation(), { wrapper: persisted });
    expect(second.result.current.view).toBe('forecast');
  });

  it('ignores a stored page that no longer exists', () => {
    writeLocal(ACTIVE_VIEW_KEY, 'budgets', null);
    const { result } = renderHook(() => useNavigation(), { wrapper: persisted });
    expect(result.current.view).toBe('overview');
  });

  it("doesn't remember anything unless asked", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    act(() => result.current.navigate('bills'));
    expect(readLocal(ACTIVE_VIEW_KEY, null)).toBeNull();
  });

  it('keeps the same value when there are no params to clear', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    const before = result.current;

    act(() => result.current.clearParams());
    expect(result.current).toBe(before);
  });

  it('needs the provider', () => {
    expect(() => renderHook(() => useNavigation())).toThrow(/NavigationProvider/);
  });
});
