import { Component, TemplateRef, computed, contentChild, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { UiSash } from '../sash/ui-sash';
import type { UiGridNode } from '../models';

/**
 * Renders the recursive editor layout described by a `UiGridNode`.
 *
 * The recursion is a self-referencing `<ng-template>` driven by
 * `NgTemplateOutlet`, not the component recursing into itself: a component in
 * its own `imports` array is a cycle Angular cannot resolve. Sizes are
 * `flex-grow` shares, so a split is `display: flex` with a `ui-sash` between
 * adjacent children. The caller supplies the leaf rendering, either as the
 * `leafTemplate` input or as a `#leaf` template projected as content.
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

  private readonly leafContent = contentChild<TemplateRef<{ $implicit: string }>>('leaf');

  protected readonly template = computed(() => this.leafTemplate() ?? this.leafContent());

  /** A child's share of its parent split: `size` grows, everything shrinks. */
  protected flexOf(node: UiGridNode): string {
    return `${node.size ?? 1} 1 0`;
  }
}
