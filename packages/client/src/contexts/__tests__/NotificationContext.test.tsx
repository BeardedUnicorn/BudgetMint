import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { LONG_TOAST_MS, MAX_TOASTS, NotificationProvider, TOAST_MS, useNotification } from '../NotificationContext';

function Notifier({ onReady }: { onReady: (value: ReturnType<typeof useNotification>) => void }) {
  onReady(useNotification());
  return null;
}

function mount() {
  let api!: ReturnType<typeof useNotification>;
  const rendered = render(
    <NotificationProvider>
      <Notifier onReady={value => (api = value)} />
    </NotificationProvider>
  );
  return { api: () => api, ...rendered };
}

afterEach(() => vi.useRealTimers());

describe('toasts', () => {
  it('show, then go after a while (longer for errors and ones with a button)', () => {
    vi.useFakeTimers();
    const { api } = mount();
    // The region that announces them is there before any toast is
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    act(() => {
      api().showSuccess('Saved', { title: 'Rent' });
      api().showError('Not saved');
    });
    // A plain one is read by that region; an error interrupts as an alert of its own
    const saved = screen.getByText('Saved').closest('[role="group"]')!;
    expect(saved).toHaveTextContent('RentSaved');
    expect(saved).not.toHaveAttribute('aria-live');
    expect(region).toContainElement(saved as HTMLElement);
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved');
    act(() => vi.advanceTimersByTime(TOAST_MS + 250));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(LONG_TOAST_MS));
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument();
  });

  it('hold while the pointer is on them or they have focus, and go on Escape or the close button', () => {
    vi.useFakeTimers();
    const { api } = mount();
    act(() => {
      api().showInfo('Held');
    });
    const held = screen.getByText('Held').closest('[role="group"]')!;
    fireEvent.pointerEnter(held, { pointerType: 'mouse' });
    // A finger doesn't hold it
    fireEvent.pointerEnter(held, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(TOAST_MS * 2));
    expect(screen.getByText('Held')).toBeInTheDocument();
    fireEvent.pointerLeave(held, { pointerType: 'mouse' });
    fireEvent.pointerLeave(held, { pointerType: 'touch' });
    fireEvent.focus(held);
    fireEvent.blur(held, { relatedTarget: held.querySelector('button') });
    fireEvent.blur(held, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(TOAST_MS + 250));
    expect(screen.queryByText('Held')).not.toBeInTheDocument();

    act(() => {
      api().showWarning('Escaped');
    });
    const escaped = screen.getByRole('alert');
    fireEvent.keyDown(escaped, { key: 'Enter' });
    fireEvent.keyDown(escaped, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText('Escaped')).not.toBeInTheDocument();

    act(() => {
      api().notify('Closed');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
  });

  it('run a button’s action and go; stay without a duration; keep only the newest few', () => {
    vi.useFakeTimers();
    const { api, unmount } = mount();
    const undo = vi.fn();
    act(() => {
      api().notify('Kept', { durationMs: 0, actions: [{ label: 'Undo', onClick: undo }] });
    });
    act(() => vi.advanceTimersByTime(LONG_TOAST_MS * 2));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText('Kept')).not.toBeInTheDocument();

    act(() => {
      for (let i = 0; i <= MAX_TOASTS; i++) api().notify(`Toast ${i}`);
    });
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText('Toast 0')).not.toBeInTheDocument();
    expect(screen.getByText(`Toast ${MAX_TOASTS}`)).toBeInTheDocument();
    // Leaving clears what's pending
    unmount();
    api().dismiss('none');
  });

  it('need their provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useNotification())).toThrow(
      'useNotification must be used within a NotificationProvider'
    );
    vi.restoreAllMocks();
  });
});
