import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEVICE_ID_KEY, deviceId, startClient } from '../start';
import type { CloudConfig } from '../cloud/types';
import { createFakeShell, createFakeStore, wasmBytes } from '../testing';
import { readLocal } from '../utils/localStore';

const CLOUD: CloudConfig = {
  firebase: { apiKey: 'k', authDomain: 'd', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'a' },
  cache: 'memory',
  popupSignIn: false,
};

let container: HTMLElement;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

afterEach(() => container?.remove());

describe('starting the app', () => {
  it('loads Firebase and core, then asks to sign in (with Google where the shell can)', async () => {
    const shell = createFakeShell();
    const store = createFakeStore();
    const session = await startClient(mount(), {
      shell,
      cloud: CLOUD,
      loadStore: async () => store,
      wasm: wasmBytes(),
    });
    expect(session).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(shell.platform.googleSignIn).toHaveBeenCalled();
    expect(store.signInWithGoogle).toHaveBeenCalledWith('google-id-token');
    // The user may have moved: the zone follows on focus, and the pages ask again
    const before = session!.getView().version;
    window.dispatchEvent(new Event('focus'));
    expect(session!.getView().version).toBe(before + 1);
    session!.stop();
  });

  it('signs in with Google in a popup in a browser, and without Google where neither can', async () => {
    const store = createFakeStore();
    await startClient(mount(), {
      shell: createFakeShell({ runtime: 'web', without: ['googleSignIn'] }),
      cloud: { ...CLOUD, popupSignIn: true },
      loadStore: async () => store,
      wasm: wasmBytes(),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(store.signInWithGoogle).toHaveBeenCalledWith(null);
    container.remove();

    await startClient(mount(), {
      shell: createFakeShell({ without: ['googleSignIn'] }),
      cloud: CLOUD,
      loadStore: async () => createFakeStore(),
      wasm: wasmBytes(),
    });
    await screen.findAllByRole('heading', { name: 'Sign in to BudgetMint' });
    expect(screen.queryAllByRole('button', { name: 'Continue with Google' })).toHaveLength(0);
  });

  it('says when it can’t start, and lets the launch screen go', async () => {
    const shell = createFakeShell();
    const session = await startClient(mount(), {
      shell,
      cloud: CLOUD,
      loadStore: () => Promise.reject({ code: 'auth/network-request-failed' }),
      wasm: wasmBytes(),
    });
    expect(session).toBeNull();
    expect(await screen.findByText('Can’t reach Firebase. Check the connection and try again.')).toBeInTheDocument();
    await waitFor(() => expect(shell.platform.splashScreen.hide).toHaveBeenCalled());
  });

  it('keeps this device’s id', () => {
    const first = deviceId();
    expect(readLocal(DEVICE_ID_KEY, null)).toBe(first);
    expect(deviceId()).toBe(first);
    expect(vi.isMockFunction(localStorage.setItem)).toBe(true);
  });
});
