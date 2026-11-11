// Adapted from TaskMint packages/client/src/utils/changelog.ts @ 1623bee.
/**
 * Release notes, as `pnpm release` writes CHANGELOG.md: a `## X.Y.Z – date`
 * section per release, newest first, with `### Added`-style headings over
 * `- ` bullets. A paragraph before the first heading is the release's intro.
 * A desktop update's notes are one such section.
 */
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
