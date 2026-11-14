// Adapted from TaskMint packages/client/src/hooks/__tests__/useSystemBottomInset.test.ts @ 5c802e7: every edge.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { setShell } from '../../shell';
import { createFakeShell } from '../../testing';
import { useSystemInsets } from '../useSystemInsets';

const inset = (edge: string) => document.documentElement.style.getPropertyValue(`--system-${edge}-inset`);

describe('useSystemInsets', () => {
  it("puts what the system's bars cover in the page, and keeps it up to date", () => {
    const shell = createFakeShell();
    setShell(shell);
    const { insets } = shell.platform.systemBars;
    vi.mocked(insets).mockReturnValue({ top: 24, right: 0, bottom: 16, left: 0 });
    const { unmount } = renderHook(() => useSystemInsets());
    expect(['top', 'right', 'bottom', 'left'].map(inset)).toEqual(['24px', '0px', '16px', '0px']);

    // Three-button navigation instead of the gesture bar
    vi.mocked(insets).mockReturnValue({ top: 24, right: 0, bottom: 48, left: 0 });
    act(() => shell.changeInsets());
    expect(inset('bottom')).toBe('48px');

    // The phone turned on its side: the bar and the cutout are at the sides
    vi.mocked(insets).mockReturnValue({ top: 24, right: 48, bottom: 0, left: 52 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(['top', 'right', 'bottom', 'left'].map(inset)).toEqual(['24px', '48px', '0px', '52px']);

    unmount();
    expect(['top', 'right', 'bottom', 'left'].map(inset)).toEqual(['', '', '', '']);
    act(() => shell.changeInsets());
    expect(inset('bottom')).toBe('');
  });

  it('does nothing where there are no system bars', () => {
    setShell(createFakeShell({ without: ['systemBars'] }));
    renderHook(() => useSystemInsets());
    expect(inset('bottom')).toBe('');
  });
});
