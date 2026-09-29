import { Component, ElementRef, input, output, viewChildren } from '@angular/core';
import { UiSearchField } from '../controls/ui-search-field';
import { UiIcon } from '../icon/ui-icon';
import type { UiHelpTab } from '../models/help.model';

/**
 * The Help window's frame (PRD 001, §16): a title, a row of tabs, a search box
 * and a close button; the active tab's content is projected into its panel.
 *
 * The tabs are a WAI-ARIA tab list — `←`/`→`, `Home`/`End` move between them
 * and choose as they go — and every choice is reported (`tabSelect`), never
 * applied: the application says which tab is `activeTab`.
 */
@Component({
  selector: 'ui-help',
  imports: [UiIcon, UiSearchField],
  templateUrl: './ui-help.html',
  styleUrl: './ui-help.scss',
})
export class UiHelp {
  readonly tabs = input.required<readonly UiHelpTab[]>();

  readonly activeTab = input.required<string>();

  /** The search box's text; the application filters what it hands the tab. */
  readonly query = input<string>('');

  readonly searchPlaceholder = input<string>('Search');

  readonly tabSelect = output<string>();

  readonly queryChange = output<string>();

  readonly close = output<void>();

  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tab');

  protected tabId(id: string): string {
    return `ui-help-tab-${id}`;
  }

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab !== undefined) {
      this.tabButtons()[next]?.nativeElement.focus();
      this.tabSelect.emit(tab.id);
    }
  }
}
