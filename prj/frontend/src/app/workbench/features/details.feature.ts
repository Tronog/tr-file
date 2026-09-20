import { computed } from '@angular/core';
import type { UiActionListItem, UiPermissions, UiPreview, UiProperty } from '@tr-file/ui';
import type { FsDetails } from '../../file-system/file-system.model';
import type { WorkbenchService } from '../workbench.service';

/**
 * The right sidebar: everything `/api/fs/details` knows about the entry
 * selected anywhere in the workbench.
 *
 * Reads the workbench-wide selection, so clicking a row in the tree or in any
 * panel fills the same panel — which is why the selection lives on the service
 * and not in either feature.
 */
export class DetailsFeature {
  constructor(private readonly parent: WorkbenchService) {}

  private readonly state = computed(() => this.parent.fsDataFt.detailsState(this.parent.selectedEntryId()));

  private readonly details = computed<FsDetails | undefined>(() => this.state()?.details);

  readonly loading = computed(() => this.state()?.status === 'loading');

  readonly error = computed(() => this.state()?.error?.message);

  /** `false` when nothing is selected, or nothing is known about it yet. */
  readonly hasDetails = computed(() => this.details() !== undefined);

  readonly preview = computed<UiPreview | undefined>(() => {
    const details = this.details();
    if (!details) {
      return undefined;
    }
    const files = this.parent.fileViewModel;
    const size = details.type === 'directory' ? this.entriesLabel(details) : files.formatBytes(details.size);
    return {
      title: details.name || this.parent.mockWorkbench.workspaceName,
      subtitle: `${files.typeLabel(details)} · ${size}`,
      icon: files.icon(details),
      tint: files.tint(details),
    };
  });

  readonly properties = computed<readonly UiProperty[]>(() => {
    const details = this.details();
    if (!details) {
      return [];
    }
    const files = this.parent.fileViewModel;
    const properties: UiProperty[] = [
      { label: 'Location', value: this.locationOf(details), mono: true },
      { label: 'Size', value: `${details.size.toLocaleString('en-US')} bytes (${files.formatBytes(details.size)})` },
      { label: 'On disk', value: files.formatBytes(details.sizeOnDisk) },
      { label: 'Created', value: files.fullTimestamp(details.createdAt) },
      { label: 'Modified', value: files.fullTimestamp(details.modifiedAt) },
      { label: 'Accessed', value: files.fullTimestamp(details.accessedAt) },
      { label: 'Owner', value: `${details.uid} : ${details.gid}` },
      { label: 'Inode', value: `${details.inode}` },
    ];

    if (details.type === 'directory') {
      properties.push({ label: 'Entries', value: this.entriesLabel(details) });
    }
    if (details.mimeType) {
      properties.push({ label: 'Media type', value: details.mimeType, mono: true });
    }
    if (details.symlinkTarget) {
      properties.push({ label: 'Links to', value: details.symlinkTarget, mono: true });
    }

    return properties;
  });

  readonly permissions = computed<UiPermissions | undefined>(() => {
    const details = this.details();
    return details ? { ...details.permissions, mode: details.mode } : undefined;
  });

  /** What can be done with the selected entry, right now. */
  readonly actions = computed<readonly UiActionListItem[]>(() => {
    const details = this.details();
    if (!details) {
      return [];
    }
    const actions: UiActionListItem[] = [];
    if (details.type === 'file') {
      actions.push({ id: 'download', label: 'Download', icon: 'download', tag: 'file' });
    }
    if (details.type === 'directory') {
      actions.push({ id: 'open', label: 'Open in this panel', icon: 'folder-open' });
      actions.push({ id: 'upload', label: 'Upload files here', icon: 'upload' });
    }
    actions.push({ id: 'copy-path', label: 'Copy path', icon: 'copy' });
    actions.push({ id: 'refresh', label: 'Refresh details', icon: 'refresh' });
    return actions;
  });

  /** Fetches the details of whatever is selected; called on every selection. */
  load(path: string): void {
    this.parent.fsDataFt.ensureDetails(path);
  }

  runAction(actionId: string): void {
    const details = this.details();
    if (!details) {
      return;
    }

    switch (actionId) {
      case 'download':
        this.parent.transfersFt.download(details.path, details.name);
        break;
      case 'open':
        this.parent.openInActiveGroup(details.path, details.name);
        break;
      case 'upload':
        this.parent.requestUpload(this.parent.activeGroupId(), details.path);
        break;
      case 'copy-path':
        void navigator.clipboard?.writeText(details.path);
        break;
      case 'refresh':
        this.parent.fsDataFt.reloadDetails(details.path);
        break;
      default:
        break;
    }
  }

  /** `'docs/prd'` → the parent directory, or the workspace root. */
  private locationOf(details: FsDetails): string {
    if (details.parent === null) {
      return '/';
    }
    return details.parent === '' ? '/' : `/${details.parent}`;
  }

  private entriesLabel(details: FsDetails): string {
    const count = details.entryCount;
    if (count === null) {
      return 'unreadable';
    }
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }
}
