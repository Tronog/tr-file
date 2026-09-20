import { Component, computed, input, output, viewChildren, type ElementRef } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiTreeNode } from '../models';

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

  /** The single tab stop: the focused row, else the first one. */
  protected readonly tabStopId = computed(() => {
    const nodes = this.nodes();
    return nodes.find((node) => node.focused)?.id ?? nodes[0]?.id;
  });

  private readonly rowButtons = viewChildren<ElementRef<HTMLButtonElement>>('rowButton');

  /** Keeps a twisty click from also activating the row it sits in. */
  protected onTwisty(event: Event, node: UiTreeNode): void {
    event.stopPropagation();
    this.toggle.emit(node.id);
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
