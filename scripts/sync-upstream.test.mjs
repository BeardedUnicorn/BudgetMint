import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expand, problems, sha256 } from './sync-upstream.mjs';

describe('sync-upstream', () => {
  it('maps a file to itself, and a folder to each JSON file in it, in order', () => {
    assert.deepEqual(
      expand({ from: 'a/rules', to: 'b/rules' }, () => assert.fail('no listing for a file')),
      [{ from: 'a/rules', to: 'b/rules' }]
    );
    assert.deepEqual(
      expand({ from: 'docs/x/', to: 'here/' }, () => ['b.json', 'README.md', 'a.json']),
      [
        { from: 'docs/x/a.json', to: 'here/a.json' },
        { from: 'docs/x/b.json', to: 'here/b.json' },
      ]
    );
  });

  it('finds copies missing, edited here, or not pinned', () => {
    const pin = {
      sources: [
        { from: 'r', to: 'rules' },
        { from: 'f/', to: 'fixtures/' },
      ],
      files: { rules: sha256('allow'), 'fixtures/a.json': sha256('{}'), 'fixtures/b.json': sha256('[]') },
    };
    const local = { rules: 'allow!', 'fixtures/a.json': '{}' };
    const found = problems(
      pin,
      path => (path in local ? Buffer.from(local[path]) : null),
      dir => (dir === 'fixtures/' ? ['a.json', 'extra.json'] : [])
    );
    assert.deepEqual(found, [
      "rules isn't TaskMint's (edited here?)",
      'fixtures/b.json is missing',
      "fixtures/extra.json isn't pinned",
    ]);
    assert.deepEqual(
      problems(
        pin,
        path => Buffer.from({ rules: 'allow', 'fixtures/a.json': '{}', 'fixtures/b.json': '[]' }[path]),
        () => ['a.json', 'b.json']
      ),
      []
    );
  });
});
