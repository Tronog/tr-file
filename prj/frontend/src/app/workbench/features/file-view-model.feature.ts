import type { UiIconName, UiIconTint } from '@tr-file/ui';
import type { FsEntry, FsEntryType } from '../../file-system/file-system.model';
import { isFolder } from '../../file-system/fs-entry-kind';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Extension → icon tint. Anything unlisted falls back to `generic`. */
const TINT_BY_EXTENSION: Readonly<Record<string, UiIconTint>> = {
  ts: 'ts',
  mts: 'ts',
  js: 'ts',
  mjs: 'ts',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'md',
  css: 'css',
  scss: 'css',
  html: 'html',
  svg: 'img',
  png: 'img',
  jpg: 'img',
  jpeg: 'img',
  webp: 'img',
  gif: 'img',
};

/**
 * Turns backend entries into the presentation values the UI library expects:
 * icon, tint, and the human-readable size and date labels.
 *
 * Shared by every feature that renders entries, so the explorer tree, the panel
 * lists and the details sidebar can never drift apart. Dates are formatted from
 * UTC parts rather than the host locale, so the same response always renders
 * identically.
 */
export class FileViewModelFeature {
  icon(entry: Pick<FsEntry, 'type' | 'targetType'>, expanded = false): UiIconName {
    if (isFolder(entry)) {
      return expanded ? 'folder-open' : 'folder';
    }
    return 'file';
  }

  tint(entry: Pick<FsEntry, 'type' | 'name' | 'targetType'>): UiIconTint {
    if (isFolder(entry)) {
      return 'folder';
    }
    return TINT_BY_EXTENSION[this.extension(entry.name)] ?? 'generic';
  }

  /**
   * `'1.1 KB'`, `'318 KB'`, `'942 B'`; directories report no size, and an
   * entry of a large folder whose details are still coming (PRD 004, §3.1)
   * none yet.
   */
  sizeLabel(entry: Pick<FsEntry, 'type' | 'size' | 'targetType' | 'partial'>): string {
    if (entry.partial) {
      return '';
    }
    return isFolder(entry) ? '—' : this.formatBytes(entry.size);
  }

  typeLabel(entry: Pick<FsEntry, 'type' | 'name' | 'targetType'>): string {
    switch (entry.type) {
      case 'directory':
        return 'Folder';
      case 'symlink':
        return entry.targetType === 'directory' ? 'Folder link' : 'Link';
      case 'other':
        return 'Special';
      default: {
        const extension = this.extension(entry.name);
        return extension ? extension.toUpperCase() : 'File';
      }
    }
  }

  /** `'Sep 20, 13:04'` — the column is narrow, so the year is dropped. */
  modifiedLabel(entry: Pick<FsEntry, 'modifiedAt'>): string {
    if (entry.modifiedAt === '') {
      // Not known yet: an entry of a large folder (PRD 004, §3.1).
      return '';
    }
    const date = new Date(entry.modifiedAt);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${this.time(date)}`;
  }

  /** `'Sep 20, 2026 13:11'` — the details sidebar has room for the year. */
  fullTimestamp(iso: string): string {
    const date = new Date(iso);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${this.time(date)}`;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    }
    const gb = mb / 1024;
    return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  }

  /**
   * Right-aligned hint in the tree. Directories stay bare — a listing does not
   * carry its children's counts, and fetching every subdirectory to print one
   * would turn opening a folder into a fan-out of requests.
   */
  treeMeta(entry: Pick<FsEntry, 'type' | 'size' | 'targetType'>): string | undefined {
    if (isFolder(entry) || entry.size < 1024) {
      return undefined;
    }
    return this.formatBytes(entry.size);
  }

  /** Human label for an entry type, used in the details preview. */
  kindLabel(type: FsEntryType): string {
    return this.typeLabel({ type, name: '' });
  }

  private time(date: Date): string {
    const hours = `${date.getUTCHours()}`.padStart(2, '0');
    const minutes = `${date.getUTCMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private extension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }
}
