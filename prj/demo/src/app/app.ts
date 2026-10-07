import { Component, inject } from '@angular/core';
import { UiModalHost, UiModalService, UiThemeService } from '@tr-file/ui';
import { DemoWorkbench } from './demo-workbench';

/** The page: the workbench, and the modal windows over it — which make it inert while one is open. */
@Component({
  selector: 'demo-root',
  imports: [DemoWorkbench, UiModalHost],
  template: `
    <div class="content" [attr.inert]="modal.isOpen() ? '' : null"><demo-workbench /></div>
    <ui-modal-host />
  `,
  styles: `
    :host,
    .content {
      display: block;
      height: 100%;
    }
  `,
})
export class App {
  protected readonly modal = inject(UiModalService);

  constructor() {
    // The colour theme, applied before anything is drawn.
    inject(UiThemeService);
  }
}
