import type { UiIconName } from './icon.model';

/** A top-level entry of the title bar menu. */
export interface UiMenuBarItem {
  readonly id: string;
  readonly label: string;
  /** Its menu is showing. */
  readonly open?: boolean;
  /** What its menu offers (PRD 008, §1). */
  readonly items?: readonly UiMenuItem[];
}

/** A choice made in one of the menu bar's menus. */
export interface UiMenuBarSelection {
  readonly menuId: string;
  readonly itemId: string;
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

/**
 * The blue *Upgrade* button right of the command palette box (PRD 001, §8.6): the
 * application says a newer version is there, the bar draws it and reports the
 * press.
 */
export interface UiTitleBarUpgrade {
  /** The button's text, e.g. `Upgrade`. */
  readonly label: string;
  /** Its tooltip: what it upgrades to. */
  readonly title: string;
  /** The upgrade is under way; the button waits. */
  readonly busy?: boolean;
}

/**
 * The window's zoom (PRD 001, §8.2.3), drawn as a button beside the theme's
 * that drops down zoom out / in, 100 % and a slider. In percent.
 */
export interface UiTitleBarZoom {
  readonly percent: number;
  readonly min: number;
  readonly max: number;
}

/** What the zoom control asked for: a step, back to 100 %, or a level of the slider's, in percent. */
export type UiZoomRequest = { readonly kind: 'in' } | { readonly kind: 'out' } | { readonly kind: 'reset' } | { readonly kind: 'set'; readonly percent: number };

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

/**
 * One key of the status bar's function-key strip (PRD 004, §2), Midnight
 * Commander's `1Help 2Menu 3View …`: `key` is what is printed before the
 * label — `'5'` for `F5` — and a click reports `id`.
 */
export interface UiFunctionKey {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  /** The tooltip: what the key does, in full. */
  readonly title?: string;
  /** Drawn dimmed and not clickable: there is nothing for it to act on. */
  readonly disabled?: boolean;
}

/** A row of a context menu. */
export interface UiMenuItem {
  readonly id: string;
  readonly label: string;
  readonly keybinding?: string;
  readonly disabled?: boolean;
  /**
   * One of a set of choices, of which this is (or is not) the one in effect:
   * the row is a `menuitemradio` and draws a check mark when `true` — Go ›
   * Local Computer (PRD 008, §1.1). Leave it out for an ordinary row.
   */
  readonly checked?: boolean;
  /** The row under the pointer / keyboard cursor. */
  readonly active?: boolean;
  readonly separatorBefore?: boolean;
}
