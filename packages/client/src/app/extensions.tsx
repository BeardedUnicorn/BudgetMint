/**
 * What the shell adds to the app (the desktop's Updates section and update
 * prompt), for the parts that show it.
 */

import { createContext, useContext } from 'react';
import type { AppExtensions } from '../shell/types';

export const AppExtensionsContext = createContext<AppExtensions>({});

export function useAppExtensions(): AppExtensions {
  return useContext(AppExtensionsContext);
}
