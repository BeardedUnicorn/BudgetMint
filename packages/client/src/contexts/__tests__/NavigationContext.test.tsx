// Adapted from TaskMint packages/client/src/contexts/__tests__/NavigationContext.test.tsx @ 1623bee.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { NavigationProvider, useBackDismiss, useNavigation, activeViewKey } from '../NavigationContext';
import { readLocal, writeLocal } from '../../utils/localStore';

const ACTIVE_VIEW_KEY = activeViewKey('ann');

const persisted = ({ children }: { children: ReactNode }) => (
  <NavigationProvider persist={ACTIVE_VIEW_KEY}>{children}</NavigationProvider>
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
    second.unmount();

    // Another account's (one just set up, say) opens on the Overview
    const other = renderHook(() => useNavigation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <NavigationProvider persist={activeViewKey('bo')}>{children}</NavigationProvider>
      ),
    });
    expect(other.result.current.view).toBe('overview');
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

  it('goes back to the page before, and leaves entries that aren’t its own alone', async () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: persisted });
    act(() => result.current.navigate('bills'));
    act(() => result.current.navigate('forecast'));
    // Opening the page already showing adds nothing to go back through
    act(() => result.current.navigate('forecast', { add: true }));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.view).toBe('bills'));
    expect(readLocal(ACTIVE_VIEW_KEY, null)).toBe('bills');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { someone: 'else' } }));
    });
    expect(result.current.view).toBe('bills');
  });

  describe('with something open on top', () => {
    const top = (initialProps: { open: boolean; onBack: () => unknown }) =>
      renderHook(
        ({ open, onBack }) => {
          useBackDismiss(open, onBack);
          return useNavigation();
        },
        { wrapper: NavigationProvider, initialProps }
      );
    const onTop = () => (window.history.state as { budgetmint: { overlay?: true } }).budgetmint.overlay === true;

    it('closes it on Back, and stays on the page', async () => {
      const onBack = vi.fn();
      const { result, rerender } = top({ open: false, onBack });
      act(() => result.current.navigate('bills'));
      rerender({ open: true, onBack });
      expect(onTop()).toBe(true);
      act(() => window.history.back());
      await waitFor(() => expect(onBack).toHaveBeenCalled());
      rerender({ open: false, onBack });
      await act(async () => undefined);
      expect(onTop()).toBe(false);
      expect(result.current.view).toBe('bills');
    });

    it('keeps it open when it asks first, and takes its entry off once it closes itself', async () => {
      const onBack = vi.fn(() => false);
      const { result, rerender } = top({ open: true, onBack });
      const depth = window.history.length;
      const push = vi.spyOn(window.history, 'pushState');
      act(() => window.history.back());
      await waitFor(() => expect(onBack).toHaveBeenCalled());
      // Still open: Back again would ask again, from the entry it had (one pushed without a tap
      // would have Chromium skip the entries under it)
      await waitFor(() => expect(onTop()).toBe(true));
      expect(push).not.toHaveBeenCalled();
      expect(window.history.length).toBe(depth);
      push.mockRestore();
      act(() => window.history.back());
      await waitFor(() => expect(onBack).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(onTop()).toBe(true));
      rerender({ open: false, onBack });
      await waitFor(() => expect(onTop()).toBe(false));
      // Its going back wasn't the user's: the page stays
      await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
      expect(result.current.view).toBe('overview');
    });

    it('hands its entry to a page opened from it', async () => {
      const onBack = vi.fn();
      const { result, rerender } = top({ open: true, onBack });
      const depth = window.history.length;
      act(() => result.current.navigate('reports'));
      expect(window.history.length).toBe(depth);
      expect(onTop()).toBe(false);
      rerender({ open: false, onBack });
      await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
      expect(result.current.view).toBe('reports');
      expect(onBack).not.toHaveBeenCalled();
    });

    it('closes the top one of two first, keeping an entry for the one under it', async () => {
      const under = vi.fn();
      const over = vi.fn();
      const { rerender } = renderHook(
        ({ second }: { second: boolean }) => {
          useBackDismiss(true, under);
          useBackDismiss(second, over);
        },
        { wrapper: NavigationProvider, initialProps: { second: true } }
      );
      act(() => window.history.back());
      await waitFor(() => expect(over).toHaveBeenCalled());
      expect(under).not.toHaveBeenCalled();
      await waitFor(() => expect(onTop()).toBe(true));
      rerender({ second: false });
      act(() => window.history.back());
      await waitFor(() => expect(under).toHaveBeenCalled());
    });
  });

  it('has no Back to take outside the pages', () => {
    expect(() => renderHook(() => useBackDismiss(true, vi.fn()))).not.toThrow();
  });
});
