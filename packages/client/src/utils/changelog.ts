// Adapted from TaskMint packages/client/src/utils/changelog.ts @ 1623bee.
/**
 * Release notes, as `pnpm release` writes CHANGELOG.md: a `## X.Y.Z – date`
 * section per release, newest first, with `### Added`-style headings over
 * `- ` bullets. A paragraph before the first heading is the release's intro.
 * A desktop update's notes are one such section. CHANGELOG.md itself (at
 * the repository root, bundled as text) is Settings → About's history.
 */

import changelogText from '../../../../CHANGELOG.md?raw';
import { compareVersions } from './appVersion';

export interface ReleaseNotesGroup {
  /** The heading: Added, Changed, Removed, Fixed or Security ('' for bullets with none). */
  type: string;
  items: string[];
}

export interface ReleaseNotes {
  version: string;
  /** YYYY-MM-DD, or null when the heading has none. */
  date: string | null;
  /** Text before the first heading. */
  intro: string[];
  groups: ReleaseNotesGroup[];
}

const RELEASE_HEADING = /^## (\d+\.\d+\.\d+)(?:\s+[–-]\s+(\S+))?\s*$/;
const GROUP_HEADING = /^### (.+)$/;
export function parseChangelog(text: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | null = null;
  // What a continuation line joins: the last bullet or intro paragraph
  let last: { list: string[] } | null = null;

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = line.match(RELEASE_HEADING);
    if (heading) {
      release = { version: heading[1], date: heading[2] ?? null, intro: [], groups: [] };
      releases.push(release);
      last = null;
      continue;
    }
    // (Before the first release: the file's own header)
    if (!release) continue;
    if (line === '') {
      last = null;
      continue;
    }
    const group = line.match(GROUP_HEADING);
    if (group) {
      release.groups.push({ type: group[1].trim(), items: [] });
      last = null;
    } else if (line.startsWith('- ')) {
      // (Bullets before any heading go in a group of their own, without one)
      if (release.groups.length === 0) release.groups.push({ type: '', items: [] });
      const items = release.groups[release.groups.length - 1].items;
      items.push(line.slice(2).trim());
      last = { list: items };
    } else if (last) {
      last.list[last.list.length - 1] += ` ${line}`;
    } else {
      release.intro.push(line);
      last = { list: release.intro };
    }
  }
  return releases;
}

/** One release's notes from its section's text (without the `## X.Y.Z` heading). */
export function parseReleaseSection(version: string, text: string): ReleaseNotes {
  // (A placeholder heading: the version need not look like X.Y.Z)
  const [release] = parseChangelog(`## 0.0.0\n${text}`);
  return { ...release, version };
}

/** The app's release notes, newest first. */
export const RELEASES: ReleaseNotes[] = parseChangelog(changelogText);

export interface MajorReleases {
  /** The major version: 4 for 4.2.1. */
  major: number;
  releases: ReleaseNotes[];
}

/** Releases under their major versions, each in the order given. */
export function groupReleasesByMajor(releases: ReleaseNotes[]): MajorReleases[] {
  const groups: MajorReleases[] = [];
  for (const release of releases) {
    const major = Number(release.version.split('.')[0]);
    const group = groups.find(candidate => candidate.major === major);
    if (group) group.releases.push(release);
    else groups.push({ major, releases: [release] });
  }
  return groups;
}

/** Whether a release has anything to read: "No user-facing changes." is its whole intro otherwise. */
export function hasUserFacingChanges(release: ReleaseNotes): boolean {
  return release.groups.length > 0 || release.intro.some(line => line !== 'No user-facing changes.');
}

/** The releases after `from` up to `to`, in the order given: what an update from one to the other brings. */
export function releasesSince(releases: ReleaseNotes[], from: string, to: string): ReleaseNotes[] {
  return releases.filter(
    release => compareVersions(release.version, from) > 0 && compareVersions(release.version, to) <= 0
  );
}

/** releasesSince, from a changelog's text (an update feed's), newest first. */
export function releasesBetween(text: string, current: string, latest: string): ReleaseNotes[] {
  return releasesSince(parseChangelog(text), current, latest);
}

/** "2 added · 1 fixed": how much a release changed, for a row that doesn't show its notes. */
export function summarizeRelease(release: ReleaseNotes): string {
  const counts = release.groups
    .filter(group => group.items.length > 0)
    .map(
      ({ type, items }) => `${items.length} ${type ? type.toLowerCase() : items.length === 1 ? 'change' : 'changes'}`
    );
  if (counts.length > 0) return counts.join(' · ');
  return hasUserFacingChanges(release) ? '' : 'No user-facing changes';
}

/** The changelog's headings, in its order. */
const TYPE_ORDER = ['Added', 'Changed', 'Removed', 'Fixed', 'Security'];

/**
 * Several releases' notes as one: every bullet under its heading (Added,
 * Changed…), the newest release's first. For an update many releases ahead,
 * where what changed matters more than which release changed it.
 */
export function combineReleases(releases: ReleaseNotes[]): ReleaseNotes {
  const groups = new Map<string, Set<string>>();
  for (const release of releases) {
    for (const { type, items } of release.groups) {
      const all = groups.get(type) ?? new Set<string>();
      for (const item of items) all.add(item);
      groups.set(type, all);
    }
  }
  // (A heading the changelog doesn't use, or bullets with none, go last)
  const rank = (type: string) => (TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);
  return {
    version: releases[0].version,
    date: null,
    intro: [...new Set(releases.flatMap(release => release.intro))],
    groups: [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([type, items]) => ({ type, items: [...items] })),
  };
}
