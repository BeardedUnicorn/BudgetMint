// Adapted from TaskMint scripts/release/lib.test.mjs @ 1623bee.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  assetName,
  buildPlan,
  buildTargets,
  bumpVersion,
  bundlePath,
  cargoTomlName,
  cargoTomlVersion,
  changelogVersions,
  DESKTOP_TARGETS,
  extractSection,
  highestBump,
  insertSection,
  isoDate,
  isTarget,
  isVersion,
  missingAssets,
  packageJsonVersion,
  parseNote,
  RELEASE_TARGETS,
  releaseAssets,
  releaseDownloadUrl,
  renderSection,
  setCargoLockVersions,
  setCargoTomlVersion,
  setPackageJsonVersion,
  TARGETS,
  UPDATE_MANIFEST,
  updateAssetNames,
  updateBundlePaths,
  updateManifest,
  verifyApkSigner,
  verifyUpdateSignature,
} from './lib.mjs';

const note = (front, body = 'A change.') => `---\n${front}\n---\n${body}\n`;

describe('parseNote', () => {
  it('reads the bump, the type and the text', () => {
    assert.deepEqual(parseNote('a.md', note('bump: minor\ntype: Added', 'Bills that repeat\nevery two weeks.')), {
      file: 'a.md',
      bump: 'minor',
      type: 'Added',
      items: ['Bills that repeat every two weeks.'],
    });
  });

  it('makes a bullet of each - line, with following lines joining it', () => {
    const text = note('bump: patch\ntype: Fixed', '- One fix\n  that wraps.\n\n- Another fix.');
    assert.deepEqual(parseNote('b.md', text).items, ['One fix that wraps.', 'Another fix.']);
  });

  it('ignores comments, blank lines and CRLF line ends in the front matter', () => {
    const text = '---\r\nbump: major   # major | minor | patch\r\n\r\ntype: Changed # why\r\n---\r\nText.\r\n';
    const parsed = parseNote('c.md', text);
    assert.equal(parsed.bump, 'major');
    assert.equal(parsed.type, 'Changed');
    assert.deepEqual(parsed.items, ['Text.']);
  });

  const invalid = [
    ['no front matter', 'Just text.', /start with a --- line/],
    ['an unclosed front matter', '---\nbump: minor\ntype: Added\nText.', /no closing ---/],
    ['an unreadable line', note('bump minor\ntype: Added'), /can't read "bump minor"/],
    ['an unknown field', note('bump: minor\ntype: Added\nscope: web'), /unknown field "scope"/],
    ['no bump', note('type: Added'), /no bump/],
    ['an unknown bump', note('bump: huge\ntype: Added'), /bump "huge" isn't one of patch, minor, major/],
    ['no type', note('bump: minor'), /no type/],
    ['an unknown type', note('bump: minor\ntype: Feature'), /type "Feature" isn't one of/],
    ['no text', note('bump: minor\ntype: Added', '  \n'), /no text/],
  ];
  for (const [what, text, message] of invalid) {
    it(`rejects ${what}, naming the file`, () => {
      assert.throws(
        () => parseNote('changes/x.md', text),
        error => error.message.startsWith('changes/x.md: ') && message.test(error.message)
      );
    });
  }
});

describe('highestBump', () => {
  it('is the highest level any note asks for', () => {
    assert.equal(highestBump([{ bump: 'patch' }, { bump: 'minor' }, { bump: 'patch' }]), 'minor');
    assert.equal(highestBump([{ bump: 'minor' }, { bump: 'major' }]), 'major');
    assert.equal(highestBump([{ bump: 'patch' }]), 'patch');
  });

  it('is null with no notes', () => {
    assert.equal(highestBump([]), null);
  });
});

describe('versions', () => {
  it('bumps each level, resetting the lower ones', () => {
    assert.equal(bumpVersion('2.3.4', 'patch'), '2.3.5');
    assert.equal(bumpVersion('2.3.4', 'minor'), '2.4.0');
    assert.equal(bumpVersion('2.3.4', 'major'), '3.0.0');
  });

  it("rejects a version that isn't X.Y.Z, and an unknown level", () => {
    assert.throws(() => bumpVersion('2.3', 'patch'), /"2.3" isn't a version/);
    assert.throws(() => bumpVersion('2.3.4-beta', 'patch'), /isn't a version/);
    assert.throws(() => bumpVersion('2.3.4', 'mega'), /"mega" isn't one of/);
  });

  it('tells a version from anything else', () => {
    assert.equal(isVersion('10.0.12'), true);
    assert.equal(isVersion('v1.0.0'), false);
  });

  it('formats a local date', () => {
    assert.equal(isoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});

describe('the CHANGELOG', () => {
  const header = '# Changelog\n\nIntro.\n';
  const existing = `${header}\n## 2.0.0 – 2026-11-07\n\n### Added\n\n- Old thing.\n\n## 1.0.0 – 2026-10-11\n\n- First.\n`;
  const notes = [
    { file: 'z.md', type: 'Fixed', items: ['A fix.'] },
    { file: 'b.md', type: 'Added', items: ['Second, by file name.'] },
    { file: 'a.md', type: 'Added', items: ['First, by file name.', 'And its other bullet.'] },
  ];

  it('renders the notes by type, then file name', () => {
    assert.equal(
      renderSection('2.1.0', '2026-11-08', notes),
      [
        '## 2.1.0 – 2026-11-08',
        '',
        '### Added',
        '',
        '- First, by file name.',
        '- And its other bullet.',
        '- Second, by file name.',
        '',
        '### Fixed',
        '',
        '- A fix.',
        '',
      ].join('\n')
    );
  });

  it('says so when there are no notes', () => {
    assert.equal(renderSection('2.0.1', '2026-11-08', []), '## 2.0.1 – 2026-11-08\n\nNo user-facing changes.\n');
  });

  it('adds a section above the newest one', () => {
    const section = renderSection('2.1.0', '2026-11-08', [notes[0]]);
    const next = insertSection(existing, '2.1.0', section);
    assert.deepEqual(changelogVersions(next), ['2.1.0', '2.0.0', '1.0.0']);
    assert.ok(next.startsWith(`${header}\n## 2.1.0 – 2026-11-08\n\n### Fixed\n\n- A fix.\n\n## 2.0.0`));
  });

  it('adds the first section after the header', () => {
    assert.equal(insertSection(header, '1.0.0', '## 1.0.0 – 2026-10-11\n'), `${header}\n## 1.0.0 – 2026-10-11\n`);
  });

  it('refuses a version it already has', () => {
    assert.throws(() => insertSection(existing, '2.0.0', '## 2.0.0 – x\n'), /already has 2.0.0/);
  });

  it("extracts a version's notes without the heading", () => {
    assert.equal(extractSection(existing, '2.0.0'), '### Added\n\n- Old thing.');
    assert.equal(extractSection(existing, '1.0.0'), '- First.');
    assert.equal(extractSection(existing, '3.0.0'), null);
  });
});

describe('manifests', () => {
  it('reads and sets the version in a package.json, keeping its layout', () => {
    const text = '{\n  "name": "@budgetmint/web",\n  "version": "2.0.0",\n  "dependencies": { "x": "1.0.0" }\n}\n';
    assert.equal(packageJsonVersion(text, 'p.json'), '2.0.0');
    assert.equal(setPackageJsonVersion(text, '2.1.0', 'p.json'), text.replace('"2.0.0"', '"2.1.0"'));
    assert.throws(() => packageJsonVersion('{}', 'p.json'), /p.json: no "version"/);
  });

  const toml = [
    '[package]',
    'name = "budgetmint-wasm"',
    'version = "2.0.0"',
    'edition = "2021"',
    '',
    '[dependencies]',
    'version = "9.9.9"',
    'serde = { version = "1" }',
    '',
  ].join('\n');

  it("reads and sets a Cargo.toml's [package] version, and nothing else", () => {
    assert.equal(cargoTomlVersion(toml, 'Cargo.toml'), '2.0.0');
    assert.equal(cargoTomlName(toml, 'Cargo.toml'), 'budgetmint-wasm');
    assert.equal(setCargoTomlVersion(toml, '2.1.0', 'Cargo.toml'), toml.replace('"2.0.0"', '"2.1.0"'));
  });

  it('works when [package] is the last table', () => {
    const only = '[package]\nname = "a"\nversion = "1.0.0"\n';
    assert.equal(setCargoTomlVersion(only, '1.0.1', 'Cargo.toml'), only.replace('1.0.0', '1.0.1'));
  });

  it('rejects a Cargo.toml without a [package] version', () => {
    assert.throws(() => cargoTomlVersion('[workspace]\nmembers = []\n', 'Cargo.toml'), /no \[package\] table/);
    assert.throws(() => cargoTomlVersion('[package]\nname = "a"\n[x]\nversion = "1"\n', 'C.toml'), /no version/);
  });

  const lock = [
    '[[package]]',
    'name = "budgetmint"',
    'version = "2.0.0"',
    '',
    '[[package]]',
    'name = "budgetmint-core"',
    'version = "2.0.0"',
    '',
    '[[package]]',
    'name = "budgetmint-corex"',
    'version = "0.3.0"',
    '',
  ].join('\n');

  it("sets the named packages' versions in Cargo.lock", () => {
    const next = setCargoLockVersions(lock, ['budgetmint', 'budgetmint-core'], '2.1.0');
    assert.equal(next, lock.replaceAll('"2.0.0"', '"2.1.0"'));
  });

  it("refuses a package Cargo.lock doesn't list", () => {
    assert.throws(() => setCargoLockVersions(lock, ['budgetmint-wasm'], '2.1.0'), /lists budgetmint-wasm 0 times/);
  });
});

describe('targets', () => {
  const mac = { platform: 'darwin', arch: 'arm64' };
  const intelMac = { platform: 'darwin', arch: 'x64' };
  const windows = { platform: 'win32', arch: 'x64' };
  const linux = { platform: 'linux', arch: 'x64' };

  it("names each target's file", () => {
    assert.deepEqual(
      TARGETS.map(target => assetName('BudgetMint', '2.2.0', target)),
      [
        'BudgetMint-2.2.0-macos-arm64.dmg',
        'BudgetMint-2.2.0-macos-x64.dmg',
        'BudgetMint-2.2.0-windows-x64-setup.exe',
        'BudgetMint-2.2.0-android-arm64.apk',
      ]
    );
  });

  it('ships the desktop installers, and no APK until the workflow builds one', () => {
    assert.deepEqual(RELEASE_TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64']);
    assert.ok(!releaseAssets('BudgetMint', '2.2.0').includes('BudgetMint-2.2.0-android-arm64.apk'));
  });

  it('tells a target from anything else', () => {
    assert.equal(isTarget('windows-x64'), true);
    assert.equal(isTarget('windows'), false);
    assert.throws(
      () => assetName('BudgetMint', '2.2.0', 'linux-x64'),
      /Unknown target "linux-x64" \(one of macos-arm64/
    );
  });

  it("lists the release's files that aren't there", () => {
    const all = releaseAssets('BudgetMint', '2.2.0');
    assert.deepEqual(missingAssets('BudgetMint', '2.2.0', all), []);
    const updates = all.slice(RELEASE_TARGETS.length);
    assert.deepEqual(
      missingAssets('BudgetMint', '2.2.0', [
        'BudgetMint-2.2.0-macos-arm64.dmg',
        'BudgetMint-2.1.0-macos-x64.dmg',
        ...updates,
      ]),
      ['BudgetMint-2.2.0-macos-x64.dmg', 'BudgetMint-2.2.0-windows-x64-setup.exe']
    );
    assert.deepEqual(missingAssets('BudgetMint', '2.2.0', all.slice(0, RELEASE_TARGETS.length)), updates);
  });

  it('builds a Mac installer natively, or cross-compiled for the other CPU', () => {
    assert.deepEqual(buildPlan('macos-arm64', mac), { kind: 'tauri', triple: null });
    assert.deepEqual(buildPlan('macos-x64', mac), { kind: 'tauri', triple: 'x86_64-apple-darwin' });
    assert.deepEqual(buildPlan('macos-x64', intelMac), { kind: 'tauri', triple: null });
    assert.deepEqual(buildPlan('macos-arm64', intelMac), { kind: 'tauri', triple: 'aarch64-apple-darwin' });
  });

  it('builds the Windows installer on Windows, or with cargo-xwin on a Mac', () => {
    assert.deepEqual(buildPlan('windows-x64', windows), { kind: 'tauri', triple: null });
    assert.deepEqual(buildPlan('windows-x64', mac), { kind: 'xwin', triple: 'x86_64-pc-windows-msvc' });
  });

  it('builds the APK on macOS or Linux', () => {
    const android = { kind: 'android', triple: 'aarch64-linux-android', tauriTarget: 'aarch64' };
    assert.deepEqual(buildPlan('android-arm64', mac), android);
    assert.deepEqual(buildPlan('android-arm64', intelMac), android);
    assert.deepEqual(buildPlan('android-arm64', linux), android);
  });

  it("refuses a target the host can't build", () => {
    assert.throws(() => buildPlan('macos-arm64', windows), /^Error: macos-arm64 can't be built on Windows \(x64\)$/);
    assert.throws(() => buildPlan('windows-x64', linux), /windows-x64 can't be built on Linux \(x64\)/);
    assert.throws(() => buildPlan('android-arm64', windows), /android-arm64 can't be built on Windows/);
    assert.throws(() => buildPlan('macos-x64', { platform: 'freebsd', arch: 'x64' }), /on freebsd \(x64\)/);
  });

  it("finds Tauri's installer in target/release, or under the triple when cross-compiled", () => {
    const at = (target, host) => bundlePath('BudgetMint', '2.2.0', target, buildPlan(target, host));
    assert.equal(at('macos-arm64', mac), 'target/release/bundle/dmg/BudgetMint_2.2.0_aarch64.dmg');
    assert.equal(at('macos-x64', mac), 'target/x86_64-apple-darwin/release/bundle/dmg/BudgetMint_2.2.0_x64.dmg');
    assert.equal(at('windows-x64', windows), 'target/release/bundle/nsis/BudgetMint_2.2.0_x64-setup.exe');
    assert.equal(
      at('windows-x64', mac),
      'target/x86_64-pc-windows-msvc/release/bundle/nsis/BudgetMint_2.2.0_x64-setup.exe'
    );
  });

  it("finds Gradle's APK in the Android project", () => {
    assert.equal(
      bundlePath('BudgetMint', '2.2.0', 'android-arm64', buildPlan('android-arm64', linux)),
      'apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'
    );
    assert.throws(
      () => bundlePath('BudgetMint', '2.2.0', 'android-arm64', { kind: 'tauri', triple: null }),
      /isn't a Tauri bundle/
    );
  });

  it("builds the host's own installer unless targets are named", () => {
    assert.deepEqual(buildTargets(mac), ['macos-arm64']);
    assert.deepEqual(buildTargets(intelMac), ['macos-x64']);
    assert.deepEqual(buildTargets(windows), ['windows-x64']);
    assert.deepEqual(buildTargets({ ...linux, targets: ['android-arm64'] }), ['android-arm64']);
    assert.throws(() => buildTargets(linux), /There's no installer for Linux \(x64\): name one with --target/);
  });

  it('builds the named targets once each, in order, with --windows adding windows-x64', () => {
    assert.deepEqual(buildTargets({ ...mac, targets: ['macos-x64', 'macos-arm64', 'macos-x64'] }), [
      'macos-x64',
      'macos-arm64',
    ]);
    assert.deepEqual(buildTargets({ ...mac, windows: true }), ['macos-arm64', 'windows-x64']);
    assert.deepEqual(buildTargets({ ...mac, windows: true, targets: ['windows-x64'] }), ['windows-x64']);
    assert.throws(() => buildTargets({ ...mac, targets: ['ios'] }), /Unknown target "ios"/);
  });
});

describe('desktop updates', () => {
  const mac = { kind: 'tauri', triple: null };
  const intel = { kind: 'tauri', triple: 'x86_64-apple-darwin' };
  const xwin = { kind: 'xwin', triple: 'x86_64-pc-windows-msvc' };

  it('ships each desktop target an update and its signature; Windows updates with its installer', () => {
    assert.deepEqual(DESKTOP_TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64']);
    assert.deepEqual(
      DESKTOP_TARGETS.map(target => updateAssetNames('BudgetMint', '2.3.0', target)),
      [
        { file: 'BudgetMint-2.3.0-macos-arm64.app.tar.gz', signature: 'BudgetMint-2.3.0-macos-arm64.app.tar.gz.sig' },
        { file: 'BudgetMint-2.3.0-macos-x64.app.tar.gz', signature: 'BudgetMint-2.3.0-macos-x64.app.tar.gz.sig' },
        {
          file: 'BudgetMint-2.3.0-windows-x64-setup.exe',
          signature: 'BudgetMint-2.3.0-windows-x64-setup.exe.sig',
        },
      ]
    );
    assert.deepEqual(releaseAssets('BudgetMint', '2.3.0').slice(RELEASE_TARGETS.length), [
      'BudgetMint-2.3.0-macos-arm64.app.tar.gz',
      'BudgetMint-2.3.0-macos-arm64.app.tar.gz.sig',
      'BudgetMint-2.3.0-macos-x64.app.tar.gz',
      'BudgetMint-2.3.0-macos-x64.app.tar.gz.sig',
      'BudgetMint-2.3.0-windows-x64-setup.exe.sig',
    ]);
    assert.throws(() => updateAssetNames('BudgetMint', '2.3.0', 'android-arm64'), /android-arm64 has no updates/);
    assert.throws(() => updateAssetNames('BudgetMint', '2.3.0', 'ios'), /Unknown target "ios"/);
  });

  it("finds Tauri's updates beside its installers", () => {
    assert.deepEqual(updateBundlePaths('BudgetMint', '2.3.0', 'macos-arm64', mac), {
      file: 'target/release/bundle/macos/BudgetMint.app.tar.gz',
      signature: 'target/release/bundle/macos/BudgetMint.app.tar.gz.sig',
    });
    assert.deepEqual(updateBundlePaths('BudgetMint', '2.3.0', 'macos-x64', intel), {
      file: 'target/x86_64-apple-darwin/release/bundle/macos/BudgetMint.app.tar.gz',
      signature: 'target/x86_64-apple-darwin/release/bundle/macos/BudgetMint.app.tar.gz.sig',
    });
    assert.deepEqual(updateBundlePaths('BudgetMint', '2.3.0', 'windows-x64', xwin), {
      file: 'target/x86_64-pc-windows-msvc/release/bundle/nsis/BudgetMint_2.3.0_x64-setup.exe',
      signature: 'target/x86_64-pc-windows-msvc/release/bundle/nsis/BudgetMint_2.3.0_x64-setup.exe.sig',
    });
    assert.throws(
      () =>
        updateBundlePaths('BudgetMint', '2.3.0', 'android-arm64', {
          kind: 'android',
          triple: 'aarch64-linux-android',
          tauriTarget: 'aarch64',
        }),
      /no updates/
    );
  });

  it('writes latest.json, which points each platform at its update', () => {
    const downloadUrl = releaseDownloadUrl('BeardedUnicorn/BudgetMint', '2.3.0');
    assert.equal(downloadUrl, 'https://github.com/BeardedUnicorn/BudgetMint/releases/download/v2.3.0');
    assert.equal(UPDATE_MANIFEST, 'latest.json');
    const manifest = updateManifest({
      product: 'BudgetMint',
      version: '2.3.0',
      notes: '### Added\n\n- Updates.',
      pubDate: '2026-11-20T10:00:00Z',
      downloadUrl,
      signatures: { 'macos-arm64': 'c2lnLWFybQ==\n', 'macos-x64': 'c2lnLXg2NA==', 'windows-x64': 'c2lnLXdpbg==' },
    });
    assert.deepEqual(manifest, {
      version: '2.3.0',
      notes: '### Added\n\n- Updates.',
      pub_date: '2026-11-20T10:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'c2lnLWFybQ==', url: `${downloadUrl}/BudgetMint-2.3.0-macos-arm64.app.tar.gz` },
        'darwin-x86_64': { signature: 'c2lnLXg2NA==', url: `${downloadUrl}/BudgetMint-2.3.0-macos-x64.app.tar.gz` },
        'windows-x86_64': { signature: 'c2lnLXdpbg==', url: `${downloadUrl}/BudgetMint-2.3.0-windows-x64-setup.exe` },
      },
    });
    assert.throws(
      () =>
        updateManifest({
          product: 'BudgetMint',
          version: '2.3.0',
          notes: '',
          pubDate: '',
          downloadUrl,
          signatures: { 'macos-arm64': 'x', 'macos-x64': ' ' },
        }),
      /There's no update signature for macos-x64/
    );
  });
});

describe('update signatures', () => {
  // `tauri signer generate`'s public key, and `tauri signer sign` of "hello"
  // (a throwaway key, made for this test)
  const tauriKey =
    'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk1QjVGMDdCMzk5NzcxNjgKUldSb2NaYzVlL0MxbFdZV1dGK01PVFhlMDhtVm55dDlRTUtjVDh0NzltMjZ3ZDdZY25DNHVIZ3gK';
  const tauriSignature =
    'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSb2NaYzVlL0MxbFZYckVSTldqZ2FrbkFGbmxKTTBpWmxaeFdKU21oZEU0UjR1Sm9jTGxQWkI4a0ZyYnNjUHhEc3h1ZXY5WDFrRmI4blByM1RFMUpZYmZCMHBRWnd2Q3djPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0MTA4ODQ2CWZpbGU6aGVsbG8udHh0Ci9PTGprVUh6ejZBOU1NU0c3TDFaMGVvL2VQYmRDc21VTDlEaGZlaXMwMDhWSVQxWTRRcTVSeUdwNFFXK0FpMmtKTU5CRVNhNXFGdUJOUzZvQ3laWUNnPT0K';

  /** A minisign key of our own, so the test can make any signature. */
  function keyPair(id = Buffer.from('0123456789abcdef', 'hex')) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const file = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64')}\n`;
    const signFile = (data, { algorithm = 'ED', comment = 'timestamp:1\tfile:x', tamper = false } = {}) => {
      const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
      const signature = sign(null, message, privateKey);
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      const trusted = tamper ? `${comment}x` : comment;
      const lines = [
        'untrusted comment: signature',
        Buffer.concat([Buffer.from(algorithm), id, signature]).toString('base64'),
        `trusted comment: ${trusted}`,
        global.toString('base64'),
      ];
      return Buffer.from(`${lines.join('\n')}\n`).toString('base64');
    };
    return { publicKey: Buffer.from(file).toString('base64'), signFile };
  }

  const data = Buffer.from('the update');

  it("accepts Tauri's own signature", () => {
    verifyUpdateSignature({ publicKey: tauriKey, signature: tauriSignature, data: Buffer.from('hello') });
    assert.throws(
      () => verifyUpdateSignature({ publicKey: tauriKey, signature: tauriSignature, data: Buffer.from('hellO') }),
      /The update's signature doesn't match the file/
    );
  });

  it('accepts a signature of the file or of its hash, by the trusted key', () => {
    const { publicKey, signFile } = keyPair();
    verifyUpdateSignature({ publicKey, signature: signFile(data), data });
    verifyUpdateSignature({ publicKey, signature: signFile(data, { algorithm: 'Ed' }), data });
  });

  it('names the key an update was signed with when the app trusts another', () => {
    const { signFile } = keyPair(Buffer.from('1111111111111111', 'hex'));
    assert.throws(
      () => verifyUpdateSignature({ publicKey: tauriKey, signature: signFile(data), data }),
      /The update is signed with key 1111111111111111, but the app trusts key 95B5F07B39977168/
    );
  });

  it('refuses a changed trusted comment', () => {
    const { publicKey, signFile } = keyPair();
    assert.throws(
      () => verifyUpdateSignature({ publicKey, signature: signFile(data, { tamper: true }), data }),
      /trusted comment doesn't match/
    );
  });

  it("refuses a key or signature that isn't minisign's", () => {
    const { publicKey, signFile } = keyPair();
    for (const key of ['REPLACE_WITH_THE_UPDATER_PUBLIC_KEY', '', Buffer.from('a\nb').toString('base64')]) {
      assert.throws(
        () => verifyUpdateSignature({ publicKey: key, signature: signFile(data), data }),
        /isn't a minisign public key/
      );
    }
    for (const signature of ['', Buffer.from('a\nRVg=\n').toString('base64'), signFile(data, { algorithm: 'XX' })]) {
      assert.throws(() => verifyUpdateSignature({ publicKey, signature, data }), /isn't a minisign signature/);
    }
  });
});

describe('verifyApkSigner', () => {
  const digest = 'ae7c98352144a252bae1e451277a8cdfd161f09a8c71736c234ac4680be4ecc0';
  const other = 'a'.repeat(64);
  // Build-Tools 36 and earlier: "Signer #1 certificate …"
  const signer = (n, sha256) => lines(`Signer #${n} certificate`, sha256);
  // Build-Tools 37: the strongest scheme it verified, and a number only when
  // there's more than one signer ("V2 Signer: certificate …",
  // "V3.0 Signer: certificate …", "V2 Signer #2: certificate …")
  const schemeSigner = (scheme, n, sha256) => lines(`${scheme} Signer${n ? ` #${n}` : ''}: certificate`, sha256);
  const lines = (prefix, sha256) =>
    [
      `${prefix} DN: CN=BudgetMint`,
      `${prefix} SHA-256 digest: ${sha256}`,
      `${prefix} SHA-1 digest: ${'b'.repeat(40)}`,
      `${prefix} MD5 digest: ${'c'.repeat(32)}`,
    ].join('\n');

  it('accepts the one signer with the release certificate', () => {
    assert.doesNotThrow(() => verifyApkSigner({ output: `Verifies\n${signer(1, digest)}\n`, digest }));
    assert.doesNotThrow(() => verifyApkSigner({ output: signer(1, digest), digest: digest.toUpperCase() }));
  });

  it("reads Build-Tools 37's signer lines too", () => {
    assert.doesNotThrow(() => verifyApkSigner({ output: schemeSigner('V2', 0, digest), digest }));
    assert.doesNotThrow(() => verifyApkSigner({ output: `${schemeSigner('V3.0', 0, digest)}\n`, digest }));
    assert.throws(
      () => verifyApkSigner({ output: schemeSigner('V2', 0, other), digest }),
      new RegExp(`^Error: The APK is signed with certificate ${other}, but releases are signed with ${digest}$`)
    );
    assert.throws(
      () => verifyApkSigner({ output: `${schemeSigner('V2', 1, digest)}\n${schemeSigner('V2', 2, other)}`, digest }),
      /The APK has 2 signers; a release has one/
    );
  });

  it('refuses another key, no signer, or more than one', () => {
    assert.throws(
      () => verifyApkSigner({ output: signer(1, other), digest }),
      new RegExp(`^Error: The APK is signed with certificate ${other}, but releases are signed with ${digest}$`)
    );
    assert.throws(() => verifyApkSigner({ output: 'Verifies\n', digest }), /apksigner found no signer in the APK/);
    assert.throws(
      () => verifyApkSigner({ output: `${signer(1, digest)}\n${signer(2, other)}`, digest }),
      /The APK has 2 signers; a release has one/
    );
  });
});
