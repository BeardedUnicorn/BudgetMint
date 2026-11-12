import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppDialogs } from '../AppDialogsContext';

describe('the app’s dialogs', () => {
  it('need their provider', () => {
    expect(() => renderHook(() => useAppDialogs())).toThrow(/AppDialogsProvider/);
  });
});
