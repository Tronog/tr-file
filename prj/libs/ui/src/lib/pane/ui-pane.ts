import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UiSash } from '../sash/ui-sash';
import { UI_PANE_MIME, type UiIconAction, type UiIconActionAt, type UiPaneMove, type UiPaneResize, type UiSashResize } from '../models';

/** A sash drag under way: every expanded pane's height and least height, and the two the sash is between. */
interface ResizeState {
  readonly heights: Record<string, number>;
  readonly mins: Record<string, number>;
  readonly aboveId: string;
  readonly belowId: string;
}

/** The least a resized pane's body keeps below its header: one row. */
const MIN_BODY_HEIGHT = 22;

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
 *
 * A pane with an expanded pane above it and one at or below it — itself, or
 * past collapsed headers — has a sash on its top edge (PRD 002, §5.2; which
 * panes do is the sidebar's stylesheet), as every boundary does in VS Code:
 * dragging it trades height between those two, reported as a `UiPaneResize` of every
 * expanded pane — measured, so the ones that were never sized join in. A
 * `size` given back makes the pane that share of the sidebar, as a weight.
 */
@Component({
  selector: 'ui-pane',
  templateUrl: './ui-pane.html',
  styleUrl: './ui-pane.scss',
  imports: [UiIcon, UiSash],
  host: {
    class: 'ui-pane',
    '[class.is-grow]': 'grow()',
    '[class.is-sized]': 'sized()',
    '[style.flex]': "sized() ? size() + ' 1 0px' : null",
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

  /** Height as a weight among the sidebar's sized panes (`UiPaneResize`); `null` sizes to content, or `grow`. */
  readonly size = input<number | null>(null);

  /** The header was clicked; the caller flips `expanded`. */
  readonly toggle = output<void>();

  /** Emits the `id` of the clicked header action. */
  readonly actionSelect = output<string>();

  /** The same click, with where the button is — for a `…` that opens a menu beside it. */
  readonly actionAt = output<UiIconActionAt>();

  /** A pane — this one, by key, or another, dropped here — should move. */
  readonly paneMove = output<UiPaneMove>();

  /** The sash on the top edge was dragged. */
  readonly paneResize = output<UiPaneResize>();

  /** Instance counter — a unique body id without pulling in a service. */
  private static nextId = 0;

  protected readonly bodyId = `ui-pane-${UiPane.nextId++}`;

  /** This pane is the one being dragged; dims it. */
  protected readonly dragged = signal(false);

  /** Where a pane dragged over this one would go, or `null`. */
  protected readonly dropAt = signal<'before' | 'after' | null>(null);

  protected readonly sized = computed(() => this.expanded() && this.size() !== null);

  /** A sash drag under way; measured when it starts. */
  private resizing: ResizeState | null = null;

  private readonly toggleButton = viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');

  protected select(id: string, event: MouseEvent): void {
    this.actionSelect.emit(id);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.actionAt.emit({ id, x: rect.left, y: rect.bottom });
  }

  /* -- resizing ---------------------------------------------------------------- */

  protected onSashResize(event: UiSashResize): void {
    if (event.phase === 'end') {
      this.resizing = null;
      return;
    }
    // A key press moves without a `start`.
    this.resizing ??= this.measure();
    const state = this.resizing;
    if (state === null || event.delta === 0) {
      return;
    }
    const { aboveId, belowId, heights, mins } = state;
    const above = heights[aboveId] as number;
    const below = heights[belowId] as number;
    // What one gains the other gives, and neither goes below its header and a row.
    const delta = Math.max((mins[aboveId] as number) - above, Math.min(below - (mins[belowId] as number), event.delta));
    heights[aboveId] = above + delta;
    heights[belowId] = below - delta;
    this.paneResize.emit({ sizes: { ...heights } });
  }

  /**
   * The heights of the expanded panes of this sidebar, as they stand, and the
   * two this sash is between: the nearest expanded pane above it, and this
   * pane — or, when it is collapsed, the nearest expanded one below, its
   * header riding along between them. `null` without one on either side.
   */
  private measure(): ResizeState | null {
    const self = this.host.nativeElement;
    const panes = Array.from(self.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element.classList.contains('ui-pane') && element.hasAttribute('data-pane-id'),
    );
    const expanded = (pane: HTMLElement | undefined) => pane !== undefined && !pane.classList.contains('is-collapsed');
    const at = panes.indexOf(self);
    const above = panes.slice(0, Math.max(at, 0)).reverse().find(expanded);
    const below = at < 0 ? undefined : panes.slice(at).find(expanded);
    if (above === undefined || below === undefined) {
      return null;
    }
    const heights: Record<string, number> = {};
    const mins: Record<string, number> = {};
    for (const pane of panes.filter(expanded)) {
      const id = pane.getAttribute('data-pane-id') as string;
      const header = pane.querySelector<HTMLElement>(':scope > .pane-header');
      heights[id] = pane.getBoundingClientRect().height;
      mins[id] = (header?.getBoundingClientRect().height ?? 0) + 1 + MIN_BODY_HEIGHT;
    }
    const idOf = (pane: HTMLElement) => pane.getAttribute('data-pane-id') as string;
    return { heights, mins, aboveId: idOf(above), belowId: idOf(below) };
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
