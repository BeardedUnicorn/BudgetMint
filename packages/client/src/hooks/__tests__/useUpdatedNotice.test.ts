// Adapted from TaskMint packages/client/src/hooks/__tests__/useUpdatedNotice.test.ts @ a2b0156.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  LAST_SEEN_VERSION_KEY,
  releasesSinceUpdate,
  UPDATED_FROM_VERSION_KEY,
  useUpdatedNotice,
} from '../useUpdatedNotice';
import { RELEASES } from '../../utils/changelog';
import { readLocal, writeLocal } from '../../utils/localStore';
import { APP_VERSION } from '../../utils/appVersion';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), open: vi.fn() }));
vi.mock('../../contexts/NotificationContext', () => ({ useNotification: () => ({ notify: mocks.notify }) }));
vi.mock('../../contexts/AppDialogsContext', () => ({ useAppDialogs: () => ({ open: mocks.open }) }));

const seen = () => readLocal<unknown>(LAST_SEEN_VERSION_KEY, null);
const updatedFrom = () => readLocal<unknown>(UPDATED_FROM_VERSION_KEY, null);
const older = '0.0.1';
const newer = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`;
/** The release before this one (the changelog has the app's own version first). */
const previous = RELEASES[1].version;

describe('useUpdatedNotice', () => {
  beforeEach(() => {
    mocks.notify.mockClear();
    mocks.open.mockClear();
  });

  it('points to what’s new after an update, once, and opens About BudgetMint', () => {
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, previous, null);
    const { rerender } = renderHook(() => useUpdatedNotice());

    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.notify.mock.calls[0];
    expect(message).toBe('See what’s new in this version.');
    expect(options).toMatchObject({ title: `Updated to BudgetMint ${APP_VERSION}`, severity: 'info' });
    expect(options.actions.map((action: { label: string }) => action.label)).toEqual(['What’s new']);
    options.actions[0].onClick();
    expect(mocks.open).toHaveBeenCalledWith('about');
    expect(seen()).toBe(APP_VERSION);
    expect(updatedFrom()).toBe(previous);

    rerender();
    renderHook(() => useUpdatedNotice());
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('points to everything since the version before, after an update that skipped releases', () => {
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, older, null);
    renderHook(() => useUpdatedNotice());

    expect(mocks.notify.mock.calls[0][0]).toBe('See what’s new since 0.0.1.');
    expect(updatedFrom()).toBe(older);
    expect(releasesSinceUpdate(older).length).toBeGreaterThan(1);
    expect(releasesSinceUpdate(older)[0].version).toBe(APP_VERSION);
  });

  it('notes the first version a device runs without a toast', () => {
    renderHook(() => useUpdatedNotice());

    expect(mocks.notify).not.toHaveBeenCalled();
    expect(seen()).toBe(APP_VERSION);
    expect(updatedFrom()).toBeNull();
    expect(releasesSinceUpdate(null)).toEqual([]);
  });

  it('treats an unreadable stored version as none', () => {
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, 'v-next', null);
    renderHook(() => useUpdatedNotice());

    expect(mocks.notify).not.toHaveBeenCalled();
    expect(seen()).toBe(APP_VERSION);
  });

  it('notes an older version (a downgrade or a dev build) without a toast', () => {
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, newer, null);
    renderHook(() => useUpdatedNotice());

    expect(mocks.notify).not.toHaveBeenCalled();
    expect(seen()).toBe(APP_VERSION);
    expect(updatedFrom()).toBeNull();
    expect(releasesSinceUpdate(newer)).toEqual([]);
  });

  it('says nothing for the version already seen', () => {
    writeLocal<unknown>(LAST_SEEN_VERSION_KEY, APP_VERSION, null);
    renderHook(() => useUpdatedNotice());

    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
