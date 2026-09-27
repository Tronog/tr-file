import type { FsEntry } from '../../file-system/file-system.model';
import { isFolder } from '../../file-system/fs-entry-kind';
import type { PanelSort } from '../panel-group.model';

/**
 * The order and the filter of a panel's listing (PRD 003, §5), as plain
 * functions: what a column header or the filter box ask for is decided here,
 * and `FileBrowserFeature` only says which panel wants what.
 */

/** One collator for every comparison: `file2` before `file10`, case ignored — the backend's own order. */
const NATURAL = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * `entries` in `sort`'s order. Folders — links to folders included — always
 * come first, whichever way the rest is turned, as in every file manager; a
 * tie is broken by name, A to Z, so equal sizes still read in order. `type`
 * sorts by the label the Type column shows, so the order is the one on screen.
 */
export function sortEntries(
  entries: readonly FsEntry[],
  sort: PanelSort,
  typeLabel: (entry: FsEntry) => string,
): readonly FsEntry[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const byKey = (a: FsEntry, b: FsEntry): number => {
    switch (sort.key) {
      case 'size':
        // Folders have no size of their own: among them, name decides.
        return isFolder(a) && isFolder(b) ? 0 : a.size - b.size;
      case 'modified':
        return Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt);
      case 'type':
        return NATURAL.compare(typeLabel(a), typeLabel(b));
      case 'name':
        return NATURAL.compare(a.name, b.name);
    }
  };
  return [...entries].sort((a, b) => {
    const folders = Number(isFolder(b)) - Number(isFolder(a));
    if (folders !== 0) {
      return folders;
    }
    const order = byKey(a, b) * sign;
    return order !== 0 ? order : NATURAL.compare(a.name, b.name);
  });
}

/**
 * A test for names against what was typed in a filter box: a glob when it has
 * `*` or `?` in it (`*.md`), else a substring anywhere in the name; either way
 * without regard to case. An empty filter lets everything through.
 */
export function nameFilter(text: string): (name: string) => boolean {
  const query = text.trim().toLowerCase();
  if (query === '') {
    return () => true;
  }
  if (!/[*?]/.test(query)) {
    return (name) => name.toLowerCase().includes(query);
  }
  const pattern = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const glob = new RegExp(`^${pattern}$`, 'i');
  return (name) => glob.test(name);
}
