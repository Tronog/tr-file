import { inject, Service, signal } from '@angular/core';
import { BottomPanelFeature } from './features/bottom-panel.feature';
import { ChromeFeature } from './features/chrome.feature';
import { DetailsFeature } from './features/details.feature';
import { EditorGroupsFeature } from './features/editor-groups.feature';
import { ExplorerFeature } from './features/explorer.feature';
import { PanelLayoutFeature } from './features/panel-layout.feature';
import { SidebarPanesFeature } from './features/sidebar-panes.feature';
import { WorkbenchResizeFeature } from './features/workbench-resize.feature';
import { FileViewModelFeature } from './features/file-view-model.feature';
import { MockDataFileSystemService } from './mock-data/mock-data-file-system.service';
import { MockDataTransfersService } from './mock-data/mock-data-transfers.service';
import { MockDataWorkbenchService } from './mock-data/mock-data-workbench.service';

/**
 * The workbench's common state, and the seam every feature talks through.
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`: it holds the handful of signals
 * more than one feature needs — the shared selection, the active group, the
 * sizes of the resizable regions — and owns one instance of each feature class.
 * Everything else (flattening the tree, building panel view models, formatting)
 * lives in those features; the component only renders what they expose.
 */
@Service()
export class WorkbenchService {
  /** Mock data sources. Swapping these for backend-backed ones is the plan. */
  readonly mockFileSystem = inject(MockDataFileSystemService);
  readonly mockWorkbench = inject(MockDataWorkbenchService);
  readonly mockTransfers = inject(MockDataTransfersService);

  /* -- common state ------------------------------------------------------ */

  /** The entry the details sidebar describes, wherever it was selected. */
  readonly selectedEntryId = signal(this.mockWorkbench.layout.selectedEntryId);

  /** The focused panel group: only its tabs and selection render as active. */
  readonly activeGroupId = signal(this.mockWorkbench.layout.activeGroupId);

  readonly leftSidebarWidth = signal(this.mockWorkbench.layout.leftSidebarWidth);
  readonly rightSidebarWidth = signal(this.mockWorkbench.layout.rightSidebarWidth);
  readonly bottomPanelHeight = signal(this.mockWorkbench.layout.bottomPanelHeight);

  /* -- features ---------------------------------------------------------- */

  /** Shared formatting; constructed first because other features use it. */
  readonly fileViewModel = new FileViewModelFeature();

  readonly chromeFt = new ChromeFeature(this);
  /** Owns the split tree; constructed before the feature that mutates it. */
  readonly panelLayoutFt = new PanelLayoutFeature(this);
  readonly explorerFt = new ExplorerFeature(this);
  readonly editorGroupsFt = new EditorGroupsFeature(this);
  readonly detailsFt = new DetailsFeature(this);
  readonly bottomPanelFt = new BottomPanelFeature(this);
  readonly sidebarPanesFt = new SidebarPanesFeature(this);
  readonly resizeFt = new WorkbenchResizeFeature(this);
}
