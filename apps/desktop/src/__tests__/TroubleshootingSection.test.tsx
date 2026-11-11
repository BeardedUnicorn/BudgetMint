import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { TroubleshootingSection } from '../settings/TroubleshootingSection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('Settings → Troubleshooting', () => {
  it('opens the logs folder', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    render(<TroubleshootingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dispatch', { command: 'open_logs_folder', args: {} }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("says why it couldn't, until the next try", async () => {
    vi.mocked(invoke).mockRejectedValueOnce('no such folder');
    render(<TroubleshootingSection />);
    const button = screen.getByRole('button', { name: 'Open logs folder' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't open the logs folder. No such folder.");

    vi.mocked(invoke).mockResolvedValueOnce(null);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
