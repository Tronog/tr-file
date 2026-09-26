/**
 * VS Code's quick input (PRD 009, §1): the box at the top of the window the
 * command palette — and, later, anything else that asks for one line or one
 * choice — is drawn in.
 */

/** One row of the list. */
export interface UiQuickPickItem {
  readonly id: string;
  /** e.g. `Go: Jump to Folder…`. */
  readonly label: string;
  /** Quieter text after the label. */
  readonly description?: string;
  /** Right-aligned key chips, e.g. `['Ctrl', 'Shift', 'P']`. */
  readonly keys?: readonly string[];
  /** Characters of `label` that matched the query, as `[start, end)` ranges; drawn highlighted. */
  readonly highlights?: readonly (readonly [number, number])[];
}

/** A line under the field: a hint, or why the value will not do. */
export interface UiQuickInputMessage {
  readonly severity: 'info' | 'warning' | 'error';
  readonly text: string;
}
