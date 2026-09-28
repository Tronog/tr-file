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
 * What an order compares of one entry, worked out once rather than at every
 * comparison — and all a Web Worker needs to sort a large folder the same way
 * (`listing-order.worker.ts`, PRD 004, §3.1).
 */
export interface SortKeys {
  readonly name: string;
  /** A folder, or a link to one: folders always come first. */
  readonly folder: boolean;
  readonly size: number;
  /** Milliseconds; minus infinity while not known. */
  readonly time: number;
  /** The Type column's label; only read when sorting by it. */
  readonly label: string;
}

/** An entry's keys; `typeLabel` is only asked when the sort is by type. */
export function sortKeysOf(entry: FsEntry, sort: PanelSort, typeLabel: (entry: FsEntry) => string): SortKeys {
  return {
    name: entry.name,
    folder: isFolder(entry),
    size: entry.size,
    time: sort.key === 'modified' ? timeOf(entry) : 0,
    label: sort.key === 'type' ? typeLabel(entry) : '',
  };
}

/**
 * The comparison `sort` asks for. Folders — links to folders included —
 * always come first, whichever way the rest is turned, as in every file
 * manager; a tie is broken by name, A to Z, so equal sizes still read in
 * order. `type` sorts by the label the Type column shows, so the order is the
 * one on screen.
 */
export function compareKeys(sort: PanelSort): (a: SortKeys, b: SortKeys) => number {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const byKey = (a: SortKeys, b: SortKeys): number => {
    switch (sort.key) {
      case 'size':
        // Folders have no size of their own: among them, name decides.
        return a.folder && b.folder ? 0 : a.size - b.size;
      case 'modified':
        // Not known yet (PRD 004, §3.1): before every date, as if at the start of time.
        return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      case 'type':
        return NATURAL.compare(a.label, b.label);
      case 'name':
        return NATURAL.compare(a.name, b.name);
    }
  };
  return (a, b) => {
    const folders = Number(b.folder) - Number(a.folder);
    if (folders !== 0) {
      return folders;
    }
    const order = byKey(a, b) * sign;
    return order !== 0 ? order : NATURAL.compare(a.name, b.name);
  };
}

/** `entries` in `sort`'s order; see `compareKeys`. */
export function sortEntries(
  entries: readonly FsEntry[],
  sort: PanelSort,
  typeLabel: (entry: FsEntry) => string,
): readonly FsEntry[] {
  const compare = compareKeys(sort);
  return entries
    .map((entry) => ({ entry, keys: sortKeysOf(entry, sort, typeLabel) }))
    .sort((a, b) => compare(a.keys, b.keys))
    .map(({ entry }) => entry);
}

/** When an entry was changed; minus infinity while a large folder's details are still coming. */
export function timeOf(entry: FsEntry): number {
  return entry.partial || entry.modifiedAt === '' ? Number.NEGATIVE_INFINITY : Date.parse(entry.modifiedAt);
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
