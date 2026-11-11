// Adapted from TaskMint packages/client/src/utils/__tests__/changelog.test.ts @ 1623bee.
import { describe, it, expect } from 'vitest';
import { parseChangelog, parseReleaseSection } from '../changelog';
import { render, screen } from '@testing-library/react';
import { ReleaseNotes } from '../../components/ui/display/ReleaseNotes';

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
});
