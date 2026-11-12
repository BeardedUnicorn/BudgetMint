import { describe, expect, it, vi } from 'vitest';
import { startClient } from '@budgetmint/client/start';
import { webCloud } from '../firebaseConfig';
import { registerServiceWorker } from '../offline/register';

vi.mock('@budgetmint/client/start', () => ({ startClient: vi.fn(async () => null) }));
vi.mock('../offline/register', () => ({ registerServiceWorker: vi.fn() }));

describe('the web entry', () => {
  // One test: the entry runs once per file, and Vitest clears the mocks'
  // calls before each test
  it('starts the client in #root, in the browser’s shell, and keeps the app shell offline in a production build only', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('../main');
    expect(startClient).toHaveBeenCalledWith(root, {
      shell: expect.objectContaining({ capabilities: { runtime: 'web' } }),
      cloud: webCloud(import.meta.env),
    });
    expect(registerServiceWorker).toHaveBeenCalledWith(import.meta.env.PROD);
    root.remove();
  });
});
