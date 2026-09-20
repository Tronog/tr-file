import { Component, computed, input, output } from '@angular/core';
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

  /** The single tab stop: the focused row, else the first one. */
  protected readonly tabStopId = computed(() => {
    const nodes = this.nodes();
    return nodes.find((node) => node.focused)?.id ?? nodes[0]?.id;
  });

  /** Keeps a twisty click from also activating the row it sits in. */
  protected onTwisty(event: Event, node: UiTreeNode): void {
    event.stopPropagation();
    this.toggle.emit(node.id);
  }
}
