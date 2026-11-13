// Adapted from TaskMint scripts/environment.test.mjs @ 8b486ac.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deployProblem } from './check-web-environment.mjs';
import {
  budgetmintEnvironment,
  budgetmintEnvironmentPlugin,
  ENVIRONMENTS,
  environmentMarker,
  readEnvironmentMarker,
} from './environment.mjs';

describe('budgetmintEnvironment', () => {
  it('is dev unless BUDGETMINT_ENV says production', () => {
    assert.equal(budgetmintEnvironment({}), 'dev');
    assert.equal(budgetmintEnvironment({ BUDGETMINT_ENV: '' }), 'dev');
    assert.equal(budgetmintEnvironment({ BUDGETMINT_ENV: 'dev' }), 'dev');
    assert.equal(budgetmintEnvironment({ BUDGETMINT_ENV: 'production' }), 'production');
  });

  it('stops on any other name', () => {
    assert.throws(() => budgetmintEnvironment({ BUDGETMINT_ENV: 'prod' }), /can only be "production" or "dev"/);
    assert.throws(() => budgetmintEnvironment({ BUDGETMINT_ENV: 'toString' }), /can only be/);
  });

  it('names a separate pair of Firebase projects for each environment', () => {
    assert.deepEqual(ENVIRONMENTS.production, { projectId: 'budgetmint', taskmintProjectId: 'taskmint-f9a05' });
    assert.deepEqual(ENVIRONMENTS.dev, { projectId: 'budgetmint-dev', taskmintProjectId: 'taskmint-dev' });
  });
});

describe('the environment marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'budgetmint-env-'));
  const file = join(dir, 'environment.json');
  const write = contents => writeFileSync(file, contents);

  it('reads back what a build wrote', () => {
    write(JSON.stringify(environmentMarker('dev')));
    assert.deepEqual(readEnvironmentMarker(file), {
      environment: 'dev',
      projectId: 'budgetmint-dev',
      taskmintProjectId: 'taskmint-dev',
    });
  });

  it('refuses a missing file, or one that names no known environment and its projects', () => {
    assert.throws(() => readEnvironmentMarker(join(dir, 'missing.json')), /can't be read.*Build first/);
    write('not json');
    assert.throws(() => readEnvironmentMarker(file), /can't be read/);
    write('null');
    assert.throws(() => readEnvironmentMarker(file), /doesn't name a known environment/);
    write(JSON.stringify({ environment: 'staging', projectId: 'budgetmint-dev', taskmintProjectId: 'taskmint-dev' }));
    assert.throws(() => readEnvironmentMarker(file), /doesn't name a known environment/);
    write(JSON.stringify({ environment: 'dev', projectId: 'budgetmint', taskmintProjectId: 'taskmint-dev' }));
    assert.throws(() => readEnvironmentMarker(file), /doesn't name a known environment/);
    // A dev build that would read production's forecast is no dev build
    write(JSON.stringify({ environment: 'dev', projectId: 'budgetmint-dev', taskmintProjectId: 'taskmint-f9a05' }));
    assert.throws(() => readEnvironmentMarker(file), /doesn't name a known environment/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the Vite plugin', () => {
  const emitted = plugin => {
    const files = [];
    plugin.generateBundle.call({ emitFile: file => files.push(file) });
    return files;
  };

  it('defines the environment, marks dist, and titles a dev page', () => {
    const dev = budgetmintEnvironmentPlugin({});
    assert.deepEqual(dev.config(), { define: { 'import.meta.env.BUDGETMINT_ENV': '"dev"' } });
    assert.equal(dev.transformIndexHtml('<title>BudgetMint</title>'), '<title>BudgetMint Dev</title>');
    assert.deepEqual(emitted(dev), [
      {
        type: 'asset',
        fileName: 'environment.json',
        source: '{"environment":"dev","projectId":"budgetmint-dev","taskmintProjectId":"taskmint-dev"}\n',
      },
    ]);
  });

  it('leaves a production page as it is', () => {
    const production = budgetmintEnvironmentPlugin({ BUDGETMINT_ENV: 'production' });
    assert.deepEqual(production.config(), { define: { 'import.meta.env.BUDGETMINT_ENV': '"production"' } });
    assert.equal(production.transformIndexHtml('<title>BudgetMint</title>'), '<title>BudgetMint</title>');
    assert.match(emitted(production)[0].source, /"projectId":"budgetmint","taskmintProjectId":"taskmint-f9a05"/);
  });

  it('stops the build on an unknown environment', () => {
    assert.throws(() => budgetmintEnvironmentPlugin({ BUDGETMINT_ENV: 'staging' }), /can only be/);
  });
});

describe("Hosting's predeploy check", () => {
  const dev = environmentMarker('dev');
  const production = environmentMarker('production');

  it('lets a build go to its own project', () => {
    assert.equal(deployProblem(dev, 'budgetmint-dev'), null);
    assert.equal(deployProblem(production, 'budgetmint'), null);
  });

  it('refuses a build for the other project, saying how to build the right one', () => {
    assert.match(
      deployProblem(dev, 'budgetmint'),
      /built for dev \(budgetmint-dev\), not budgetmint\..*BUDGETMINT_ENV=production/
    );
    assert.match(deployProblem(production, 'budgetmint-dev'), /built for production .*BUDGETMINT_ENV=dev/);
  });

  it('refuses when firebase-tools named no project', () => {
    assert.match(deployProblem(dev, undefined), /GCLOUD_PROJECT is unset/);
  });
});
