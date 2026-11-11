// Copied from TaskMint packages/client/src/hooks/useLocalStorage.ts @ 1623bee: keep the two in step.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { readLocal, subscribeLocal, writeLocal } from '../utils/localStore';

/**
 * A localStorage value with useState's API. The setter is stable, functional
 * updates apply to the latest stored value, and every component using the
 * same key sees each write (see utils/localStore).
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  // The first render's initial value, so an inline literal doesn't change the
  // snapshot on every render.
  const initialRef = useRef(initialValue);

  const subscribe = useCallback((onChange: () => void) => subscribeLocal(key, onChange), [key]);
  const getSnapshot = useCallback(() => readLocal(key, initialRef.current), [key]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback((next: T | ((previous: T) => T)) => writeLocal(key, next, initialRef.current), [key]);

  return [value, setValue] as const;
}
