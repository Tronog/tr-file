import type { UiIconName, UiIconTint } from './icon.model';

/** A label/value pair in the details sidebar. */
export interface UiProperty {
  readonly label: string;
  readonly value: string;
  /** Render the value in the monospace face (hashes, modes, paths). */
  readonly mono?: boolean;
  /** Tints the value with the matching git decoration colour. */
  readonly tone?: 'default' | 'modified' | 'untracked' | 'conflict';
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
}
