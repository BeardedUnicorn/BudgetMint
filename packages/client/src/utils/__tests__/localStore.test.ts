// Copied from TaskMint packages/client/src/utils/__tests__/localStore.test.ts @ 1623bee: keep the two in step.
import { describe, expect, it, vi } from 'vitest';
import { readLocal, subscribeLocal, writeLocal } from '../localStore';

describe('localStore', () => {
  it('reads a stored null as null, and anything not in the envelope as missing', () => {
    localStorage.setItem('goal', 'null');
    expect(readLocal('goal', 5)).toBeNull();

    localStorage.setItem('filters', JSON.stringify({ version: 1, data: { show: 'all' } }));
    expect(readLocal('filters', {})).toEqual({ show: 'all' });
    expect(readLocal('filters', {})).toEqual({ show: 'all' });

    for (const raw of [JSON.stringify({ show: 'all' }), JSON.stringify('all'), JSON.stringify({ version: 1 })]) {
      localStorage.setItem('filters', raw);
      expect(readLocal('filters', { show: 'none' })).toEqual({ show: 'none' });
    }
  });

  it("tells a key's listeners about other windows' writes, and everyone about a clear", () => {
    const tasks = vi.fn();
    const goal = vi.fn();
    const stopTasks = subscribeLocal('tasks', tasks);
    subscribeLocal('goal', goal);

    window.dispatchEvent(new StorageEvent('storage', { key: 'tasks' }));
    expect([tasks.mock.calls.length, goal.mock.calls.length]).toEqual([1, 0]);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect([tasks.mock.calls.length, goal.mock.calls.length]).toEqual([2, 1]);

    stopTasks();
    writeLocal('tasks', ['a'], []);
    expect(tasks).toHaveBeenCalledTimes(2);
  });
});
