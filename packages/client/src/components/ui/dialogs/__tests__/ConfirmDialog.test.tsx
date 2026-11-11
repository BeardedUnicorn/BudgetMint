// Copied from TaskMint packages/client/src/components/ui/dialogs/__tests__/ConfirmDialog.test.tsx @ 1623bee: keep the two in step.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

const base = {
  open: true,
  title: 'Delete Session',
  message: 'Delete it?',
  confirmLabel: 'Delete',
};

describe('ConfirmDialog', () => {
  it('starts on Cancel for a destructive confirmation, so Enter cannot delete', () => {
    render(<ConfirmDialog {...base} severity="error" onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('starts on the confirm button otherwise', () => {
    render(<ConfirmDialog {...base} severity="warning" onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('waits for an async confirm and closes when it succeeds', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>(r => (resolve = r)));
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open when an async confirm fails', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('nope')));
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes right after a confirm that returns nothing, and on Cancel', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} cancelLabel="Keep" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
