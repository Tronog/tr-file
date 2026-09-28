import type { FsEntry } from '../../file-system/file-system.model';
import { isFolder } from '../../file-system/fs-entry-kind';

/** One collator for every comparison, as the listings sort: `file2` before `file10`, case ignored. */
const NATURAL = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The most places the path bar suggests at once. */
export const SUGGESTIONS_SHOWN = 12;

/**
 * What is typed in the path bar, as a folder to look in and the start of a
 * name in it (PRD 004, §4.2): `/docs/pr` is `pr` in `docs`, `/docs/` all of
 * `docs`, `C:` a drive among the drives. `\` counts as `/`. `null` for
 * anything with `..` in it, which the path bar will not go to either.
 */
export function locationQuery(text: string): { readonly folder: string; readonly fragment: string } | null {
  const segments = text.trim().replace(/\\/g, '/').split('/');
  const fragment = segments.pop() ?? '';
  const folder = segments.filter((segment) => segment !== '' && segment !== '.');
  if (folder.includes('..') || fragment === '..') {
    return null;
  }
  return { folder: folder.join('/'), fragment: fragment === '.' ? '' : fragment };
}

/**
 * The entries of a folder that fit what was typed of a name, case ignored,
 * best first: folders before files, then names that start with it before
 * names that only hold it — or, with `*` or `?` in it, names the pattern
 * matches whole — each in natural order. Nothing typed: the first of them all.
 */
export function suggestPlaces(entries: readonly FsEntry[], fragment: string, limit = SUGGESTIONS_SHOWN): readonly FsEntry[] {
  const query = fragment.toLowerCase();
  const glob = /[*?]/.test(query)
    ? new RegExp(`^${query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
    : null;
  const rank = (name: string): number | null => {
    if (glob !== null) {
      return glob.test(name) ? 0 : null;
    }
    const lower = name.toLowerCase();
    return lower.startsWith(query) ? 0 : lower.includes(query) ? 1 : null;
  };
  const found: { entry: FsEntry; folder: boolean; rank: number }[] = [];
  for (const entry of entries) {
    const at = rank(entry.name);
    if (at !== null) {
      found.push({ entry, folder: isFolder(entry), rank: at });
    }
  }
  return found
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.rank - b.rank || NATURAL.compare(a.entry.name, b.entry.name))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
