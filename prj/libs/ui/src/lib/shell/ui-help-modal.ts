import { Component, inject, input } from '@angular/core';
import { UiCheatsheet } from '../help/ui-cheatsheet';
import { UiHelp } from '../help/ui-help';
import { UI_MODAL_REF, type UiModalRef } from '../modal/ui-modal-ref';
import type { UiHelpFeature } from './features/ui-help.feature';

/**
 * The Help window (PRD 001, §16): the library's `UiHelp` in a large modal
 * window, its tab drawn inside it — the *Cheatsheet* (§16.1). Opened by
 * `UiHelpFeature`, whose model it draws; the close button closes it, as
 * `Escape` does.
 */
@Component({
  selector: 'ui-help-modal',
  imports: [UiHelp, UiCheatsheet],
  template: `
    @let feature = help();
    <ui-help
      [tabs]="feature.tabs"
      [activeTab]="feature.activeTab()"
      [query]="feature.query()"
      searchPlaceholder="Search shortcuts"
      (tabSelect)="feature.selectTab($event)"
      (queryChange)="feature.setQuery($event)"
      (close)="ref.close(null)"
    >
      @switch (feature.activeTab()) {
        @case ('cheatsheet') {
          <ui-cheatsheet [sections]="feature.cheatsheet()" empty="No shortcut matches the search." />
        }
      }
    </ui-help>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
  `,
})
export class UiHelpModal {
  readonly help = input.required<UiHelpFeature>();

  protected readonly ref = inject<UiModalRef<null>>(UI_MODAL_REF);
}
