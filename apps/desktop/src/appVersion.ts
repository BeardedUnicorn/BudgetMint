/**
 * The running app's version: the release writes it into this package's
 * manifest, and tauri.conf.json takes the app's version from there too.
 */

import packageJson from '../package.json';

export const APP_VERSION: string = packageJson.version;
