import type { UiIconName, UiIconTint } from '@tr-file/ui';
import type { MockFileNode } from '../mock-data/mock-data.model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Extension → icon tint. Anything unlisted falls back to `generic`. */
const TINT_BY_EXTENSION: Readonly<Record<string, UiIconTint>> = {
  ts: 'ts',
  mts: 'ts',
  js: 'ts',
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
};

/**
 * Turns raw file-system nodes into the presentation values the UI library
 * expects: icon, tint, and the human-readable size/date/type labels.
 *
 * Shared by every feature that renders entries, so the explorer tree and the
 * panel lists can never drift apart. Formatting is done from UTC parts rather
 * than the host locale so the same mock data always renders identically.
 */
export class FileViewModelFeature {
  icon(node: MockFileNode, expanded = false): UiIconName {
    if (node.kind === 'directory') {
      return expanded ? 'folder-open' : 'folder';
    }
    return 'file';
  }

  tint(node: MockFileNode): UiIconTint {
    if (node.kind === 'directory') {
      return 'folder';
    }
    return TINT_BY_EXTENSION[this.extension(node.name)] ?? 'generic';
  }

  /** `'1.1 KB'`, `'318 KB'`, `'942 B'`; directories have no size. */
  sizeLabel(node: MockFileNode): string {
    return node.size === null ? '—' : this.formatBytes(node.size);
  }

  typeLabel(node: MockFileNode): string {
    if (node.kind === 'directory') {
      return 'Folder';
    }
    const extension = this.extension(node.name);
    return extension ? extension.toUpperCase() : 'File';
  }

  /** `'Sep 20, 13:04'` — the column is narrow, so the year is dropped. */
  modifiedLabel(node: MockFileNode): string {
    return this.formatTimestamp(node.modified);
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
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  /** Right-aligned hint in the tree: item count for directories, size for files. */
  treeMeta(node: MockFileNode, expanded: boolean): string | undefined {
    if (node.decoration === 'modified') {
      return 'M';
    }
    if (node.decoration === 'untracked') {
      return 'U';
    }
    if (node.kind === 'directory') {
      if (expanded || !node.itemCount) {
        return undefined;
      }
      return `${node.itemCount} ${node.itemCount === 1 ? 'item' : 'items'}`;
    }
    return node.size !== null && node.size >= 1024 ? this.formatBytes(node.size) : undefined;
  }

  private formatTimestamp(iso: string): string {
    const date = new Date(iso);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${this.time(date)}`;
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
