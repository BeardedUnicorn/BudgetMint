// Adapted from TaskMint packages/client/src/utils/__tests__/changelog.test.ts @ 1623bee.
import { describe, it, expect } from 'vitest';
import {
  combineReleases,
  groupReleasesByMajor,
  hasUserFacingChanges,
  parseChangelog,
  parseReleaseSection,
  RELEASES,
  releasesBetween,
  releasesSince,
  summarizeRelease,
} from '../changelog';
import { APP_VERSION, compareVersions, isVersion } from '../appVersion';
import { render, screen, within } from '@testing-library/react';
import { ReleaseNotes, ReleaseNotesList } from '../../components/ui/display/ReleaseNotes';

describe('parseChangelog', () => {
  it('reads each release, its date, its groups and their bullets', () => {
    const text = [
      '# Changelog',
      '',
      'About this file.',
      '',
      '## 2.1.0 – 2026-11-08',
      '',
      '### Added',
      '',
      '- One thing.',
      '- Another thing that',
      '  wraps.',
      '',
      '### Fixed',
      '',
      '- A fix.',
      '',
      '## 2.0.0 – 2026-11-07',
      '',
      'The intro, which',
      'wraps too.',
      '',
      '- A bullet with no heading.',
    ].join('\r\n');

    expect(parseChangelog(text)).toEqual([
      {
        version: '2.1.0',
        date: '2026-11-08',
        intro: [],
        groups: [
          { type: 'Added', items: ['One thing.', 'Another thing that wraps.'] },
          { type: 'Fixed', items: ['A fix.'] },
        ],
      },
      {
        version: '2.0.0',
        date: '2026-11-07',
        intro: ['The intro, which wraps too.'],
        groups: [{ type: '', items: ['A bullet with no heading.'] }],
      },
    ]);
  });

  it('takes a hyphen before the date, or no date', () => {
    expect(parseChangelog('## 1.2.3 - 2026-01-02\n## 1.2.2\n').map(({ version, date }) => [version, date])).toEqual([
      ['1.2.3', '2026-01-02'],
      ['1.2.2', null],
    ]);
  });

  it('is empty without any release', () => {
    expect(parseChangelog('# Changelog\n\nNothing yet.\n')).toEqual([]);
  });
});

describe('parseReleaseSection', () => {
  it("reads one release's section, whatever its version looks like", () => {
    expect(parseReleaseSection('2.3.0-beta.1', 'Intro.\n\n### Added\n\n- Updates.\n')).toEqual({
      version: '2.3.0-beta.1',
      date: null,
      intro: ['Intro.'],
      groups: [{ type: 'Added', items: ['Updates.'] }],
    });
  });
});

