import { Component, Injector, afterNextRender, afterRenderEffect, computed, inject, input, output, signal, viewChildren, type ElementRef } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UI_TREE_ROW_MIME, type UiContextMenuRequest, type UiTreeMove, type UiTreeNode } from '../models';

/**
 * The row being dragged, and the tree it is in. A drag's payload cannot be
 * read before the drop, so this is how a row under the pointer knows whether
 * the drag is one of its own tree's — rows move within their tree.
 */
let dragging: { readonly id: string; readonly tree: UiTree } | null = null;

/**
 * The directory tree.
 *
 * Renders one flat, pre-computed list: `depth`, `guides` and `expanded` already
 * describe the shape, so the component never walks a hierarchy. Non-expandable
 * rows still reserve the twisty slot so every label lines up, and the indent
 * guides come straight from `guides` (one 8px cell per ancestor level).
 *
 * Roving tabindex: the `focused` row is the single tab stop, falling back to the
 * first row when no node claims focus.
 *
 * Keyboard follows the ARIA tree pattern, which matters because the twisty is
 * decorative: arrows move between rows, `ArrowRight`/`ArrowLeft` open and close
 * a directory, and `Enter` (the row is a button) activates it. Without this,
 * a keyboard user could never expand anything.
 *
 * A `reorderable` tree — a flat list the user orders, like the Bookmarks
 * (PRD 002, §6.1) — lets a row be dragged onto another of the same tree (the
 * upper half puts it before, the lower half after), or moved a slot with
 * `Ctrl`+`↑`/`↓`, and reports a `UiTreeMove`; the order is the application's.
 */
@Component({
  selector: 'ui-tree',
  templateUrl: './ui-tree.html',
  styleUrl: './ui-tree.scss',
  imports: [UiIcon],
  host: { class: 'ui-tree' },
})
export class UiTree {
  /** The flattened, already-filtered list of visible rows. */
  readonly nodes = input.required<readonly UiTreeNode[]>();

  /** Accessible name for the tree. */
  readonly label = input<string>('Directory tree');

  /** The twisty was clicked; emits the node id. */
  readonly toggle = output<string>();

  /** The row was clicked; emits the node id. */
  readonly activate = output<string>();

  /**
   * The row was double-clicked; emits the node id. Distinct from `activate`
   * because a single click and a double click mean different things in a file
   * manager: reveal versus open.
   */
  readonly open = output<string>();

  /**
   * A row's context menu was asked for — a right-click, `Shift`+`F10` or the
   * menu key (PRD 003, §5). The menu is the application's to draw.
   */
  readonly contextMenu = output<UiContextMenuRequest>();

  /** Whether rows can be dragged into another order, and moved with `Ctrl`+`↑`/`↓`. */
  readonly reorderable = input(false);

  /** A row should move before or after another; see `reorderable`. */
  readonly reorder = output<UiTreeMove>();

  /** The row being dragged out of this tree; dimmed. */
  protected readonly draggedId = signal<string | null>(null);

  /** The row a drag is over, and which half of it. */
  protected readonly dropAt = signal<{ readonly id: string; readonly position: 'before' | 'after' } | null>(null);

  private readonly injector = inject(Injector);

  /** The single tab stop: the focused row, else the first one. */
  protected readonly tabStopId = computed(() => {
    const nodes = this.nodes();
    return nodes.find((node) => node.focused)?.id ?? nodes[0]?.id;
  });

  private readonly rowButtons = viewChildren<ElementRef<HTMLButtonElement>>('rowButton');

  /** The selected row last scrolled to, so it is scrolled to once, not on every render. */
  private scrolledTo: string | null = null;

