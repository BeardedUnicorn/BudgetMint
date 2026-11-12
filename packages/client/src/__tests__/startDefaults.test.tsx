import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { createFakeShell, createFakeStore, testCore } from '../testing';

const store = createFakeStore();
const loadFirebase = vi.fn(() => async () => store);
vi.mock('../cloud', async importOriginal => ({ ...(await importOriginal<typeof import('../cloud')>()), loadFirebase }));
vi.mock('../core', async importOriginal => ({
  ...(await importOriginal<typeof import('../core')>()),
  loadCore: vi.fn(async () => testCore()),
}));

const { startClient } = await import('../start');
const { loadCore } = await import('../core');

describe('starting the app as the shells do', () => {
  it('loads Firebase for the shell’s config and core from its own wasm', async () => {
    const cloud = {
      firebase: {
        apiKey: 'k',
        authDomain: 'd',
        projectId: 'p',
        storageBucket: 's',
        messagingSenderId: 'm',
        appId: 'a',
      },
      taskmint: {
        apiKey: 'k',
        authDomain: 't',
        projectId: 't',
        storageBucket: 's',
        messagingSenderId: 'm',
        appId: 't',
      },
      cache: 'single' as const,
      popupSignIn: false,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    await startClient(container, { shell: createFakeShell(), cloud });
    expect(loadFirebase).toHaveBeenCalledWith(cloud);
    expect(vi.mocked(loadCore).mock.calls[0][0]).toMatch(/budgetmint_core_bg\.wasm/);
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    container.remove();
  });
});
