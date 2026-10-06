import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { UiBottomTabTemplate, UiNotes, UiPanelContentTemplate, UiSidebarTemplate, UiSubAppTemplate, UiWorkbenchShell } from '@tr-file/ui';
import { UiFileBrowser, UiTransferList } from '@tr-file/file-ui';
import { DiskUsageApp } from './sub-apps/disk-usage/disk-usage-app';
import { FileManagerDetails } from './sub-apps/file-manager/file-manager-details';
import { FileManagerExplorer } from './sub-apps/file-manager/file-manager-explorer';
import { SearchApp } from './sub-apps/search/search-app';
import { WorkbenchService } from './workbench.service';

/**
 * The window: the library's workbench shell (PRD 001, §17.1) — the title
 * bar, the activity bar and the status bar every sub-application shares, the
 * panels, the bottom panel — with what the file manager draws in it: the
 * content of each kind of tab, the bottom panel's tabs, the Explorer and
 * Details sidebars, and the other sub-applications (§1.1), Search and Disk
 * Usage.
 *
 * Render-only by design — it hands templates to the shell, wires the file
 * manager's components to the signals the feature classes expose and
 * forwards events straight back to them. The one exception is unavoidable DOM
 * work: opening the hidden file picker, which only an element reference can do.
 */
@Component({
  selector: 'app-workbench',
  imports: [
    DiskUsageApp,
    FileManagerDetails,
    FileManagerExplorer,
    SearchApp,
    UiBottomTabTemplate,
    UiFileBrowser,
    UiNotes,
    UiPanelContentTemplate,
    UiSidebarTemplate,
    UiSubAppTemplate,
    UiTransferList,
    UiWorkbenchShell,
  ],
  templateUrl: './workbench.html',
  styleUrl: './workbench.scss',
  host: {
    // What is waiting to be remembered is written before the window goes (PRD 001, §12.2).
    '(window:pagehide)': 'workbench.notesFt.flush()',
  },
})
export class Workbench {
  protected readonly workbench = inject(WorkbenchService);

  private readonly filePicker = viewChild.required<ElementRef<HTMLInputElement>>('filePicker');
  private readonly folderPicker = viewChild.required<ElementRef<HTMLInputElement>>('folderPicker');

  constructor() {
    // Git (PRD 011, §1) follows the active panel from here on, rather than from
    // the service, so that constructing the service in a test performs no I/O.
    this.workbench.gitFt.start();
    // The server's clock in the status bar (PRD 001, §13.1): asked from here too, not from the service.
    this.workbench.serverClockFt.start();
    // The title bar's *Upgrade* button (PRD 001, §8.6) follows the desktop shell from here too.
    this.workbench.appUpdateFt.start();

    // A feature asked for files — or a folder (PRD 003, §6); only the component may open the picker.
    effect(() => {
      const request = this.workbench.uploadRequest();
      if (request) {
        (request.folder ? this.folderPicker() : this.filePicker()).nativeElement.click();
      }
    });
  }

  /** Hands the chosen files to the group that asked for them. */
  protected onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const request = this.workbench.uploadRequest();
    const files = Array.from(input.files ?? []);

    if (request && files.length > 0) {
      if (request.folder) {
        // Each file carries its path under the chosen folder.
        this.workbench.transfersFt.uploadFolder(request.path, files);
      } else {
        this.workbench.transfersFt.uploadFiles(request.path, files);
      }
    }

    // Reset so choosing the same file twice in a row still fires `change`.
    input.value = '';
    this.workbench.clearUploadRequest();
  }
}
