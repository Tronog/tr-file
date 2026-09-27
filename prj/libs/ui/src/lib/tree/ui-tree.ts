import { Component, afterRenderEffect, computed, input, output, viewChildren, type ElementRef } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiContextMenuRequest, UiTreeNode } from '../models';

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
