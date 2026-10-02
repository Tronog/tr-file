import type { UiBreadcrumb, UiPathSuggestion } from './file.model';
import type { UiIconAction } from './icon.model';
import type { UiEmptyStateModel } from './panel.model';

/** How a `UiDiskUsage` draws a folder (PRD 013, §2.1). */
export type UiDiskUsageView = 'pie' | 'table' | 'rectangles';

/**
 * One entry of a disk usage tree: a folder, a file, or what is left summed
 * (`rest`). `size` sets the proportions; the labels are the app's, already
 * formatted.
 */
export interface UiDiskUsageItem {
  /** Unique within the tree — a path, for an entry that has one. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'folder' | 'file' | 'rest';
  readonly size: number;
  /** `12.4 MB`. */
  readonly sizeLabel: string;
  /** What else there is to say — `1,204 files · 31 folders` — in the table and the tooltips. */
  readonly detail?: string;
  /** For a folder still being read, or not gone into: `scanning…`, `unreadable`, `another disk`. */
  readonly note?: string;
  /** A folder that can be gone into: activating it is a request to show it. */
  readonly openable?: boolean;
  /** A folder's entries, largest first, to the depth shown. */
  readonly children?: readonly UiDiskUsageItem[];
}

/** What a `UiDiskUsage` shows: the path bar and toolbar of a file browser, and one folder drawn. */
export interface UiDiskUsageModel {
  readonly breadcrumbs: readonly UiBreadcrumb[];
  /** The folder as a path someone can type; see `UiFileBrowserModel.location`. */
  readonly location?: string;
  readonly locationSuggestions?: readonly UiPathSuggestion[];
  /** Bump to turn the path bar into a text field, as `Ctrl`+`L` does. */
  readonly locationEdit?: number;
  /** Leading icon buttons of the toolbar: up, rescan, stop. */
  readonly toolbarActions: readonly UiIconAction[];
  readonly view: UiDiskUsageView;
  /** Levels drawn below the folder, `1` to `maxDepth`. */
  readonly depth: number;
  readonly maxDepth: number;
  /** Right of the toolbar: `Scanning… 12,034 files · 4.1 GB`. */
  readonly summary?: string;
  /** The folder drawn, with its entries to `depth` levels; `null` while there is nothing yet. */
  readonly root: UiDiskUsageItem | null;
  /** Shown instead of a drawing: nothing scanned yet, a scan that failed. */
  readonly empty?: UiEmptyStateModel;
}
