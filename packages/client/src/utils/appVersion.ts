// Adapted from TaskMint packages/client/src/utils/appVersion.ts @ 1623bee.
/**
 * The app's version: the release writes it into every manifest, this
 * package's among them.
 */

import packageJson from '../../package.json';

export const APP_VERSION: string = packageJson.version;

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** Whether `value` is a version like 2.1.0. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** Orders two versions: below zero when `a` is older, above when it's newer. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
