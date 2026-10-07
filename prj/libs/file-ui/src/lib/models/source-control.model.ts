import type { UiIconAction, UiIconName, UiIconTint } from '@tr-file/ui';

/** How a change is coloured: VS Code's git decorations. */
export type UiScmTone = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

/** One changed file of a group. */
export interface UiScmItem {
  readonly id: string;
  /** The file's name. */
  readonly name: string;
  /** Dim text after it — the folder it is in. */
  readonly description?: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  /** The letter on the right, `M`, `A`, `D`, `R`, `U`. */
  readonly letter: string;
  readonly tone: UiScmTone;
  /** Tooltip, and the row's accessible description: `src/app.ts · Modified`. */
  readonly title: string;
  /** Icon buttons shown on the row while it is hovered or focused. */
  readonly actions: readonly UiIconAction[];
}

/** Staged Changes, Changes, Merge Changes — VS Code's resource groups. */
export interface UiScmGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly UiScmItem[];
  /** Header buttons: stage all, discard all… */
  readonly actions: readonly UiIconAction[];
  readonly collapsed?: boolean;
  /** Drawn after the rows: why some are missing. */
  readonly note?: string;
}

/** One commit of the log under the changes. */
export interface UiScmCommit {
  readonly id: string;
  readonly subject: string;
  /** `Ana · 2 hours ago`. */
  readonly detail: string;
  /** The abbreviated hash. */
  readonly short: string;
  /** Branches and tags on it, as chips. */
  readonly refs?: readonly string[];
  /** Tooltip. */
  readonly title?: string;
}

/**
 * The source control view (PRD 011, §1): where a repository stands, a box
 * for the commit message, the changes by group, and the latest commits.
 * Rendered by `UiSourceControl`; everything in it is the application's.
 */
export interface UiScmModel {
  /** `main`, or `abc1234 (detached)`. */
  readonly branch: string;
  /** What the branch button says it does. */
  readonly branchTitle: string;
  /** `↓1 ↑2`, omitted when there is nothing to sync or nowhere to sync with. */
  readonly sync?: string;
  readonly syncTitle?: string;
  /** A line under the branch — a merge in progress, a failure. */
  readonly note?: string;
  readonly noteTone?: 'info' | 'error';
  readonly message: string;
  readonly messagePlaceholder: string;
  readonly commitLabel: string;
  readonly canCommit: boolean;
  /** Something is running: the controls wait for it. */
  readonly busy?: boolean;
  /** Bump to put the keyboard in the message box; any change is one request. */
  readonly messageFocus?: number;
  readonly groups: readonly UiScmGroup[];
  readonly commits: readonly UiScmCommit[];
  readonly commitsCollapsed?: boolean;
  /** There are older commits to load. */
  readonly moreCommits?: boolean;
  /** Shown instead of the groups when nothing has changed. */
  readonly clean?: string;
}

/** A button of a row or of a group's header. */
export interface UiScmActionEvent {
  /** The item's id, or the group's. */
  readonly targetId: string;
  readonly actionId: string;
}
