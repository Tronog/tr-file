import { Component, inject } from '@angular/core';
import {
  UiActionList,
  UiActivityBar,
  UiBottomPanel,
  UiChipList,
  UiPane,
  UiPanelGrid,
  UiPanelGroup,
  UiPermissionGrid,
  UiPreviewCard,
  UiPropertyList,
  UiSash,
  UiSidebar,
  UiStatusBar,
  UiTitleBar,
  UiTransferList,
  UiTree,
  UiWorkbench,
} from '@tr-file/ui';
import { WorkbenchService } from './workbench.service';

/**
 * The file manager screen: the VS Code style workbench from PRD 001 Section 1.
 *
 * Render-only by design — it wires library components to the signals the
 * feature classes expose and forwards events straight back to them. No state,
 * no formatting, no branching logic lives here.
 */
@Component({
  selector: 'app-workbench',
  imports: [
    UiActionList,
    UiActivityBar,
    UiBottomPanel,
    UiChipList,
    UiPane,
    UiPanelGrid,
    UiPanelGroup,
    UiPermissionGrid,
    UiPreviewCard,
    UiPropertyList,
    UiSash,
    UiSidebar,
    UiStatusBar,
    UiTitleBar,
    UiTransferList,
    UiTree,
    UiWorkbench,
  ],
  templateUrl: './workbench.html',
  styleUrl: './workbench.scss',
})
export class Workbench {
  protected readonly workbench = inject(WorkbenchService);
}
