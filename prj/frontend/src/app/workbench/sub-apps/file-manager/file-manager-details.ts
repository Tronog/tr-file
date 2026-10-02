import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { UiActionList, UiPane, UiPermissionGrid, UiPreviewCard, UiPropertyList, UiSidebar, UiSourceControl } from '@tr-file/ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The file manager's right sidebar (PRD 001, §1.1): Git, and everything known
 * about the entry selected. Render-only, like the workbench it is a part of.
 */
@Component({
  selector: 'app-file-manager-details',
  imports: [NgTemplateOutlet, UiActionList, UiPane, UiPermissionGrid, UiPreviewCard, UiPropertyList, UiSidebar, UiSourceControl],
  templateUrl: './file-manager-details.html',
  styleUrl: './file-manager.scss',
})
export class FileManagerDetails {
  protected readonly workbench = inject(WorkbenchService);
}
