import { serializeDelimited } from '@tr-file/ui';
import type { FsDiskUsageNode } from '../../file-system/file-system.model';

/** The columns of the export, as its first line names them. */
const HEADER = ['Path', 'Name', 'Type', 'Level', 'Size (bytes)', 'Size', 'On disk (bytes)', 'Files', 'Folders', '% of folder', '% of total', 'Note'];

/** What a folder's state says in the export. */
const NOTES: Readonly<Record<string, string>> = {
  scanning: 'not all scanned',
  unreadable: 'unreadable',
  mount: 'another disk, not scanned',
  'too-deep': 'too deep, not scanned',
};

/**
 * Disk Usage's results as CSV (PRD 013, §2.2): what the tab shows — the
 * folder and its entries to the depth drawn, depth first, largest first —
 * one line each, with the numbers whole so a spreadsheet can add them up.
 *
 * Comma-separated, CRLF, and a UTF-8 byte-order mark: what Excel opens as
 * UTF-8 without asking. `shownPath` turns a root-relative path into the one
 * the user sees; `formatBytes` writes the size as the app does.
 */
export function diskUsageCsv(
  root: FsDiskUsageNode,
  rootName: string,
  shownPath: (path: string) => string,
  formatBytes: (bytes: number) => string,
): string {
  const rows: string[][] = [HEADER];
  const percent = (part: number, whole: number): string => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '');
  const walk = (node: FsDiskUsageNode, name: string, level: number, parent: FsDiskUsageNode | null): void => {
    const rest = node.kind === 'rest';
    rows.push([
      node.path === null ? '' : shownPath(node.path),
      rest ? `(${(node.count ?? 0).toLocaleString('en-US')} smaller entries)` : name,
      rest ? 'other' : node.kind,
      String(level),
      String(node.size),
      formatBytes(node.size),
      String(node.onDisk),
      node.kind === 'folder' ? String(node.files) : rest ? '' : '1',
      node.kind === 'folder' ? String(node.folders) : '',
      parent === null ? '100.0' : percent(node.size, parent.size),
      percent(node.size, root.size),
      (node.state === undefined ? undefined : NOTES[node.state]) ?? '',
    ]);
    for (const child of node.children ?? []) {
      walk(child, child.name, level + 1, node);
    }
  };
  walk(root, rootName, 0, null);
  return `﻿${serializeDelimited({ rows, delimiter: ',', trailingNewline: true }, '\r\n')}`;
}

/** `disk-usage-Documents-2026-10-07.csv`: the folder, and the day. */
export function diskUsageFileName(folderName: string, now: Date): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safe = folderName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'root';
  return `disk-usage-${safe}-${day}.csv`;
}
