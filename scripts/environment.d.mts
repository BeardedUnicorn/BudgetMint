// Adapted from TaskMint scripts/environment.d.mts @ 8b486ac.
// Types for environment.mjs, which the apps' Vite configs import.

import type { Plugin } from 'vite';

export type EnvironmentName = 'production' | 'dev';

export interface EnvironmentProjects {
  /** BudgetMint's own project. */
  projectId: string;
  /** TaskMint's, for the forecast. */
  taskmintProjectId: string;
}

export declare const ENVIRONMENTS: Record<EnvironmentName, EnvironmentProjects>;
export declare const MARKER_FILE: string;
export declare function budgetmintEnvironment(env?: Record<string, string | undefined>): EnvironmentName;
export declare function environmentMarker(name: EnvironmentName): { environment: EnvironmentName } & EnvironmentProjects;
export declare function readEnvironmentMarker(path: string): { environment: EnvironmentName } & EnvironmentProjects;
export declare function budgetmintEnvironmentPlugin(env?: Record<string, string | undefined>): Plugin;
