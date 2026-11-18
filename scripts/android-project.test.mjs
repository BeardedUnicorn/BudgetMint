// What the Android project (apps/desktop/src-tauri/gen/android) has to say
// for the release build to start. The build itself is only made, and
// started, by the Release workflow (scripts/android-smoke.mjs); these run
// with every `pnpm verify`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = new URL('../apps/desktop/src-tauri/gen/android/app/', import.meta.url);
const read = name => readFileSync(new URL(name, app), 'utf8');
/** A file's lines that aren't comments. */
const code = (name, comment) =>
  read(name)
    .split('\n')
    .filter(line => !line.trim().startsWith(comment))
    .join('\n');

describe("the release build keeps WorkManager's database", () => {
  // 2.9.0 closed on opening: Glance alone brings work-runtime 2.7.1 and its
  // Room 2.2.5, whose keep rule lets R8 remove the constructor Room makes
  // WorkDatabase_Impl with. Room has kept it since 2.7.0, which work-runtime
  // has used since 2.11.0.
  it('asks for a work-runtime whose Room keeps the constructor', () => {
    const version = /implementation\("androidx\.work:work-runtime:(\d+)\.(\d+)\.(\d+)"\)/.exec(
      code('build.gradle.kts', '//')
    );
    assert.ok(version, 'app/build.gradle.kts has no androidx.work:work-runtime of its own');
    const [major, minor] = version.slice(1).map(Number);
    assert.ok(
      major > 2 || (major === 2 && minor >= 11),
      `work-runtime ${version.slice(1).join('.')} is older than 2.11.0`
    );
  });

  it('keeps it by its own rule too, whatever the libraries say', () => {
    assert.match(
      code('proguard-rules.pro', '#'),
      /^-keep class \* extends androidx\.room\.RoomDatabase \{\s*void <init>\(\);\s*\}/m
    );
  });
});
