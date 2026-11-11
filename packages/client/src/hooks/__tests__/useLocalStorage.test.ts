// Copied from TaskMint packages/client/src/hooks/__tests__/useLocalStorage.test.ts @ 1623bee: keep the two in step.
/**
 * Tests for useLocalStorage hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../useLocalStorage';

describe('useLocalStorage', () => {
  const TEST_KEY = 'test-key';
  const INITIAL_VALUE = 'initial-value';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should return initial value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    expect(result.current[0]).toBe(INITIAL_VALUE);
  });

  it('should return stored value from localStorage', () => {
    const storedValue = 'stored-value';
    // Store data in the new versioned format
    const versionedData = {
      version: 1,
      data: storedValue,
      migratedAt: new Date().toISOString(),
    };
    localStorage.setItem(TEST_KEY, JSON.stringify(versionedData));

    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    expect(result.current[0]).toBe(storedValue);
  });

  it('should update localStorage when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));
    const newValue = 'new-value';

    act(() => {
      result.current[1](newValue);
    });

    expect(result.current[0]).toBe(newValue);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toBe(newValue);
    expect(storedData.migratedAt).toBeDefined();
  });

  it('should handle function updates', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, 0));

    act(() => {
      result.current[1]((prev: number) => prev + 1);
    });

    expect(result.current[0]).toBe(1);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toBe(1);
  });

  it('should handle complex objects', () => {
    const complexObject = {
      id: '1',
      name: 'Test',
      nested: {
        value: 42,
        array: [1, 2, 3],
      },
    };

    const { result } = renderHook(() => useLocalStorage(TEST_KEY, {}));

    act(() => {
      result.current[1](complexObject);
    });

    expect(result.current[0]).toEqual(complexObject);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toEqual(complexObject);
  });

  it('should handle localStorage errors gracefully', () => {
    // Mock localStorage.getItem to throw an error
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = vi.fn(() => {
      throw new Error('localStorage error');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    expect(result.current[0]).toBe(INITIAL_VALUE);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error reading localStorage key'),
      expect.any(Error)
    );

    // Restore original implementation
    localStorage.getItem = originalGetItem;
    consoleSpy.mockRestore();
  });

  it('should handle JSON parsing errors gracefully', () => {
    // Set invalid JSON in localStorage
    localStorage.setItem(TEST_KEY, 'invalid-json');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    expect(result.current[0]).toBe(INITIAL_VALUE);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error reading localStorage key'),
      expect.any(SyntaxError)
    );

    consoleSpy.mockRestore();
  });

  it('should handle localStorage.setItem errors gracefully', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    // Mock localStorage.setItem to throw an error
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      throw new Error('localStorage setItem error');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      result.current[1]('new-value');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error saving to localStorage key'),
      expect.any(Error)
    );

    // Restore original implementation
    localStorage.setItem = originalSetItem;
    consoleSpy.mockRestore();
  });

  it('should work with arrays', () => {
    const arrayValue = [1, 2, 3, 4, 5];
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, [] as number[]));

    act(() => {
      result.current[1](arrayValue);
    });

    expect(result.current[0]).toEqual(arrayValue);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toEqual(arrayValue);
  });

  it('should work with boolean values', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, false));

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toBe(true);
  });

  it('should work with null values', () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, 'not-null'));

    act(() => {
      result.current[1](null as any);
    });

    expect(result.current[0]).toBe(null);

    // Check that data is stored in versioned format
    const storedData = JSON.parse(localStorage.getItem(TEST_KEY) || '{}');
    expect(storedData.version).toBe(1);
    expect(storedData.data).toBe(null);
  });

  it('should persist state across hook re-renders', () => {
    const { result, rerender } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    act(() => {
      result.current[1]('updated-value');
    });

    rerender();

    expect(result.current[0]).toBe('updated-value');
  });

  it('reads a value stored in any other shape as missing', () => {
    localStorage.setItem(TEST_KEY, JSON.stringify('old-value'));

    const { result } = renderHook(() => useLocalStorage(TEST_KEY, INITIAL_VALUE));

    expect(result.current[0]).toBe(INITIAL_VALUE);
  });
});

describe('useLocalStorage as a shared store', () => {
  const KEY = 'shared-key';

  beforeEach(() => {
    localStorage.clear();
  });

  it('applies two functional updates in one tick (neither is lost)', () => {
    const { result } = renderHook(() => useLocalStorage(KEY, 0));

    act(() => {
      result.current[1](n => n + 1);
      result.current[1](n => n + 1);
    });

    expect(result.current[0]).toBe(2);
  });

  it('keeps every component using the key in sync', () => {
    const first = renderHook(() => useLocalStorage(KEY, 'a'));
    const second = renderHook(() => useLocalStorage(KEY, 'a'));

    act(() => {
      first.result.current[1]('b');
    });

    expect(second.result.current[0]).toBe('b');
  });

  it('has a setter that keeps its identity across renders', () => {
    const { result, rerender } = renderHook(() => useLocalStorage(KEY, { n: 1 }));
    const setter = result.current[1];

    act(() => {
      result.current[1]({ n: 2 });
    });
    rerender();

    expect(result.current[1]).toBe(setter);
  });

  it('returns the same object between reads until the value changes', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, data: { n: 1 } }));
    const { result, rerender } = renderHook(() => useLocalStorage(KEY, { n: 0 }));
    const firstRead = result.current[0];

    rerender();

    expect(result.current[0]).toBe(firstRead);
  });

  it('falls back to the initial value after the storage is cleared', () => {
    const { result, rerender } = renderHook(() => useLocalStorage(KEY, 'initial'));
    act(() => {
      result.current[1]('saved');
    });

    localStorage.clear();
    rerender();

    expect(result.current[0]).toBe('initial');
  });
});
