/**
 * The vitest setup every TypeScript package uses. Coverage exclusions come
 * from coverage-policy.json only, so a package can't quietly grow its own
 * list (scripts/check-coverage-policy.mjs rejects configs that try).
 */

import { defineConfig, type ViteUserConfig } from 'vitest/config';
import policy from './coverage-policy.json';

export interface BudgetmintTestOptions {
  /** The package's path from the repo root, as listed in coverage-policy.json. */
  packageDir: string;
  environment: 'jsdom' | 'node';
  plugins?: ViteUserConfig['plugins'];
  setupFiles?: string[];
}

const packages: Record<string, { glob: string }[]> = policy.typescript.packages;

const emulator = Boolean(process.env.BUDGETMINT_EMULATOR);

export function defineBudgetmintConfig({ packageDir, environment, plugins, setupFiles }: BudgetmintTestOptions) {
  const own = packages[packageDir];
  if (!own) {
    throw new Error(`${packageDir} is not listed in coverage-policy.json`);
  }
  return defineConfig({
    plugins,
    test: {
      environment,
      globals: true,
      setupFiles,
      // The Firestore emulator's tests run on their own, in a fresh emulator
      // (scripts/test-emulator.sh sets BUDGETMINT_EMULATOR)
      include: emulator ? ['src/**/*.emulator.test.ts'] : ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: emulator ? ['**/node_modules/**'] : ['**/node_modules/**', 'src/**/*.emulator.test.ts'],
      testTimeout: 10000,
      hookTimeout: 10000,
      reporters: ['verbose'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [...policy.typescript.allPackages, ...own].map(entry => entry.glob),
        thresholds: { 100: true },
      },
    },
  });
}
