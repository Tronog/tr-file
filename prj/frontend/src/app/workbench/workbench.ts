import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import {
  UiActionList,
  UiActivityBar,
  UiBottomPanel,
  UiContextMenu,
  UiFileBrowser,
  UiPane,
  UiPanelGrid,
  UiPanelGroup,
  UiPermissionGrid,
  UiQuickInput,
  UiPreviewCard,
  UiSearchField,
  UiPropertyList,
  UiSash,
  UiSidebar,
  UiSourceControl,
  UiButton,
  UiStatusBar,
  UiTitleBar,
  UiTransferList,
  UiTree,
  UiWorkbench,
} from '@tr-file/ui';
import type { FocusRegionId } from './features/focus-cycle.feature';
import { WorkbenchService } from './workbench.service';

/** What `Ctrl`+`Tab` can land on inside a sidebar or the bottom panel. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    UiContextMenu,
    UiFileBrowser,
    UiPane,
    UiSourceControl,
    UiButton,
    UiPanelGrid,
    UiPanelGroup,
    UiPermissionGrid,
    UiQuickInput,
    UiPreviewCard,
    UiPropertyList,
    UiSearchField,
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
  host: {
    // The palette opens from anywhere in the workbench (PRD 009, §1), and
    // `Ctrl`+`Tab` moves between its parts from anywhere (PRD 002, §2.6).
    '(document:keydown)': 'onDocumentKeydown($event)',
    '(focusin)': 'onFocusIn($event)',
    // What is waiting to be remembered is written before the window goes (PRD 003, §6).
    '(window:pagehide)': 'workbench.sessionFt.flush()',
  },
})
export class Workbench {
  protected readonly workbench = inject(WorkbenchService);

  private readonly filePicker = viewChild.required<ElementRef<HTMLInputElement>>('filePicker');
  private readonly folderPicker = viewChild.required<ElementRef<HTMLInputElement>>('folderPicker');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The element that last had focus in each region, to return to it. */
  private readonly lastFocused = new Map<FocusRegionId, HTMLElement>();

  constructor() {
    // The first listings are fetched here rather than in the service, so that
    // constructing the service in a test performs no I/O.
    this.workbench.start();
    // Git (PRD 011, §1) follows the active panel from here on, for the same reason.
    this.workbench.gitFt.start();

    // A feature asked for files — or a folder (PRD 003, §6); only the component may open the picker.
    effect(() => {
      const request = this.workbench.uploadRequest();
      if (request) {
        (request.folder ? this.folderPicker() : this.filePicker()).nativeElement.click();
      }
    });
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    this.workbench.commandPaletteFt.handleShortcut(event);
    this.workbench.searchFt.handleShortcut(event);
    const direction = this.workbench.focusCycleFt.directionOf(event);
    if (direction === 0 || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    const current = this.regionOf(document.activeElement);
    for (const region of this.workbench.focusCycleFt.sequence(current, direction)) {
      if (this.workbench.focusCycleFt.enter(region) || this.focusRegion(region)) {
        return;
      }
    }
  }

  protected onFocusIn(event: FocusEvent): void {
    const region = this.regionOf(event.target);
    if (region !== null && event.target instanceof HTMLElement) {
      this.lastFocused.set(region, event.target);
    }
  }

  /**
   * Focuses a sidebar or the bottom panel: where focus last was in it, else
   * its first tab stop — a roving `tabindex="0"` first, so a tree is entered on
   * its current row. `false` when it has nothing to focus, so the next region
   * is tried.
   */
  private focusRegion(region: FocusRegionId): boolean {
    const element = this.host.querySelector<HTMLElement>(`[data-focus-region="${region}"]`);
    if (element === null) {
      return false;
    }
    const remembered = this.lastFocused.get(region);
    const target =
      (remembered?.isConnected && element.contains(remembered) && remembered.matches(FOCUSABLE) ? remembered : null) ??
      element.querySelector<HTMLElement>('[tabindex="0"]') ??
      element.querySelector<HTMLElement>(FOCUSABLE);
    if (target === null) {
      return false;
    }
    target.focus();
    return document.activeElement === target;
  }

  private regionOf(target: EventTarget | null): FocusRegionId | null {
    const element = target instanceof Element ? target.closest('[data-focus-region]') : null;
    return (element?.getAttribute('data-focus-region') as FocusRegionId | null) ?? null;
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
