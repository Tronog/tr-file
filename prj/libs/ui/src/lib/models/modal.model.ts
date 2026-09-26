import type { UiIconName } from './icon.model';

/**
 * VS Code's message dialogs (PRD 002, §3): what kind of message it is, which
 * picks the icon and its colour. `none` shows no icon.
 */
export type UiDialogSeverity = 'info' | 'warning' | 'error' | 'question' | 'none';

export interface UiDialogButton {
  readonly id: string;
  readonly label: string;
}

/** A text field in a dialog — a rename, a new folder's name. */
export interface UiDialogInput {
  readonly value: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly password?: boolean;
  /** Why the current value will not do; while set, the primary button is disabled. */
  readonly error?: string;
  /** Characters selected when the field takes focus, e.g. a name without its extension. */
  readonly selection?: readonly [number, number];
}

/**
 * One message dialog. The first button is the primary one — the default for
 * `Enter`, and drawn in the accent colour — as in VS Code.
 */
export interface UiDialogModel {
  readonly severity?: UiDialogSeverity;
  readonly message: string;
  /** A second, quieter paragraph under the message. */
  readonly detail?: string;
  readonly buttons: readonly UiDialogButton[];
  readonly checkbox?: { readonly label: string; readonly checked?: boolean };
  readonly input?: UiDialogInput;
}

/** What the user chose, with the state of the checkbox and the field. */
export interface UiDialogResult {
  readonly buttonId: string;
  readonly checked: boolean;
  readonly value: string;
}

/** The icon each severity draws. */
export const UI_DIALOG_ICONS: Readonly<Record<Exclude<UiDialogSeverity, 'none'>, UiIconName>> = {
  info: 'info',
  question: 'info',
  warning: 'alert-triangle',
  error: 'alert-circle',
};

/**
 * A long-running operation, as `UiProgressDialog` shows it (PRD 005, §1).
 * The application builds it from whatever reports the progress.
 */
export interface UiProgressDialogModel {
  /** e.g. `Copying 3 items to /docs`. */
  readonly title: string;
  /** What is being worked on right now; `null` between entries. */
  readonly current: string | null;
  /** 0–100, or `null` while there is nothing to measure against. */
  readonly progress: number | null;
  /** e.g. `2 of 10 items · 1.2 MB of 4 MB`. */
  readonly status: string;
  readonly state: 'running' | 'done' | 'failed' | 'cancelled';
  /** Cancel was asked for and the operation has not stopped yet. */
  readonly cancelling?: boolean;
  /** Why it failed, when it did. */
  readonly error?: string;
}
