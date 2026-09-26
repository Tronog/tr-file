import type { UiIconName } from './icon.model';

/** A top-level entry of the title bar menu. */
export interface UiMenuBarItem {
  readonly id: string;
  readonly label: string;
  readonly open?: boolean;
}

/**
 * One of the window buttons drawn at the end of the title bar
 * (PRD 001, §8.2).
 *
 * Separate from `UiIconAction` because these are not application actions: they
 * sit in their own group at the very end of the bar, they are taller and
 * squarer than a chrome button, and the last of them turns red on hover. The
 * library draws them and reports the click; only the desktop shell can
 * actually minimise a window.
 */
export interface UiWindowControl {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Renders the red hover of a close button. */
  readonly danger?: boolean;
}

/** An icon button in the activity bar. */
export interface UiActivityItem {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly active?: boolean;
  /** Unread/pending count rendered as the corner badge. */
  readonly badge?: number;
  /**
   * Opens a menu rather than a view (VS Code's Manage gear): the button says
   * so to assistive tech, and a press is reported as `menuOpen`, with where
   * the button is, instead of `select`.
   */
  readonly hasMenu?: boolean;
  /** For a `hasMenu` item: its menu is open. */
  readonly expanded?: boolean;
}

/** Where a menu should open: the button that asked for it, in viewport pixels. */
export interface UiMenuAnchor {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
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
