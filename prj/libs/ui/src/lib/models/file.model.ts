import type { UiIconName, UiIconTint } from './icon.model';

/** How git (or any VCS) decorates an entry in the tree and file list. */
export type UiGitDecoration = 'modified' | 'untracked' | 'ignored' | 'conflict';

/** One row of the flattened directory tree. */
export interface UiTreeNode {
  readonly id: string;
  readonly label: string;
  /** Nesting level, 0 based. Drives indentation only. */
  readonly depth: number;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  /** `false` renders a blank twisty slot so labels stay aligned. */
  readonly expandable: boolean;
  readonly expanded?: boolean;
  /** Contents are being fetched — the twisty becomes a spinner. */
  readonly busy?: boolean;
  readonly selected?: boolean;
  /** The one row that owns keyboard focus; renders the accent outline. */
  readonly focused?: boolean;
  /** Entry is on the clipboard after a Cut — rendered at 50% opacity. */
  readonly cut?: boolean;
  readonly decoration?: UiGitDecoration;
  /** Right-aligned hint: item count, size, or a git letter. */
  readonly meta?: string;
  /**
   * One entry per ancestor level: `true` draws the vertical indent guide for
   * that level. Pre-computed by the caller so the row stays render-only.
   */
  readonly guides: readonly boolean[];
}

/** A column header in the list view. */
export interface UiFileColumn {
  readonly key: string;
  readonly label: string;
  /** Any CSS width, e.g. `'90px'`. Omit for the flexible name column. */
  readonly width?: string;
  readonly align?: 'start' | 'end';
  readonly sort?: 'asc' | 'desc';
}

/** A row in the list view. `cells` is keyed by `UiFileColumn.key`. */
export interface UiFileRow {
  readonly id: string;
  readonly name: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  readonly cells: Readonly<Record<string, string>>;
  readonly decoration?: UiGitDecoration;
  readonly selected?: boolean;
  readonly focused?: boolean;
  /** Selected, but the owning group is not focused (dimmed selection). */
  readonly inactiveSelected?: boolean;
  /**
   * Nesting level below the listed folder, 0 based — only read when the list
   * renders as a tree (`UiFileList.tree`). Drives indentation and `aria-level`.
   */
  readonly depth?: number;
  /** A directory in a tree: the row gets a twisty. */
  readonly expandable?: boolean;
  /** An expandable row showing its children. */
  readonly expanded?: boolean;
  /** An expanded row whose contents are being fetched — the twisty spins. */
  readonly busy?: boolean;
  /** A folder: dragged entries may be dropped onto it (PRD 005, §2). */
  readonly dropTarget?: boolean;
  /** On the clipboard to be moved: drawn faded, as file managers do. */
  readonly cut?: boolean;
}

/** A tile in the grid ("large icons") view. */
export interface UiIconViewItem {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  readonly selected?: boolean;
  /** The one tile that owns keyboard focus; drives the roving tabindex. */
  readonly focused?: boolean;
  /** A folder: dragged entries may be dropped onto it (PRD 005, §2). */
  readonly dropTarget?: boolean;
  /** On the clipboard to be moved: drawn faded. */
  readonly cut?: boolean;
}

/** One segment of the path bar above a panel body. */
export interface UiBreadcrumb {
  readonly id: string;
  readonly label: string;
  readonly icon?: UiIconName;
}
