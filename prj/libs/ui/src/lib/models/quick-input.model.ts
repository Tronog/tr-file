/**
 * VS Code's quick input (PRD 009, §1): the box at the top of the window the
 * command palette — and, later, anything else that asks for one line or one
 * choice — is drawn in.
 */

import type { UiIconName } from './icon.model';

/**
 * An action on one row — VS Code's quick-pick item buttons: edit, remove.
 * Drawn on the active row and the row under the pointer; `shortcut` is its
 * key on the active row, e.g. `F2` or `Shift+Delete`.
 */
export interface UiQuickPickButton {
  readonly id: string;
  readonly icon: UiIconName;
  /** Accessible name and tooltip. */
  readonly label: string;
  readonly shortcut?: string;
}

/** One row of the list. */
export interface UiQuickPickItem {
  readonly id: string;
  /** Drawn before the label, e.g. a server, or a plus for "Add…". */
  readonly icon?: UiIconName;
  /** e.g. `Go: Jump to Folder…`. */
  readonly label: string;
  /** Quieter text after the label. */
  readonly description?: string;
  /** Right-aligned key chips, e.g. `['Ctrl', 'Shift', 'P']`. */
  readonly keys?: readonly string[];
  /** Characters of `label` that matched the query, as `[start, end)` ranges; drawn highlighted. */
  readonly highlights?: readonly (readonly [number, number])[];
  readonly buttons?: readonly UiQuickPickButton[];
}

/** A row's button was pressed, or its shortcut used on the active row. */
export interface UiQuickPickButtonEvent {
  readonly itemId: string;
  readonly buttonId: string;
}

/** A line under the field: a hint, or why the value will not do. */
export interface UiQuickInputMessage {
  readonly severity: 'info' | 'warning' | 'error';
  readonly text: string;
}
