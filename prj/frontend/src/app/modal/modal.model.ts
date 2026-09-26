import type { Injector, Type, WritableSignal } from '@angular/core';
import type { UiDialogModel, UiDialogResult, UiDialogSeverity } from '@tr-file/ui';

/** A message dialog: `ModalService.show` and the helpers built on it. */
export interface DialogOptions extends UiDialogModel {
  /** `false` hides the close button and makes `Escape` shake the window instead. */
  readonly dismissible?: boolean;
  /** Checks the field on every change; a message blocks the primary button. */
  readonly validate?: (value: string) => string | null;
}

export interface ConfirmOptions {
  readonly message: string;
  readonly detail?: string;
  readonly severity?: UiDialogSeverity;
  /** The primary button; `OK` when omitted. */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export interface PromptOptions {
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
export interface ComponentModalOptions {
  /** Inputs to set on the component. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /** The window's accessible name. */
  readonly label: string;
  readonly dismissible?: boolean;
}

/** One open modal window, as `ModalHost` renders it. */
export type ModalEntry = DialogEntry | ComponentEntry;

export interface DialogEntry {
  readonly kind: 'dialog';
  readonly id: number;
  readonly model: WritableSignal<UiDialogModel>;
  readonly dismissible: boolean;
  readonly validate?: (value: string) => string | null;
  readonly resolve: (result: UiDialogResult | null) => void;
}

export interface ComponentEntry {
  readonly kind: 'component';
  readonly id: number;
  readonly component: Type<unknown>;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly injector: Injector;
  readonly label: string;
  readonly dismissible: boolean;
  readonly resolve: (result: unknown) => void;
}
