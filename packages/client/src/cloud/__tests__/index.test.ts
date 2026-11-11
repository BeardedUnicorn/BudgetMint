import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebaseStore', () => ({ createFirebaseStore: vi.fn(async (config: unknown) => ({ made: config })) }));

const { loadFirebase } = await import('..');

describe('loading Firebase', () => {
  it('makes the store for the config, when asked', async () => {
    const config = { cache: 'memory' } as never;
    const load = loadFirebase(config);
    expect(await load()).toEqual({ made: config });
  });
});
