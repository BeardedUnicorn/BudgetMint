/**
 * Whether a form's values differ from the ones it opened with (compared as
 * JSON), so closing it can ask before throwing a change away.
 */

import { useRef } from 'react';

export function useDirty(values: unknown): boolean {
  const opened = useRef(JSON.stringify(values));
  return JSON.stringify(values) !== opened.current;
}
