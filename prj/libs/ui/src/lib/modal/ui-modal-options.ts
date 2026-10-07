import type { Injector, Type, WritableSignal } from '@angular/core';
import type { UiDialogModel, UiDialogResult, UiDialogSeverity } from '../models';

/** A message dialog: `UiModalService.show` and the helpers built on it. */
export interface UiDialogOptions extends UiDialogModel {
  /** `false` hides the close button and makes `Escape` shake the window instead. */
  readonly dismissible?: boolean;
  /** Checks the field on every change; a message blocks the primary button. */
  readonly validate?: (value: string) => string | null;
  /**
   * Stays above every window opened after it, rather than going under the
   * next one (PRD 004, §2.2): a question something is waiting on — a file
   * operation's *Skip* / *Retry* — must never be covered by, say, the
   * progress window of the very job that asks it.
   */
  readonly onTop?: boolean;
}

export interface UiConfirmOptions {
  readonly message: string;
  readonly detail?: string;
  readonly severity?: UiDialogSeverity;
  /** The primary button; `OK` when omitted. */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export interface UiPromptOptions {
  readonly message: string;
  readonly detail?: string;
  readonly value?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly password?: boolean;
  readonly confirmLabel?: string;
  /** Characters to select when the field takes focus, e.g. a name without its extension. */
  readonly selection?: readonly [number, number];
  readonly validate?: (value: string) => string | null;
}

/** Opening a component of the application's own in a modal window. */
export interface UiComponentModalOptions {
  /** Inputs to set on the component. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /** The window's accessible name. */
  readonly label: string;
  readonly dismissible?: boolean;
  /** `large` for a window to work in, like the settings (PRD 010). */
  readonly size?: 'default' | 'large';
}

/** One open modal window, as `UiModalHost` renders it. */
export type UiModalEntry = UiModalDialogEntry | UiModalComponentEntry;

export interface UiModalDialogEntry {
  readonly kind: 'dialog';
  readonly id: number;
  /** Kept above the ordinary windows; see `UiDialogOptions.onTop`. */
  readonly onTop?: boolean;
  readonly model: WritableSignal<UiDialogModel>;
  readonly dismissible: boolean;
  readonly validate?: (value: string) => string | null;
  readonly resolve: (result: UiDialogResult | null) => void;
}

export interface UiModalComponentEntry {
  readonly kind: 'component';
  readonly id: number;
  readonly component: Type<unknown>;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly injector: Injector;
  readonly label: string;
  readonly dismissible: boolean;
  readonly size: 'default' | 'large';
  readonly resolve: (result: unknown) => void;
}
