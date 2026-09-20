import type { UiGitDecoration, UiGridNode, UiIconAction, UiPanelView } from '@tr-file/ui';

/**
 * Shapes of the mocked domain data.
 *
 * These deliberately look like something a file-manager backend would return —
 * raw bytes and ISO timestamps, not display strings — so that replacing the
 * `MockData*` services with real HTTP calls is a swap of the data source and
 * nothing else. The mapping to view models lives in the feature classes.
 */

/** A node of the mocked file system. */
export interface MockFileNode {
  /** Slash-separated path, unique across the tree; also the tree row id. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  /** Bytes. Directories report `null`. */
  readonly size: number | null;
  /** ISO 8601, UTC. */
  readonly modified: string;
  readonly children?: readonly MockFileNode[];
  /** Number of entries, shown as a tree hint for collapsed directories. */
  readonly itemCount?: number;
  readonly decoration?: UiGitDecoration;
  /** Entry sits on the clipboard after a Cut. */
  readonly cut?: boolean;
}

/** Metadata the details sidebar shows for one entry. */
export interface MockFileDetails {
  readonly id: string;
  readonly location: string;
  readonly sizeBytes: number;
  readonly sizeOnDiskBytes: number;
  readonly created: string;
  readonly modified: string;
  readonly accessed: string;
  readonly owner: string;
  readonly group: string;
  readonly inode: number;
  readonly checksum: string;
  /** POSIX mode as three octal digits plus a leading zero, e.g. `'0644'`. */
  readonly mode: string;
  readonly tags: readonly MockTag[];
  readonly git: MockGitInfo;
}

export interface MockTag {
  readonly id: string;
  readonly label: string;
  readonly color: string;
}

export interface MockGitInfo {
  readonly status: string;
  readonly branch: string;
  readonly lastCommit: string;
  readonly decoration?: UiGitDecoration;
}

/** One open panel group: a set of tabs over a directory. */
export interface MockPanelGroup {
  readonly id: string;
  readonly tabs: readonly MockPanelTab[];
  /** Path whose contents the group lists. */
  readonly path: string;
  readonly view: UiPanelView;
  /** Ids of the listed entries that are selected. */
  readonly selection: readonly string[];
  /** Id of the entry that owns keyboard focus inside the group. */
  readonly focusedEntryId?: string;
  /** Which detail columns the list view shows besides the name. */
  readonly columns: readonly ('size' | 'type' | 'modified')[];
  readonly toolbar: MockPanelToolbar;
}

/** Which controls a group's toolbar offers. */
export interface MockPanelToolbar {
  readonly actions: readonly UiIconAction[];
  readonly viewSwitch: boolean;
  /** Shows the filter box when set. */
  readonly search: boolean;
}

export interface MockPanelTab {
  readonly id: string;
  readonly label: string;
  /** Path the tab shows; `null` for non-directory tabs such as search results. */
  readonly path: string | null;
  readonly active?: boolean;
  readonly preview?: boolean;
  readonly dirty?: boolean;
  /** Overrides the icon derived from the path (search results, previews). */
  readonly icon?: 'search' | 'file' | 'folder';
}

/** The workbench layout as it is restored at start-up. */
export interface MockWorkbenchLayout {
  readonly grid: UiGridNode;
  readonly groups: readonly MockPanelGroup[];
  readonly expandedPaths: readonly string[];
  readonly selectedEntryId: string;
  readonly activeGroupId: string;
  readonly leftSidebarWidth: number;
  readonly rightSidebarWidth: number;
  readonly bottomPanelHeight: number;
}

/** A queued, running or finished file transfer. */
export interface MockTransfer {
  readonly id: string;
  readonly name: string;
  readonly direction: 'upload' | 'download' | 'copy';
  /** 0–100, or `null` while the transfer is still queued. */
  readonly progress: number | null;
  readonly statusLabel: string;
}