describe('ReleaseNotes', () => {
  it('shows the intro, then each heading over its bullets, with code in monospace', () => {
    const release = parseReleaseSection('1.2.0', 'Faster.\n\n### Added\n- The `forecast` page\n\n- Loose');
    render(<ReleaseNotes release={release} />);
    expect(screen.getByText('Faster.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.getByText('forecast').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('sets **bold** spans in bold, without their asterisks', () => {
    render(<ReleaseNotes release={parseReleaseSection('1.2.0', '- **Pay now** is **Mark paid**.')} />);
    expect(screen.getByText('Pay now').tagName).toBe('STRONG');
    expect(screen.getByText('Mark paid').tagName).toBe('STRONG');
    expect(screen.getByRole('listitem').textContent).toBe('Pay now is Mark paid.');
  });
});

describe('ReleaseNotesList', () => {
  it('shows each release under its version and date, its groups a level below', () => {
    const releases = parseChangelog(
      '## 2.3.0 – 2026-11-20\n\n### Added\n\n- Updates.\n\n## 2.2.1\n\n### Fixed\n\n- A fix.\n'
    );
    render(<ReleaseNotesList releases={releases} />);

    expect(screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent)).toEqual([
      '2.3.0 · Nov 20, 2026',
      '2.2.1',
    ]);
    const newest = screen.getByRole('region', { name: '2.3.0' });
    expect(within(newest).getByRole('heading', { level: 5, name: 'Added' })).toBeInTheDocument();
    expect(within(newest).getByText('Updates.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '2.2.1' })).getByText('A fix.')).toBeInTheDocument();
  });
});

describe('RELEASES', () => {
  it("has notes for the app's own version, newest first", () => {
    expect(RELEASES[0].version).toBe(APP_VERSION);
    expect(RELEASES[0].groups.length + RELEASES[0].intro.length).toBeGreaterThan(0);
  });
});

describe('compareVersions', () => {
  it('orders versions by their numbers, not their text', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.1', '2.0.2')).toBeLessThan(0);
    expect(compareVersions('2.5.0', '2.5.0')).toBe(0);
  });
});

describe('groupReleasesByMajor', () => {
  it('puts releases under their major versions, in the order given', () => {
    const releases = parseChangelog('## 2.1.0\n\n## 2.0.0\n\n## 1.4.0\n\n## 10.0.0\n\n## 1.0.0\n');
    expect(
      groupReleasesByMajor(releases).map(group => [group.major, group.releases.map(release => release.version)])
    ).toEqual([
      [2, ['2.1.0', '2.0.0']],
      [1, ['1.4.0', '1.0.0']],
      [10, ['10.0.0']],
    ]);
    expect(groupReleasesByMajor([])).toEqual([]);
  });
});

describe('hasUserFacingChanges', () => {
  it('is false only for a release that says it has none, or says nothing', () => {
    const [changed, intro, none, empty] = parseChangelog(
      '## 1.3.0\n\n### Fixed\n\n- A fix.\n\n## 1.2.0\n\nThe first release.\n\n## 1.1.0\n\nNo user-facing changes.\n\n## 1.0.0\n'
    );
    expect(hasUserFacingChanges(changed)).toBe(true);
    expect(hasUserFacingChanges(intro)).toBe(true);
    expect(hasUserFacingChanges(none)).toBe(false);
    expect(hasUserFacingChanges(empty)).toBe(false);
  });
});

describe('releasesBetween', () => {
  const text = '# Changelog\n\n## 2.1.0\n\n## 2.0.0\n\n## 1.10.0\n\n## 1.9.0\n\n## 1.8.2\n';
  const versions = (current: string, latest: string) =>
    releasesBetween(text, current, latest).map(release => release.version);

  it('has every release after the running one, up to the one on offer, newest first', () => {
    expect(versions('1.9.0', '2.0.0')).toEqual(['2.0.0', '1.10.0']);
    expect(versions('1.8.2', '2.1.0')).toEqual(['2.1.0', '2.0.0', '1.10.0', '1.9.0']);
    expect(versions('2.0.0', '2.1.0')).toEqual(['2.1.0']);
  });

  it('has none when there is nothing between them', () => {
    expect(versions('2.1.0', '2.1.0')).toEqual([]);
    expect(releasesBetween('', '1.0.0', '2.0.0')).toEqual([]);
  });
});

describe('releasesSince', () => {
  it('keeps the order it was given', () => {
    const releases = parseChangelog('## 2.1.0\n\n## 2.0.0\n\n## 1.9.0\n');
    expect(releasesSince(releases, '1.9.0', '2.1.0').map(release => release.version)).toEqual(['2.1.0', '2.0.0']);
    expect(releasesSince(releases, '2.1.0', '2.1.0')).toEqual([]);
  });
});

describe('summarizeRelease', () => {
  const [counted, loose, one, intro, none, bare] = parseChangelog(
    [
      '## 1.5.0\n\n### Added\n\n- One.\n- Two.\n\n### Removed\n\n### Fixed\n\n- A fix.',
      '## 1.4.0\n\n- A bullet.\n- Another.',
      '## 1.3.0\n\n- A bullet.',
      '## 1.2.0\n\nThe first release.',
      '## 1.1.0\n\nNo user-facing changes.',
      '## 1.0.0',
    ].join('\n\n')
  );

  it('counts the bullets under each heading, leaving out a heading with none', () => {
    expect(summarizeRelease(counted)).toBe('2 added · 1 fixed');
  });

  it('counts bullets with no heading as changes', () => {
    expect(summarizeRelease(loose)).toBe('2 changes');
    expect(summarizeRelease(one)).toBe('1 change');
  });

  it('says so when nothing changed for a user, and nothing for an intro alone', () => {
    expect(summarizeRelease(intro)).toBe('');
    expect(summarizeRelease(none)).toBe('No user-facing changes');
    expect(summarizeRelease(bare)).toBe('No user-facing changes');
  });
});

describe('combineReleases', () => {
  it("puts every release's bullets under their headings, in the changelog's order, newest first", () => {
    const releases = parseChangelog(
      [
        '## 2.2.0\n\nA big one.\n\n### Fixed\n\n- Fix B.\n\n### Added\n\n- New B.',
        '## 2.1.0\n\n- A loose bullet.\n\n### Notes\n\n- Something else.',
        '## 2.0.0\n\nA big one.\n\n### Added\n\n- New A.\n- New B.\n\n### Security\n\n- Safer.',
      ].join('\n\n')
    );
    expect(combineReleases(releases)).toEqual({
      version: '2.2.0',
      date: null,
      intro: ['A big one.'],
      groups: [
        { type: 'Added', items: ['New B.', 'New A.'] },
        { type: 'Fixed', items: ['Fix B.'] },
        { type: 'Security', items: ['Safer.'] },
        { type: '', items: ['A loose bullet.'] },
        { type: 'Notes', items: ['Something else.'] },
      ],
    });
  });
});

describe('isVersion', () => {
  it('is true only for a version like 2.1.0', () => {
    expect(isVersion('2.1.0')).toBe(true);
    expect(isVersion('v2.1.0')).toBe(false);
    expect(isVersion('2.1')).toBe(false);
    expect(isVersion(null)).toBe(false);
  });
});

describe('ReleaseNotes links', () => {
  it('shows a Markdown link as its label, and leaves code that looks like one alone', () => {
    const release = parseReleaseSection(
      '2.3.0',
      'See [the guide](https://example.com/guide) first.\n\n- Read [the **README**](README.md), or `list[0](x)`.'
    );
    render(<ReleaseNotes release={release} />);

    expect(screen.getByText('See the guide first.')).toBeInTheDocument();
    expect(screen.getByRole('listitem').textContent).toBe('Read the README, or list[0](x).');
    expect(screen.getByText('list[0](x)').tagName).toBe('CODE');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
