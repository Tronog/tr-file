import { Injector, Service, computed, inject, signal, type Type } from '@angular/core';
import type { UiDialogResult } from '@tr-file/ui';
import { MODAL_REF, type ModalRef } from './modal-ref';
import type {
  ComponentModalOptions,
  ConfirmOptions,
  DialogEntry,
  DialogOptions,
  ModalEntry,
  PromptOptions,
} from './modal.model';

/**
 * Modal windows (PRD 002, §3), the way VS Code has them.
 *
 * Every call opens a window on top of whatever is open already and resolves
 * when it closes, so a caller simply awaits the answer:
 *
 *     if (await modal.confirm({ message: 'Replace it?', confirmLabel: 'Replace' })) { … }
 *     const name = await modal.prompt({ message: 'New folder', validate });
 *
 * `show` is the whole message dialog — severity, detail, any buttons, a
 * checkbox, a field — and `confirm`, `prompt` and `message` are the shapes
 * nearly every caller wants. `open` puts one of the application's own
 * components in a window, for anything a message dialog cannot say.
 *
 * The windows themselves are drawn by `ModalHost`, once, at the root; this
 * service only keeps the stack. Closing without an answer — `Escape`, the
 * close button — resolves with `null`.
 */
@Service()
export class ModalService {
  private readonly injector = inject(Injector);
  private readonly entries = signal<readonly ModalEntry[]>([]);
  private sequence = 0;

  /** Open windows, bottom first; only the last is interactive. */
  readonly stack = this.entries.asReadonly();

  /** Whether any window is open — the page behind is inert while one is. */
  readonly isOpen = computed(() => this.entries().length > 0);

  /** Opens a message dialog; resolves with the button chosen, or `null` if dismissed. */
  show(options: DialogOptions): Promise<UiDialogResult | null> {
    const { dismissible, validate, ...model } = options;
    return new Promise((resolve) => {
      const id = (this.sequence += 1);
      const entry: DialogEntry = {
        kind: 'dialog',
        id,
        model: signal(validate && model.input ? this.checked(model, validate, model.input.value) : model),
        dismissible: dismissible ?? true,
        ...(validate ? { validate } : {}),
        resolve: (result) => {
          this.remove(id);
          resolve(result);
        },
      };
      this.entries.update((entries) => [...entries, entry]);
    });
  }

  /** A question with one way forward and a way out; `true` for the way forward. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const result = await this.show({
      severity: options.severity ?? 'question',
      message: options.message,
      ...(options.detail ? { detail: options.detail } : {}),
      buttons: [
        { id: 'confirm', label: options.confirmLabel ?? 'OK' },
        { id: 'cancel', label: options.cancelLabel ?? 'Cancel' },
      ],
    });
    return result?.buttonId === 'confirm';
  }

  /** Asks for a line of text; resolves with it, or `null` when cancelled. */
  async prompt(options: PromptOptions): Promise<string | null> {
    const result = await this.show({
      severity: 'none',
      message: options.message,
      ...(options.detail ? { detail: options.detail } : {}),
      input: {
        value: options.value ?? '',
        ...(options.label ? { label: options.label } : {}),
        ...(options.placeholder ? { placeholder: options.placeholder } : {}),
        ...(options.password ? { password: true } : {}),
        ...(options.selection ? { selection: options.selection } : {}),
      },
      buttons: [
        { id: 'confirm', label: options.confirmLabel ?? 'OK' },
        { id: 'cancel', label: 'Cancel' },
      ],
      ...(options.validate ? { validate: options.validate } : {}),
    });
    return result?.buttonId === 'confirm' ? result.value : null;
  }

  /** Tells the user something, with a single button to acknowledge it. */
  async message(options: { message: string; detail?: string; severity?: DialogOptions['severity'] }): Promise<void> {
    await this.show({
      severity: options.severity ?? 'info',
      message: options.message,
      ...(options.detail ? { detail: options.detail } : {}),
      buttons: [{ id: 'ok', label: 'OK' }],
    });
  }

  /**
   * Puts `component` in a modal window. The component injects `MODAL_REF` and
   * closes the window with its result; `Escape` closes it with `null`.
   */
  open<R>(component: Type<unknown>, options: ComponentModalOptions): Promise<R | null> {
    return new Promise((resolve) => {
      const id = (this.sequence += 1);
      const close = (result: unknown): void => {
        this.remove(id);
        resolve(result as R | null);
      };
      const ref: ModalRef<R> = { close };
      this.entries.update((entries) => [
        ...entries,
        {
          kind: 'component',
          id,
          component,
          inputs: options.inputs ?? {},
          injector: Injector.create({ providers: [{ provide: MODAL_REF, useValue: ref }], parent: this.injector }),
          label: options.label,
          dismissible: options.dismissible ?? true,
          size: options.size ?? 'default',
          resolve: close,
        },
      ]);
    });
  }

  /** `Escape` or the close button on window `id`. */
  dismiss(id: number): void {
    this.entries().find((entry) => entry.id === id)?.resolve(null);
  }

  /** A button pressed in dialog `id`. */
  choose(id: number, result: UiDialogResult): void {
    const entry = this.entries().find((candidate) => candidate.id === id);
    if (entry?.kind === 'dialog') {
      entry.resolve(result);
    }
  }

  /** The field of dialog `id` changed: check it, if its caller asked to. */
  edit(id: number, value: string): void {
    const entry = this.entries().find((candidate) => candidate.id === id);
    if (entry?.kind === 'dialog' && entry.validate) {
      const validate = entry.validate;
      entry.model.update((model) => this.checked(model, validate, value));
    }
  }

  private checked(model: DialogOptions, validate: (value: string) => string | null, value: string) {
    const { dismissible: _dismissible, validate: _validate, ...plain } = model;
    const error = validate(value);
    const { error: _previous, ...input } = plain.input ?? { value };
    return { ...plain, input: { ...input, value, ...(error === null ? {} : { error }) } };
  }

  private remove(id: number): void {
    this.entries.update((entries) => entries.filter((entry) => entry.id !== id));
  }
}
