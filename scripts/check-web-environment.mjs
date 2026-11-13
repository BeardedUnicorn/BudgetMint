#!/usr/bin/env node
// Adapted from TaskMint scripts/check-web-environment.mjs @ 8b486ac.
/**
 * Hosting's predeploy step (firebase.json): refuses to deploy apps/web/dist
 * to a project other than the one it was built for, so a dev build never
 * reaches the production site, and a production build never reaches dev's.
 * firebase-tools names the project it's deploying to in GCLOUD_PROJECT.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_FILE, readEnvironmentMarker } from './environment.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Why `marker`'s build can't go to `project`, or null when it can. */
export function deployProblem(marker, project) {
  if (!project) return 'GCLOUD_PROJECT is unset: run this through `pnpm firebase deploy`.';
  if (marker.projectId === project) return null;
  return (
    `apps/web/dist was built for ${marker.environment} (${marker.projectId}), not ${project}. ` +
    `Build it with BUDGETMINT_ENV=${marker.environment === 'dev' ? 'production' : 'dev'}, or deploy to ${marker.projectId}.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const marker = readEnvironmentMarker(join(root, 'apps/web/dist', MARKER_FILE));
    const problem = deployProblem(marker, process.env.GCLOUD_PROJECT);
    if (problem) {
      console.error(`Not deploying: ${problem}`);
      process.exit(1);
    }
    console.log(`apps/web/dist is a ${marker.environment} build, for ${marker.projectId}.`);
  } catch (error) {
    console.error(`Not deploying: ${error.message}`);
    process.exit(1);
  }
}
