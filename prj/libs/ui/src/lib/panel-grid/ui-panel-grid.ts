import { Component, TemplateRef, computed, contentChild, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { UiSash } from '../sash/ui-sash';
import type { UiGridNode, UiSashResize, UiSplitResize } from '../models';

/** Nothing may be squeezed below this many pixels by a drag. */
const MIN_CELL_PX = 120;

/**
 * Renders the recursive editor layout described by a `UiGridNode`.
 *
 * The recursion is a self-referencing `<ng-template>` driven by
 * `NgTemplateOutlet`, not the component recursing into itself: a component in
 * its own `imports` array is a cycle Angular cannot resolve. Sizes are
 * `flex-grow` shares, so a split is `display: flex` with a `ui-sash` between
 * adjacent children. The caller supplies the leaf rendering, either as the
 * `leafTemplate` input or as a `#leaf` template projected as content.
 *
 * Each rendered node carries its `path` — the child indices that address it
 * from the root — so a sash can name the split it belongs to without the grid
 * keeping any state. Dragging one measures the two adjacent cells and emits
 * replacement shares; the owner of the tree applies them.
 */
@Component({
  selector: 'ui-panel-grid',
  imports: [NgTemplateOutlet, UiSash],
  templateUrl: './ui-panel-grid.html',
  styleUrl: './ui-panel-grid.scss',
})
export class UiPanelGrid {
  readonly node = input.required<UiGridNode>();

  /** Rendered for every leaf, with the group id as `$implicit`. */
  readonly leafTemplate = input<TemplateRef<{ $implicit: string }> | null>(null);

  /** When set, only this group is rendered, filling the grid: no splits, no sashes. */
  readonly maximizedGroupId = input<string | null>(null);

  /** New shares for the pair a dragged sash separates. */
  readonly resize = output<UiSplitResize>();

  private readonly leafContent = contentChild<TemplateRef<{ $implicit: string }>>('leaf');

  protected readonly template = computed(() => this.leafTemplate() ?? this.leafContent());

  /** The root's path: `[]` addresses the root node itself. */
  protected readonly rootPath: readonly number[] = [];

  /**
   * Child paths, cached by the path they extend. Angular memoises a template's
   * array literals by their arguments, so handing the outlet a freshly built
   * array on every check would make its context look changed every time; the
   * cache keeps one stable instance per position instead.
   */
  private readonly paths = new Map<string, readonly number[]>();

  /** The path of child `index` under the node at `path`. */
  protected pathTo(path: readonly number[], index: number): readonly number[] {
    const key = `${path.join('.')}:${index}`;
    const cached = this.paths.get(key);
    if (cached) {
      return cached;
    }
    const next: readonly number[] = [...path, index];
    this.paths.set(key, next);
    return next;
  }

  /** A child's share of its parent split: `size` grows, everything shrinks. */
  protected flexOf(node: UiGridNode): string {
    return `${node.size ?? 1} 1 0`;
  }

  /**
   * The leading child's percentage of the pair a sash separates — what a screen
   * reader reads out as the sash moves.
   */
  protected shareOf(node: UiGridNode, index: number): number {
    const pair = this.pairOf(node, index);
    if (!pair) {
      return 50;
    }
    const [first, second] = pair;
    const total = first + second;
    return total > 0 ? (first / total) * 100 : 50;
  }

  /**
   * Turns one step of a sash drag into replacement shares for the two cells it
   * separates, keeping their combined share constant so the rest of the split
   * never moves. Emits nothing for the drag's `start`/`end`, for a zero delta,
   * or when the step would push either cell below `MIN_CELL_PX`.
   */
  protected onResize(
    event: UiSashResize,
    node: UiGridNode,
    path: readonly number[],
    index: number,
    container: HTMLElement,
  ): void {
    if (event.phase !== 'move' || event.delta === 0 || node.kind !== 'split') {
      return;
    }

    const shares = this.pairOf(node, index);
    if (!shares) {
      return;
    }

    // A sash sits between every pair of cells, so the cells are the container's
    // children at even positions.
    const first = container.children.item(index * 2);
    const second = container.children.item((index + 1) * 2);
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
      return;
    }

    const column = node.direction === 'column';
    const firstPx = column ? first.offsetHeight : first.offsetWidth;
    const secondPx = column ? second.offsetHeight : second.offsetWidth;
    const totalPx = firstPx + secondPx;
    if (totalPx <= 0) {
      return;
    }

    const nextFirstPx = firstPx + event.delta;
    const nextSecondPx = totalPx - nextFirstPx;
    if (nextFirstPx < MIN_CELL_PX || nextSecondPx < MIN_CELL_PX) {
      return;
    }

    const totalShare = shares[0] + shares[1];
    const nextFirstShare = (totalShare * nextFirstPx) / totalPx;
    this.resize.emit({
      path,
      index,
      sizes: [nextFirstShare, totalShare - nextFirstShare],
    });
  }

  /** The `size` shares of children `index` and `index + 1`, or `null` if there is no such pair. */
  private pairOf(node: UiGridNode, index: number): readonly [number, number] | null {
    if (node.kind !== 'split') {
      return null;
    }
    const first = node.children[index];
    const second = node.children[index + 1];
    if (!first || !second) {
      return null;
    }
    return [first.size ?? 1, second.size ?? 1];
  }
}
