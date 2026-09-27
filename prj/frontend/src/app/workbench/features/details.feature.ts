import { computed, linkedSignal } from '@angular/core';
import type { UiActionListItem, UiPermissions, UiPreview, UiProperty } from '@tr-file/ui';
import type { FsDetails } from '../../file-system/file-system.model';
import { MAX_IMAGE_BYTES } from '../../file-system/image-source.service';
import type { WorkbenchService } from '../workbench.service';
import { isFile, isFolder } from '../../file-system/fs-entry-kind';

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

  /**
   * What the sidebar shows. While a newly selected entry's details are on
   * their way, the previous entry's stay up — marked `stale` — so moving the
   * selection down a list goes from one entry straight to the next instead of
   * collapsing the whole sidebar to "Loading details…" at every step.
   */
  private readonly details = linkedSignal<ReturnType<typeof this.state>, FsDetails | undefined>({
    source: () => this.state(),
    computation: (state, previous) =>
      state?.details ?? (state?.status === 'loading' ? previous?.value : undefined),
  });

  /** The selected entry's own details — never the stale ones — for acting on. */
  private readonly current = computed<FsDetails | undefined>(() => this.state()?.details);

  readonly loading = computed(() => this.state()?.status === 'loading');

  /** Showing the previous entry's details while the selected one's load. */
  readonly stale = computed(() => this.current() === undefined && this.details() !== undefined);

  readonly error = computed(() => this.state()?.error?.message);

  /** `false` when nothing is selected, or nothing is known about it yet. */
  readonly hasDetails = computed(() => this.details() !== undefined);

  readonly preview = computed<UiPreview | undefined>(() => {
    const details = this.details();
    if (!details) {
      return undefined;
    }
    const files = this.parent.fileViewModel;
    const size = isFolder(details) ? this.entriesLabel(details) : files.formatBytes(details.size);
    // Read, never fetched: the picture is asked for by `load` below, because a
    // `computed` that started a request would write signals during change
    // detection. Until it arrives the card shows the file-type icon.
    const imageSrc = this.parent.images.urlFor(details.path);
    return {
      title: details.name || this.parent.workspaceName(),
      subtitle: `${files.typeLabel(details)} · ${size}`,
      icon: files.icon(details),
      tint: files.tint(details),
      ...(imageSrc ? { imageSrc } : {}),
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

    if (isFolder(details)) {
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
    if (isFile(details)) {
      actions.push({ id: 'download', label: 'Download', icon: 'download', tag: 'file' });
    }
    if (isFolder(details)) {
      actions.push({ id: 'open', label: 'Open in this panel', icon: 'folder-open' });
      actions.push({ id: 'upload', label: 'Upload files here', icon: 'upload' });
    }
    // PRD 003, §5: out of the app, and a new name — the root has neither.
    if (details.path !== '') {
      if (isFile(details)) {
        actions.push({ id: 'open-external', label: this.parent.systemOpenFt.openLabel(), icon: 'external' });
      }
      if (this.parent.systemOpenFt.canReveal()) {
        actions.push({ id: 'reveal', label: this.parent.systemOpenFt.revealLabel(), icon: 'folder' });
      }
      actions.push({ id: 'rename', label: 'Rename…', icon: 'pencil' });
    }
    actions.push({ id: 'copy-path', label: 'Copy path', icon: 'copy' });
    actions.push({ id: 'refresh', label: 'Refresh details', icon: 'refresh' });
    return actions;
  });

  /**
   * Fetches what the sidebar shows about a path; called on every selection.
   *
   * An image is also read as a picture, so the card can show the file itself
   * rather than its type icon (PRD 001, §9). The cache is shared with the
   * panel's viewer, so selecting a file that is already open costs nothing.
   */
  load(path: string): void {
    this.parent.fsDataFt.ensureDetails(path);
    if (this.wantsPicture(path)) {
      void this.parent.images.load(path);
    }
  }

  /**
   * Whether the sidebar should read the file itself.
   *
   * A thumbnail is 96 pixels square, so pulling a huge image across for one is
   * not worth it — and the size is known from the listing the selection came
   * from, before a single byte is asked for. An entry no listing describes is
   * still attempted: the transport caps what it can, and the service checks
   * what arrives.
   */
  private wantsPicture(path: string): boolean {
    if (!this.parent.images.isImage(path)) {
      return false;
    }
    const entry = this.parent.fsDataFt.entryAt(path);
    return entry === undefined || entry.size <= MAX_IMAGE_BYTES;
  }

  runAction(actionId: string): void {
    // Never the stale details: an action is about what is selected now.
    const details = this.current();
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
      case 'open-external':
        void this.parent.systemOpenFt.open(details.path);
        break;
      case 'reveal':
        void this.parent.systemOpenFt.reveal(details.path);
        break;
      case 'rename':
        void this.parent.fileEditFt.rename(details.path, this.parent.activeGroupId());
        break;
      case 'copy-path':
        void navigator.clipboard?.writeText(details.path);
        break;
      case 'refresh':
        this.parent.fsDataFt.reloadDetails(details.path);
        if (this.wantsPicture(details.path)) {
          void this.parent.images.reload(details.path);
        }
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
