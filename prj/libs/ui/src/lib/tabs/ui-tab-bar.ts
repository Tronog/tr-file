import { Component, computed, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UiIconButton } from '../controls/ui-icon-button';
import type { UiIconAction, UiTab } from '../models';

/**
 * An editor group's tab bar: the open tabs plus the group's own action icons.
 *
 * Two rendering rules are not obvious from the markup: the 1px accent rule on
 * the active tab appears only while the owning group is focused (`groupActive`),
 * and a `dirty` tab trades its close button for an 8px dot, exactly as VS Code
 * does. The close button is a sibling of the tab button rather than a child,
 * because a button may never nest inside another button.
 */
@Component({
  selector: 'ui-tab-bar',
  imports: [UiIcon, UiIconButton],
  templateUrl: './ui-tab-bar.html',
  styleUrl: './ui-tab-bar.scss',
  host: {
    '[class.is-group-active]': 'groupActive()',
  },
})
export class UiTabBar {
  readonly tabs = input.required<readonly UiTab[]>();

  /** Icons shown at the far right of the bar (split, maximize, more…). */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Whether the owning group has focus; drives the active tab's accent rule. */
  readonly groupActive = input<boolean>(false);

  /** Accessible name of the tab list. */
  readonly label = input<string>('Open folders');

  readonly select = output<string>();
  readonly close = output<string>();
  readonly actionSelect = output<string>();

  /** The one tab that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const tabs = this.tabs();
    return (tabs.find((tab) => tab.active) ?? tabs[0])?.id ?? null;
  });

  protected onClose(event: Event, id: string): void {
    event.stopPropagation();
    this.close.emit(id);
  }
}
