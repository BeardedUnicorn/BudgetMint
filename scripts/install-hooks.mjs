#!/usr/bin/env node
/**
 * Points git at .githooks (the root package's `prepare`, so `pnpm install`
 * runs it). Outside a git checkout, like a tarball, it does
 * nothing.
 */

import { execFileSync } from 'node:child_process';

const git = args => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] });

try {
  git(['rev-parse', '--git-dir']);
} catch {
  process.exit(0);
}
git(['config', 'core.hooksPath', '.githooks']);
