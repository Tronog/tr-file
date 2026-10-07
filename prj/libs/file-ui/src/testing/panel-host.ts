import { Component, input, viewChild } from '@angular/core';
import { UiPanelGroup } from '@tr-file/ui';
import { UiFileBrowser } from '../lib/file-browser/ui-file-browser';
import type { UiPanelGroupModel } from '@tr-file/ui';
import type { UiFileBrowserModel } from '../lib/models';

/**
 * A panel as the workbench composes one: a `UiPanelGroup` frame with a
 * `UiFileBrowser` projected into it, for the specs that are about how the two
 * behave together — focus, blank presses, the keys each of them claims.
 *
 * Not a spec itself. `browser` left `null` is a group with no content, which
 * is what a group with no tabs is.
 */
@Component({
  selector: 'app-panel-host',
  imports: [UiPanelGroup, UiFileBrowser],
  template: `
    <ui-panel-group [group]="group()" [focusBody]="focusBody()" [acceptFiles]="acceptFiles()">
      @if (browser(); as model) {
        <ui-file-browser [browser]="model" />
      }
    </ui-panel-group>
  `,
})
export class PanelHost {
  readonly group = input.required<UiPanelGroupModel>();
  readonly browser = input<UiFileBrowserModel | null>(null);
  readonly focusBody = input<number>(0);
  readonly acceptFiles = input<boolean>(false);

  /** The frame, for its outputs. */
  readonly panel = viewChild.required(UiPanelGroup);

  /** The content, for its outputs; absent while `browser` is `null`. */
  readonly content = viewChild(UiFileBrowser);
}
