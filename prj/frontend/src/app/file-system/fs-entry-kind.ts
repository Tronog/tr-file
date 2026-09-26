import type { FsEntry } from './file-system.model';

/**
 * What an entry *behaves as*, which for a symlink is what it leads to
 * (PRD 003, §1). The backend reports links as `symlink`, with `targetType`
 * saying where they go; everything that decides whether to navigate into an
 * entry or open it as a file asks these, never `type` alone — or a link to a
 * folder opens as a file preview of a directory.
 */

/** A folder, or a link to one inside the root: something to list and open. */
export function isFolder(entry: Pick<FsEntry, 'type' | 'targetType'>): boolean {
  return entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory');
}

/** A regular file, or a link to one inside the root: something to read. */
export function isFile(entry: Pick<FsEntry, 'type' | 'targetType'>): boolean {
  return entry.type === 'file' || (entry.type === 'symlink' && entry.targetType === 'file');
}
