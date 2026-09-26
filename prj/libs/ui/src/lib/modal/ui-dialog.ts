import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import { UiButton } from '../controls/ui-button';
import { UiIcon } from '../icon/ui-icon';
import { UI_DIALOG_ICONS, type UiDialogModel, type UiDialogResult } from '../models';

let nextId = 0;

/**
 * VS Code's message dialog (PRD 002, §3), to be put inside a `UiModal`.
 *
 * The layout is VS Code's: a close button in the corner, the severity icon
 * beside the message, a quieter detail under it, then an optional text field
 * and checkbox, and the buttons along the bottom right. The first button is
 * the primary one — accent-coloured, focused first, and what `Enter` in the
 * field presses; `←`/`→` move between buttons.
 *
 * Render-only: it reports the choice — which button, and the state of the
 * checkbox and the field — and never closes itself. The field's value is
 * reported as it changes too, so the application can validate it and hand an
 * `error` back in the model.
 */
@Component({
  selector: 'ui-dialog',
  imports: [UiButton, UiIcon],
  templateUrl: './ui-dialog.html',
  styleUrl: './ui-dialog.scss',
})
export class UiDialog {
  readonly dialog = input.required<UiDialogModel>();

  /** Whether the corner close button is drawn; `UiModal.dismissible` should agree. */
  readonly dismissible = input<boolean>(true);

  /** A button was pressed. */
  readonly choose = output<UiDialogResult>();

  /** The close button was pressed. */
  readonly dismiss = output<void>();

  /** The text field changed. */
  readonly valueChange = output<string>();

  /**
   * Prefix of the ids the message and detail get, for `UiModal.labelledBy`
   * and `describedBy`: `<prefix>-message` and `<prefix>-detail`.
   */
  readonly idPrefix = input<string>(`ui-dialog-${(nextId += 1)}`);

  protected readonly messageId = computed(() => `${this.idPrefix()}-message`);
  protected readonly detailId = computed(() => `${this.idPrefix()}-detail`);

  protected readonly icon = computed(() => {
    const severity = this.dialog().severity ?? 'info';
    return severity === 'none' ? null : UI_DIALOG_ICONS[severity];
  });

  protected readonly severity = computed(() => this.dialog().severity ?? 'info');

  /** The checkbox and the field, as the user leaves them. */
  protected readonly checked = linkedSignal(() => this.dialog().checkbox?.checked ?? false);
  protected readonly value = linkedSignal(() => this.dialog().input?.value ?? '');

  /** The primary button waits for a field that will do. */
  protected readonly blocked = computed(() => this.dialog().input?.error !== undefined);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  // `read: ElementRef`: each button hosts `UiButton`, which the query would return otherwise.
  private readonly buttons = viewChildren('choice', { read: ElementRef<HTMLButtonElement> });

  constructor() {
    afterNextRender(() => {
      const range = this.dialog().input?.selection;
      const field = this.field()?.nativeElement;
      if (field !== undefined) {
        if (range !== undefined) {
          field.setSelectionRange(range[0], range[1]);
        } else {
          field.select();
        }
      }
    });
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.valueChange.emit(value);
  }

  protected onFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const primary = this.dialog().buttons[0];
      if (primary !== undefined && !this.blocked()) {
        this.press(primary.id);
      }
    }
  }

  /** `←`/`→` walk the buttons, as in VS Code; they wrap at either end. */
  protected onButtonKeydown(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const buttons = this.buttons();
    buttons[(index + step + buttons.length) % buttons.length]?.nativeElement.focus();
  }

  protected press(buttonId: string): void {
    this.choose.emit({ buttonId, checked: this.checked(), value: this.value() });
  }
}
