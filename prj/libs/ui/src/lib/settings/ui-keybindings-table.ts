import { Component, ElementRef, afterRenderEffect, computed, input, output, signal, viewChild, viewChildren } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { chordOf, chordParts, displayKey } from '../keyboard/keymap';
import type { UiKeybindingRecording, UiKeybindingRequest, UiKeybindingRow } from '../models/settings.model';

/**
 * The Keyboard Shortcuts page (PRD 010, §2), VS Code's: a table of every
 * command with its key, where the key applies and where it came from — and
 * a recorder that takes the next key pressed.
 *
 * On a row: `Enter` (or a double click, or the pencil) records a new key for
 * it, `Delete` takes its key away; the row's buttons also add one more key
 * and put a changed command back. `↑`/`↓`, `Home`/`End` move between rows.
 *
 * While `recording` is set the recorder has the keyboard: every key pressed
 * is reported as a chord (`record`), `Enter` accepts what was recorded
 * (`accept`) — or is recorded itself, as the first key — and `Escape` gives
 * up (`cancel`). Neither reaches the window around it, so `Escape` does not
 * close the settings. Which key is recorded and what it conflicts with is the
 * application's to say.
 */
@Component({
  selector: 'ui-keybindings-table',
  imports: [UiIcon],
  templateUrl: './ui-keybindings-table.html',
  styleUrl: './ui-keybindings-table.scss',
})
export class UiKeybindingsTable {
  readonly rows = input.required<readonly UiKeybindingRow[]>();

  readonly recording = input<UiKeybindingRecording | null>(null);

  /** Something asked of a row: change its key, add one, remove it, reset its command. */
  readonly request = output<UiKeybindingRequest>();

  /** A key pressed while recording, as a chord. */
  readonly record = output<string>();

  /** `Enter` while recording, with a key recorded. */
  readonly accept = output<void>();

  /** `Escape` while recording. */
  readonly cancel = output<void>();

  /** The row the keyboard is on; the first when none was chosen. */
  private readonly cursor = signal<string | null>(null);

  protected readonly cursorId = computed(() => {
    const rows = this.rows();
    const cursor = this.cursor();
    return rows.some((row) => row.id === cursor) ? cursor : (rows[0]?.id ?? null);
  });

  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');
  private readonly recorder = viewChild<ElementRef<HTMLElement>>('recorder');

  /**
   * The row recording was for, to hand the keyboard back to when it ends —
   * or, if a new key gave it a new id, the first row of its command.
   */
  private recordedRow: { readonly id: string; readonly command: string } | null = null;

  constructor() {
    afterRenderEffect(() => {
      const recording = this.recording();
      if (recording !== null) {
        const command = this.rows().find((row) => row.id === recording.rowId)?.command ?? '';
        this.recordedRow = { id: recording.rowId, command };
        const recorder = this.recorder()?.nativeElement;
        if (recorder !== undefined && document.activeElement !== recorder) {
          recorder.focus();
        }
      } else if (this.recordedRow !== null) {
        const { id, command } = this.recordedRow;
        this.recordedRow = null;
        const rows = this.rows();
        this.focusRow(rows.find((row) => row.id === id)?.id ?? rows.find((row) => row.command === command)?.id ?? this.cursorId() ?? undefined);
      }
    });
  }

  protected keysOf(key: string): readonly string[] {
    return chordParts(key).map(displayKey);
  }

  protected ask(rowId: string, action: UiKeybindingRequest['action']): void {
    this.cursor.set(rowId);
    this.request.emit({ rowId, action });
  }

  protected onRowFocus(rowId: string): void {
    this.cursor.set(rowId);
  }

  protected onRowKeydown(event: KeyboardEvent, index: number): void {
    const rows = this.rows();
    const row = rows[index];
    if (row === undefined || event.target !== event.currentTarget) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(rows[Math.min(index + 1, rows.length - 1)]?.id);
        break;
      case 'ArrowUp':
        this.focusRow(rows[Math.max(index - 1, 0)]?.id);
        break;
      case 'Home':
        this.focusRow(rows[0]?.id);
        break;
      case 'End':
        this.focusRow(rows.at(-1)?.id);
        break;
      case 'Enter':
      case 'F2':
        this.ask(row.id, 'change');
        break;
      case 'Delete':
        if (row.key === null) {
          return;
        }
        this.ask(row.id, 'remove');
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * A key in the recorder. Kept from the window around it — the settings
   * would close on `Escape`, the workbench would run the key — and from the
   * browser, which would act on `Tab` or `F5`.
   */
  protected onRecorderKeydown(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const chord = chordOf(event);
    if (chord === null) {
      return;
    }
    if (chord === 'Escape') {
      this.cancel.emit();
    } else if (chord === 'Enter' && this.recording()?.key !== null) {
      this.accept.emit();
    } else {
      this.record.emit(chord);
    }
  }

  private focusRow(id: string | undefined): void {
    if (id === undefined) {
      return;
    }
    this.cursor.set(id);
    this.rowElements()
      .find((element) => element.nativeElement.dataset['rowId'] === id)
      ?.nativeElement.focus();
  }
}
