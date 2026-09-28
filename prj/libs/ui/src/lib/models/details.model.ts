import type { UiIconName, UiIconTint } from './icon.model';

/** A label/value pair in the details sidebar. */
export interface UiProperty {
  readonly label: string;
  readonly value: string;
  /** Render the value in the monospace face (hashes, modes, paths). */
  readonly mono?: boolean;
  /** Tints the value with the matching git decoration colour. */
  readonly tone?: 'default' | 'modified' | 'untracked' | 'conflict';
  /**
   * Makes the value a button reporting this id (`UiPropertyList.action`) —
   * `1000+ items`, clicked to count them all (PRD 004, §3.1.3).
   */
  readonly action?: string;
  /** What the button does, for its tooltip and accessible name. */
  readonly actionLabel?: string;
}

/** read/write/execute for one principal. */
export interface UiPermissionTriplet {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute: boolean;
}

/** The full POSIX permission matrix plus its octal rendering. */
export interface UiPermissions {
  readonly owner: UiPermissionTriplet;
  readonly group: UiPermissionTriplet;
  readonly others: UiPermissionTriplet;
  /** e.g. `'0644'`. */
  readonly mode: string;
}

/** A coloured tag chip. */
export interface UiChip {
  readonly id: string;
  readonly label: string;
  /** Any CSS colour for the leading dot. */
  readonly color?: string;
}

/** A row of the "Open with" list. */
export interface UiActionListItem {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Right-aligned hint, e.g. `'default'`. */
  readonly tag?: string;
}

/** The preview card at the top of the details sidebar. */
export interface UiPreview {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  /**
   * A URL for the entry's own picture, shown in place of the type icon
   * (PRD 001, §9). The application makes it, owns it and revokes it; the card
   * only draws it.
   */
  readonly imageSrc?: string;
}
