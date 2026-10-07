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

/** One segment of the path bar above a panel body. */
export interface UiBreadcrumb {
  readonly id: string;
  readonly label: string;
  readonly icon?: UiIconName;
}

/**
 * A place the path bar suggests as it is typed in (PRD 004, §4.2): `value`
 * is the whole path it stands for, as it would be typed (`/docs/prd`).
 */
export interface UiPathSuggestion {
  readonly value: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** A folder: completing it with `Tab` adds a `/`, to go on typing inside it. */
  readonly folder?: boolean;
}
