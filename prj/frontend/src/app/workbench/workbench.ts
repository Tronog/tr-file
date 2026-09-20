import { Component, effect, inject, viewChild, type ElementRef } from '@angular/core';
import {
  UiActionList,
  UiActivityBar,
  UiBottomPanel,
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
 * The file manager screen: the VS Code style workbench from PRD 001 Section 1,
 * showing the real file system served by `/api/fs`.
 *
 * Render-only by design — it wires library components to the signals the
 * feature classes expose and forwards events straight back to them. The two
 * exceptions are unavoidable DOM work: kicking off the first load, and opening
 * the hidden file picker, which only an element reference can do.
 */
@Component({
  selector: 'app-workbench',
  imports: [
    UiActionList,
    UiActivityBar,
    UiBottomPanel,
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

  private readonly filePicker = viewChild.required<ElementRef<HTMLInputElement>>('filePicker');

  constructor() {
    // The first listings are fetched here rather than in the service, so that
    // constructing the service in a test performs no I/O.
    this.workbench.start();

    // A feature asked for files; only the component may open the picker.
    effect(() => {
      if (this.workbench.uploadRequest()) {
        this.filePicker().nativeElement.click();
      }
    });
  }

  /** Hands the chosen files to the group that asked for them. */
  protected onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const request = this.workbench.uploadRequest();
    const files = Array.from(input.files ?? []);

    if (request && files.length > 0) {
      this.workbench.transfersFt.uploadFiles(request.path, files);
    }

    // Reset so choosing the same file twice in a row still fires `change`.
    input.value = '';
    this.workbench.clearUploadRequest();
  }
}
