import { computed } from '@angular/core';
import type { UiActionListItem, UiChip, UiPermissions, UiPreview, UiProperty } from '@tr-file/ui';
import type { MockFileDetails } from '../mock-data/mock-data.model';
import type { WorkbenchService } from '../workbench.service';

/** How a POSIX octal digit maps onto read/write/execute. */
function triplet(digit: string) {
  const value = Number.parseInt(digit, 8);
  return {
    read: (value & 0b100) !== 0,
    write: (value & 0b010) !== 0,
    execute: (value & 0b001) !== 0,
  };
}

/** Rows offered by the "Open with" list. Static until real handlers exist. */
const OPEN_WITH: readonly UiActionListItem[] = [
  { id: 'preview', label: 'Preview', icon: 'eye', tag: 'default' },
  { id: 'editor', label: 'Text editor', icon: 'pencil' },
  { id: 'terminal', label: 'Open in terminal', icon: 'terminal' },
  { id: 'reveal', label: 'Reveal in system files', icon: 'external' },
];

/**
 * The right sidebar: everything known about the entry selected anywhere in the
 * workbench.
 *
 * Reads the workbench-wide selection, so clicking a row in the tree or in any
 * panel updates the same panel — which is why the selection lives on the
 * service and not in either feature.
 */
export class DetailsFeature {
  constructor(private readonly parent: WorkbenchService) {}

  private readonly entry = computed(() => this.parent.mockFileSystem.find(this.parent.selectedEntryId()));

  private readonly details = computed<MockFileDetails | undefined>(
    () => this.parent.mockFileSystem.details[this.parent.selectedEntryId()],
  );

  /** `false` when nothing is selected, or nothing is known about the selection. */
  readonly hasDetails = computed(() => this.details() !== undefined);

  readonly preview = computed<UiPreview | undefined>(() => {
    const entry = this.entry();
    if (!entry) {
      return undefined;
    }
    const files = this.parent.fileViewModel;
    const kind = files.typeLabel(entry);
    const size = entry.size === null ? 'Folder' : files.formatBytes(entry.size);
    return {
      title: entry.name,
      subtitle: entry.kind === 'directory' ? 'Folder' : `${kind} · ${size}`,
      icon: files.icon(entry),
      tint: files.tint(entry),
    };
  });

  readonly properties = computed<readonly UiProperty[]>(() => {
    const details = this.details();
    if (!details) {
      return [];
    }
    const files = this.parent.fileViewModel;
    return [
      { label: 'Location', value: details.location },
      { label: 'Size', value: `${details.sizeBytes.toLocaleString('en-US')} bytes (${files.formatBytes(details.sizeBytes)})` },
      { label: 'On disk', value: files.formatBytes(details.sizeOnDiskBytes) },
      { label: 'Created', value: files.fullTimestamp(details.created) },
      { label: 'Modified', value: files.fullTimestamp(details.modified) },
      { label: 'Accessed', value: files.fullTimestamp(details.accessed) },
      { label: 'Owner', value: `${details.owner} : ${details.group}` },
      { label: 'Inode', value: `${details.inode}` },
      { label: 'Checksum', value: details.checksum, mono: true },
    ];
  });

  readonly permissions = computed<UiPermissions | undefined>(() => {
    const details = this.details();
    if (!details) {
      return undefined;
    }
    // Accept both `'0644'` and `'644'`: take the last three digits.
    const [owner = '0', group = '0', others = '0'] = details.mode.slice(-3).split('');
    return {
      owner: triplet(owner),
      group: triplet(group),
      others: triplet(others),
      mode: details.mode,
    };
  });

  readonly tags = computed<readonly UiChip[]>(() => this.details()?.tags ?? []);

  readonly git = computed<readonly UiProperty[]>(() => {
    const info = this.details()?.git;
    if (!info) {
      return [];
    }
    return [
      { label: 'Status', value: info.status, ...(info.decoration === 'modified' ? { tone: 'modified' as const } : {}) },
      { label: 'Branch', value: info.branch },
      { label: 'Last commit', value: info.lastCommit },
    ];
  });

  readonly openWith: readonly UiActionListItem[] = OPEN_WITH;
}
