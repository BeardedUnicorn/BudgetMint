import { describe, expect, it, vi } from 'vitest';
import { startClient } from '@budgetmint/client/start';
import { webCloud } from '../firebaseConfig';

vi.mock('@budgetmint/client/start', () => ({ startClient: vi.fn(async () => null) }));

describe('the web entry', () => {
  it('starts the client in #root, in the browser’s shell', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('../main');
    expect(startClient).toHaveBeenCalledWith(root, {
      shell: expect.objectContaining({ capabilities: { runtime: 'web' } }),
      cloud: webCloud(import.meta.env),
    });
    root.remove();
  });
});
