import { Component, inject } from '@angular/core';
import { UiPane, UiSearchField, UiSidebar, UiTree } from '@tr-file/ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The file manager's left sidebar (PRD 001, §1.1): the folder tree, Places,
 * Bookmarks and Recent — or the name search (PRD 003, §5). Render-only, like
 * the workbench it is a part of.
 */
@Component({
  selector: 'app-file-manager-explorer',
  imports: [UiPane, UiSearchField, UiSidebar, UiTree],
  templateUrl: './file-manager-explorer.html',
  styleUrl: './file-manager.scss',
})
export class FileManagerExplorer {
  protected readonly workbench = inject(WorkbenchService);
}
