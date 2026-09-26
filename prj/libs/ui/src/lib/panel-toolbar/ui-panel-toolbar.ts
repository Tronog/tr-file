import { Component, input, output } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import type { UiIconAction } from '../models';

/**
 * The 30px toolbar row a panel's content puts under its path bar.
 *
 * Content-agnostic on purpose: every kind of panel content gets the same row,
 * so a new one looks like it belongs without restyling anything. Leading icon
 * actions come from `actions`; anything else a content type needs — a view
 * switch, a filter box — is projected after them, and `summary` sits at the
 * far right.
 */
@Component({
  selector: 'ui-panel-toolbar',
  imports: [UiIconButton],
  template: `
    @for (item of actions(); track item.id) {
      <ui-icon-button
        [icon]="item.icon"
        [label]="item.label"
        [active]="!!item.active"
        [disabled]="!!item.disabled"
        (action)="action.emit(item.id)"
      />
    }

    <ng-content />

    @if (summary(); as summary) {
      <span class="summary">{{ summary }}</span>
    }
  `,
  styleUrl: './ui-panel-toolbar.scss',
})
export class UiPanelToolbar {
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Right-aligned status text, e.g. `'6 items'`. */
  readonly summary = input<string | undefined>(undefined);

  readonly action = output<string>();
}
