// Adapted from TaskMint scripts/environment.mjs @ 8b486ac.
/**
 * Which pair of Firebase projects a build talks to: production's (BudgetMint's
 * `budgetmint` and TaskMint's `taskmint-f9a05`, what releases use) or dev's
 * (`budgetmint-dev` and TaskMint's `taskmint-dev`, every other build; ADR
 * 0005). One variable, BUDGETMINT_ENV, chooses it for every tool a build
 * runs:
 *
 * - Vite (apps/web, apps/desktop): the Firebase configs and
 *   dist/environment.json (this module's plugin);
 * - Cargo (apps/desktop/src-tauri/build.rs): the desktop's link scheme and
 *   start-up check;
 * - Gradle (gen/android/app/build.gradle.kts): the Android package, label,
 *   google-services.json and Analytics.
 *
 * Unset means dev. Only scripts/release.mjs and the release workflow's web
 * job set `production`. Anything else stops the build.
 */

import { readFileSync } from 'node:fs';

/** The environments, and the Firebase projects each one's builds use: BudgetMint's own, and TaskMint's for the forecast. */
export const ENVIRONMENTS = {
  production: { projectId: 'budgetmint', taskmintProjectId: 'taskmint-f9a05' },
  dev: { projectId: 'budgetmint-dev', taskmintProjectId: 'taskmint-dev' },
};

/** Where a build says which environment it was made for (dist/environment.json). */
export const MARKER_FILE = 'environment.json';

/** The environment `env` names (BUDGETMINT_ENV), dev when it names none. */
export function budgetmintEnvironment(env = process.env) {
  const name = env.BUDGETMINT_ENV || 'dev';
  if (!Object.hasOwn(ENVIRONMENTS, name)) {
    throw new Error(
      `BUDGETMINT_ENV is "${name}", but it can only be ${Object.keys(ENVIRONMENTS)
        .map(known => `"${known}"`)
        .join(' or ')} (unset means "dev").`
    );
  }
  return name;
}

/** What dist/environment.json holds for a build made for `name`. */
export function environmentMarker(name) {
  return { environment: name, ...ENVIRONMENTS[name] };
}

/**
 * Reads a build's dist/environment.json; throws, saying why, when there's
 * none or it doesn't name a known environment and its projects.
 */
export function readEnvironmentMarker(path) {
  let marker;
  try {
    marker = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} can't be read (${error.message}). Build first.`);
  }
  const name = marker?.environment;
  const known = Object.hasOwn(ENVIRONMENTS, name ?? '') ? ENVIRONMENTS[name] : null;
  if (!known || marker.projectId !== known.projectId || marker.taskmintProjectId !== known.taskmintProjectId) {
    throw new Error(`${path} doesn't name a known environment: ${JSON.stringify(marker)}`);
  }
  return marker;
}

/**
 * The Vite plugin that makes a build its environment's: it defines
 * `import.meta.env.BUDGETMINT_ENV`, writes dist/environment.json, and titles
 * a dev page "BudgetMint Dev".
 */
export function budgetmintEnvironmentPlugin(env = process.env) {
  const name = budgetmintEnvironment(env);
  return {
    name: 'budgetmint-environment',
    config: () => ({ define: { 'import.meta.env.BUDGETMINT_ENV': JSON.stringify(name) } }),
    transformIndexHtml: html =>
      name === 'production' ? html : html.replace('<title>BudgetMint</title>', '<title>BudgetMint Dev</title>'),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: MARKER_FILE,
        source: `${JSON.stringify(environmentMarker(name))}\n`,
      });
    },
  };
}
