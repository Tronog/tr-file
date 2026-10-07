import { Component, inject } from '@angular/core';
import { UiPanelGrid, UiPanelGroup } from '@tr-file/ui';
import { UiDiskUsage } from '@tr-file/file-ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The Disk Usage sub-application (PRD 013): a workbench of panels of its own,
 * split, tabbed and resized like the file manager's, each tab showing what
 * takes up the space in a folder. Render-only; `DiskUsageFeature` holds the
 * panels, the tabs and the scans.
 */
@Component({
  selector: 'app-disk-usage-app',
  imports: [UiDiskUsage, UiPanelGrid, UiPanelGroup],
  template: `
    @let du = workbench.diskUsageFt;
    <div class="editor-grid">
      <ui-panel-grid [node]="du.layout.grid()" [maximizedGroupId]="du.layout.maximizedGroupId()" (resize)="du.layout.resize($event)">
        <ng-template #leaf let-groupId>
          @if (du.group(groupId); as group) {
            <ui-panel-group
              [attr.data-focus-region]="'disk-usage:' + groupId"
              [group]="group"
              [active]="du.activeGroupId() === groupId"
              [focusBody]="du.focusToken(groupId)"
              (focusRequest)="du.activate(groupId)"
              (tabSelect)="du.selectTab(groupId, $event)"
              (tabActivate)="du.focusBody(groupId)"
              (tabDoubleClick)="du.runAction(groupId, 'maximize')"
              (bodyPress)="du.focusBody(groupId)"
              (tabClose)="du.closeTab(groupId, $event)"
              (actionSelect)="du.runAction(groupId, $event)"
            >
              @if (du.content(groupId); as model) {
                <ui-disk-usage
                  [model]="model"
                  (breadcrumbSelect)="du.openBreadcrumb(groupId, $event)"
                  (pathSubmit)="du.goToLocation(groupId, $event)"
                  (locationInput)="du.locationInput(groupId, $event)"
                  (toolbarAction)="du.runToolbarAction(groupId, $event)"
                  (viewChange)="du.setView(groupId, $event)"
                  (depthChange)="du.setDepth(groupId, $event)"
                  (open)="du.openEntry(groupId, $event)"
                />
              }
            </ui-panel-group>
          }
        </ng-template>
      </ui-panel-grid>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      background: var(--vsc-editor-bg);
    }

    :host(.is-inactive) {
      display: none;
    }

    .editor-grid {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
  `,
  host: {
    role: 'region',
    'aria-label': 'Disk Usage',
    '[class.is-inactive]': '!workbench.subAppsFt.isActive("disk-usage")',
  },
})
export class DiskUsageApp {
  protected readonly workbench = inject(WorkbenchService);
}
