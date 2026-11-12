// Adapted from TaskMint apps/desktop/src/__tests__/main.test.ts @ ded0475.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startClient } from '@budgetmint/client/start';
import type { Capabilities } from '@budgetmint/client/shell';
import { command, createTauriShell } from '../tauriShell';
import { desktopExtensions } from '../extensions';
import { desktopCloud, googleDesktopClient } from '../firebaseConfig';
import { forwardLogs } from '../logging';

vi.mock('@budgetmint/client/start', () => ({ startClient: vi.fn(async () => undefined) }));
vi.mock('../tauriShell', () => ({ createTauriShell: vi.fn(() => ({ name: 'tauri' })), command: vi.fn() }));
vi.mock('../extensions', () => ({ desktopExtensions: vi.fn(() => ({ name: 'desktop' })) }));
vi.mock('../logging', () => ({ forwardLogs: vi.fn() }));

const capabilities = vi.mocked(command);

/** Runs the entry once, as the app starts it. */
async function launch(reported: Capabilities) {
  capabilities.mockResolvedValue(reported);
  vi.resetModules();
  await import('../main');
  await vi.waitFor(() => expect(startClient).toHaveBeenCalled());
}

describe('the desktop entry', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  it('starts the client in #root on what the Rust side reports', async () => {
    const local: Capabilities = { runtime: 'desktop' };
    await launch(local);
    // Before anything that could fail
    expect(vi.mocked(forwardLogs).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(command).mock.invocationCallOrder[0]
    );
    expect(command).toHaveBeenCalledWith('get_capabilities');
    expect(createTauriShell).toHaveBeenCalledWith(local, googleDesktopClient(import.meta.env));
    expect(desktopExtensions).toHaveBeenCalledWith(local);
    expect(startClient).toHaveBeenCalledWith(root, {
      shell: { name: 'tauri' },
      extensions: { name: 'desktop' },
      cloud: desktopCloud(import.meta.env),
    });
  });
});
