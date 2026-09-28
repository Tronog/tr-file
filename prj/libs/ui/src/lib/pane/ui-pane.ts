import { afterNextRender, Component, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UI_PANE_MIME, type UiIconAction, type UiIconActionAt, type UiPaneMove } from '../models';

/**
 * The pane being dragged, and the sidebar it is in. A drag's payload cannot be
 * read before the drop, so this is how a pane under the pointer knows whether
 * the drag is one of its neighbours' — panes move within their own sidebar.
 */
let dragging: { readonly id: string; readonly container: Element | null } | null = null;

/**
 * A collapsible section inside a side bar (Explorer's "tr-file", Details'
 * "Properties", …).
 *
 * The body is removed from the DOM while collapsed, so `aria-controls` is only
 * emitted when there is something to point at. `grow` hands the pane the
 * sidebar's leftover height and makes its body the scroll container.
 *
 * With a `paneId` the pane can be moved among the other panes of its sidebar
 * (PRD 002, §5.1): its header drags onto another pane — the upper half puts it
 * before that one, the lower half after — and `Ctrl`+`↑`/`↓` on the header
 * moves it a slot. Either is reported as a `UiPaneMove`; the order is the
 * caller's to keep.
 */
@Component({
  selector: 'ui-pane',
  templateUrl: './ui-pane.html',
  styleUrl: './ui-pane.scss',
  imports: [UiIcon],
  host: {
    class: 'ui-pane',
    '[class.is-grow]': 'grow()',
    '[class.is-collapsed]': '!expanded()',
    '[class.is-dragging]': 'dragged()',
    '[class.drop-before]': "dropAt() === 'before'",
    '[class.drop-after]': "dropAt() === 'after'",
    '[attr.data-pane-id]': 'paneId()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class UiPane {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Uppercase header label. */
  readonly title = input.required<string>();

  /** Whether the body is rendered. */
  readonly expanded = input<boolean>(true);

  /** Icon buttons rendered at the right of the header. */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Take the remaining sidebar space and scroll the body. */
  readonly grow = input<boolean>(false);

  /** Names the pane among its sidebar's, and makes it movable; `null` keeps it where it is. */
  readonly paneId = input<string | null>(null);

  /** The header was clicked; the caller flips `expanded`. */
  readonly toggle = output<void>();

  /** Emits the `id` of the clicked header action. */
  readonly actionSelect = output<string>();

  /** The same click, with where the button is — for a `…` that opens a menu beside it. */
  readonly actionAt = output<UiIconActionAt>();

  /** A pane — this one, by key, or another, dropped here — should move. */
  readonly paneMove = output<UiPaneMove>();

  /** Instance counter — a unique body id without pulling in a service. */
  private static nextId = 0;

  protected readonly bodyId = `ui-pane-${UiPane.nextId++}`;

  /** This pane is the one being dragged; dims it. */
  protected readonly dragged = signal(false);

  /** Where a pane dragged over this one would go, or `null`. */
  protected readonly dropAt = signal<'before' | 'after' | null>(null);

  private readonly toggleButton = viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');

  protected select(id: string, event: MouseEvent): void {
    this.actionSelect.emit(id);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.actionAt.emit({ id, x: rect.left, y: rect.bottom });
  }

  /* -- moving ---------------------------------------------------------------- */

  protected onDragStart(event: DragEvent): void {
    const id = this.paneId();
    const transfer = event.dataTransfer;
    if (id === null || !transfer) {
      return;
    }
    transfer.setData(UI_PANE_MIME, id);
    transfer.effectAllowed = 'move';
    dragging = { id, container: this.host.nativeElement.parentElement };
    this.dragged.set(true);
  }

  protected onDragEnd(): void {
    dragging = null;
    this.dragged.set(false);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.accepts(event)) {
      return;
    }
    event.preventDefault();
    (event.dataTransfer as DataTransfer).dropEffect = 'move';
    this.dropAt.set(this.positionAt(event.clientY));
  }

  protected onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget;
    if (related instanceof Node && this.host.nativeElement.contains(related)) {
      return;
    }
    this.dropAt.set(null);
  }

  protected onDrop(event: DragEvent): void {
    this.dropAt.set(null);
    const targetId = this.paneId();
    if (!this.accepts(event) || targetId === null || dragging === null) {
      return;
    }
    event.preventDefault();
    this.paneMove.emit({ paneId: dragging.id, targetId, position: this.positionAt(event.clientY) });
  }

  /** `Ctrl`+`↑`/`↓` on the header: a slot up or down, past the neighbour on screen. */
  protected onHeaderKeyDown(event: KeyboardEvent): void {
    const paneId = this.paneId();
    if (paneId === null || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      return;
    }
    const up = event.key === 'ArrowUp';
    if (!up && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    const targetId = this.neighbourId(up);
    if (targetId === null) {
      return;
    }
    this.paneMove.emit({ paneId, targetId, position: up ? 'before' : 'after' });
    // Moving the element in the DOM takes focus from it; give it back.
    afterNextRender(() => this.toggleButton().nativeElement.focus(), { injector: this.injector });
  }

  /** A pane of this sidebar is dragged over another of it. */
  private accepts(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return (
      this.paneId() !== null &&
      types !== undefined &&
      Array.from(types).includes(UI_PANE_MIME) &&
      dragging !== null &&
      dragging.id !== this.paneId() &&
      dragging.container === this.host.nativeElement.parentElement
    );
  }

  private positionAt(clientY: number): 'before' | 'after' {
    const rect = this.host.nativeElement.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  /** The movable pane shown next to this one, above or below. */
  private neighbourId(up: boolean): string | null {
    let sibling = this.host.nativeElement[up ? 'previousElementSibling' : 'nextElementSibling'];
    while (sibling !== null) {
      const id = sibling.classList.contains('ui-pane') ? sibling.getAttribute('data-pane-id') : null;
      if (id !== null) {
        return id;
      }
      sibling = sibling[up ? 'previousElementSibling' : 'nextElementSibling'];
    }
    return null;
  }
}