  constructor() {
    // A newly selected row is brought into view — when the application reveals
    // a folder deep in the tree, possibly once its ancestors' rows have loaded.
    // `nearest`, so a row already in view never moves; focus is left alone.
    afterRenderEffect(() => {
      const nodes = this.nodes();
      const index = nodes.findIndex((node) => node.selected);
      const id = nodes[index]?.id ?? null;
      if (id === this.scrolledTo) {
        return;
      }
      this.scrolledTo = id;
      this.rowButtons()[index]?.nativeElement.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** Keeps a twisty click from also activating the row it sits in. */
  protected onTwisty(event: Event, node: UiTreeNode): void {
    event.stopPropagation();
    this.toggle.emit(node.id);
  }

  protected onRowContextMenu(event: MouseEvent, node: UiTreeNode): void {
    event.preventDefault();
    this.contextMenu.emit({ target: node.id, x: event.clientX, y: event.clientY });
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const nodes = this.nodes();
    const index = this.indexOfTarget(event);
    if (index === -1) {
      return;
    }
    const node = nodes[index];
    if (!node) {
      return;
    }

    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      this.contextMenu.emit({ target: node.id, x: rect.left + 16, y: rect.bottom });
      event.preventDefault();
      return;
    }

    if (this.reorderable() && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveBy(index, event.key === 'ArrowUp' ? -1 : 1);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(index + 1);
        break;
      case 'ArrowUp':
        this.focusRow(index - 1);
        break;
      case 'Home':
        this.focusRow(0);
        break;
      case 'End':
        this.focusRow(nodes.length - 1);
        break;
      case 'ArrowRight':
        // Closed directory opens; an open one steps into its first child.
        if (node.expandable && !node.expanded) {
          this.toggle.emit(node.id);
        } else if (node.expandable) {
          this.focusRow(index + 1);
        }
        break;
      case 'ArrowLeft':
        // Open directory closes; anything else steps out to its parent.
        if (node.expandable && node.expanded) {
          this.toggle.emit(node.id);
        } else {
          this.focusParent(index);
        }
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  /* -- reordering ------------------------------------------------------------ */

  protected onDragStart(event: DragEvent, node: UiTreeNode): void {
    const transfer = event.dataTransfer;
    if (!this.reorderable() || !transfer) {
      return;
    }
    transfer.setData(UI_TREE_ROW_MIME, node.id);
    transfer.effectAllowed = 'move';
    dragging = { id: node.id, tree: this };
    this.draggedId.set(node.id);
  }

  protected onDragEnd(): void {
    dragging = null;
    this.draggedId.set(null);
    this.dropAt.set(null);
  }

  protected onDragOver(event: DragEvent, node: UiTreeNode): void {
    if (!this.accepts(event, node)) {
      return;
    }
    event.preventDefault();
    (event.dataTransfer as DataTransfer).dropEffect = 'move';
    this.dropAt.set({ id: node.id, position: UiTree.positionAt(event) });
  }

  protected onDragLeave(event: DragEvent, node: UiTreeNode): void {
    const related = event.relatedTarget;
    if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    if (this.dropAt()?.id === node.id) {
      this.dropAt.set(null);
    }
  }

  protected onDrop(event: DragEvent, node: UiTreeNode): void {
    this.dropAt.set(null);
    if (!this.accepts(event, node) || dragging === null) {
      return;
    }
    event.preventDefault();
    this.reorder.emit({ id: dragging.id, targetId: node.id, position: UiTree.positionAt(event) });
  }

  /** A row of this tree, other than `node`, is dragged over `node`. */
  private accepts(event: DragEvent, node: UiTreeNode): boolean {
    const types = event.dataTransfer?.types;
    return (
      this.reorderable() &&
      types !== undefined &&
      Array.from(types).includes(UI_TREE_ROW_MIME) &&
      dragging !== null &&
      dragging.tree === this &&
      dragging.id !== node.id
    );
  }

  /** `Ctrl`+`↑`/`↓`: a slot up or down, past the neighbour; the row keeps the keyboard. */
  private moveBy(index: number, by: -1 | 1): void {
    const nodes = this.nodes();
    const node = nodes[index];
    const target = nodes[index + by];
    if (node === undefined || target === undefined) {
      return;
    }
    this.reorder.emit({ id: node.id, targetId: target.id, position: by === -1 ? 'before' : 'after' });
    // Moving the element in the DOM can take focus from it; give it back.
    afterNextRender(
      () => {
        const at = this.nodes().findIndex((candidate) => candidate.id === node.id);
        this.focusRow(at);
      },
      { injector: this.injector },
    );
  }

  private static positionAt(event: DragEvent): 'before' | 'after' {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  /** Index of the row the event came from, or `-1` when it came from nowhere. */
  private indexOfTarget(event: KeyboardEvent): number {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return -1;
    }
    const row = target.closest('[role="treeitem"]');
    return this.rowButtons().findIndex((button) => button.nativeElement === row);
  }

  private focusRow(index: number): void {
    this.rowButtons()[index]?.nativeElement.focus();
  }

  /** The nearest row above that sits one level shallower. */
  private focusParent(index: number): void {
    const nodes = this.nodes();
    const depth = nodes[index]?.depth ?? 0;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if ((nodes[candidate]?.depth ?? 0) < depth) {
        this.focusRow(candidate);
        return;
      }
    }
  }
}
