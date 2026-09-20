import { Component, computed, input, output } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import type { UiIconAction, UiPanelTab } from '../models';

/**
 * The workbench's bottom panel (Problems / Output / Terminal / Transfers).
 *
 * Chrome only: whatever the active tab shows is projected as content, so the
 * panel never needs to know about its own tabs' bodies.
 */
@Component({
  selector: 'ui-bottom-panel',
  imports: [UiIconButton],
  templateUrl: './ui-bottom-panel.html',
  styleUrl: './ui-bottom-panel.scss',
})
export class UiBottomPanel {
  readonly tabs = input.required<readonly UiPanelTab[]>();

  /** Right-aligned chrome icons (clear, maximize, close…). */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Accessible name of the tab list. */
  readonly label = input<string>('Panel');

  readonly select = output<string>();
  readonly actionSelect = output<string>();

  /** The one tab that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const tabs = this.tabs();
    return (tabs.find((tab) => tab.active) ?? tabs[0])?.id ?? null;
  });
}
