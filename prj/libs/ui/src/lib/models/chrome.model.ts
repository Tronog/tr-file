import type { UiIconName } from './icon.model';

/** A top-level entry of the title bar menu. */
export interface UiMenuBarItem {
  readonly id: string;
  readonly label: string;
  readonly open?: boolean;
}

/** An icon button in the activity bar. */
export interface UiActivityItem {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly active?: boolean;
  /** Unread/pending count rendered as the corner badge. */
  readonly badge?: number;
}

/** An item in the status bar. */
export interface UiStatusItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: UiIconName;
  readonly trailingIcon?: UiIconName;
  /** Renders on the accent background, like VS Code's remote indicator. */
  readonly accent?: boolean;
  readonly title?: string;
}

/** A row of a context menu. */
export interface UiMenuItem {
  readonly id: string;
  readonly label: string;
  readonly keybinding?: string;
  readonly disabled?: boolean;
  /** The row under the pointer / keyboard cursor. */
  readonly active?: boolean;
  readonly separatorBefore?: boolean;
}
