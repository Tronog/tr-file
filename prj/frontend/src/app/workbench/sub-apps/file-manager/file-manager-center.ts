import { Component, inject } from '@angular/core';
import { UiBottomPanel, UiNotes, UiPanelGrid, UiPanelGroup, UiSash } from '@tr-file/ui';
import { UiFileBrowser, UiTransferList } from '@tr-file/file-ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The file manager's centre (PRD 001, §1.1): the split grid of panels above
 * the bottom panel. Render-only; `inactive` keeps it drawn but out of sight
 * while another sub-application is shown (`SubAppsFeature`).
 */
@Component({
  selector: 'app-file-manager-center',
  imports: [UiBottomPanel, UiFileBrowser, UiNotes, UiPanelGrid, UiPanelGroup, UiSash, UiTransferList],
  templateUrl: './file-manager-center.html',
  styleUrl: './file-manager.scss',
  host: {
    class: 'editor-area',
    '[class.is-inactive]': '!workbench.subAppsFt.fileManager()',
  },
})
export class FileManagerCenter {
  protected readonly workbench = inject(WorkbenchService);
}
