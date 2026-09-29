import { Component, inject, input } from '@angular/core';
import { UiCheatsheet, UiHelp } from '@tr-file/ui';
import { MODAL_REF, type ModalRef } from '../../modal/modal-ref';
import type { HelpFeature } from '../features/help.feature';

/**
 * The Help window (PRD 001, §16): the library's `UiHelp` in a large modal
 * window, its tab drawn inside it — the *Cheatsheet* (§16.1). Opened by
 * `HelpFeature`, whose model it draws; the close button closes it, as
 * `Escape` does.
 */
@Component({
  selector: 'app-help-modal',
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
export class HelpModal {
  readonly help = input.required<HelpFeature>();

  protected readonly ref = inject<ModalRef<null>>(MODAL_REF);
}
