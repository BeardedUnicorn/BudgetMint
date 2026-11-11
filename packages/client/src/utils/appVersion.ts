// Adapted from TaskMint packages/client/src/utils/appVersion.ts @ 1623bee.
/**
 * The app's version: the release writes it into every manifest, this
 * package's among them.
 */

import packageJson from '../../package.json';

export const APP_VERSION: string = packageJson.version;
