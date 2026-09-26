import { computed, inject, Service, signal } from '@angular/core';
import { DesktopWindowService } from '../desktop/desktop-window.service';
import { FileSystemService } from '../file-system/file-system.service';
import { ImageSourceService } from '../file-system/image-source.service';
import { BottomPanelFeature } from './features/bottom-panel.feature';
import { ChromeFeature } from './features/chrome.feature';
import { DetailsFeature } from './features/details.feature';
import { EditorGroupsFeature } from './features/editor-groups.feature';
import { ExplorerFeature } from './features/explorer.feature';
import { ExplorerNavigationFeature } from './features/explorer-navigation.feature';
import { FileBrowserFeature } from './features/file-browser.feature';
import { FilePreviewFeature } from './features/file-preview.feature';
import { FileViewModelFeature } from './features/file-view-model.feature';
import { FsDataFeature } from './features/fs-data.feature';
import { PanelFocusFeature } from './features/panel-focus.feature';
import { PanelHistoryFeature } from './features/panel-history.feature';
import { PanelKeyboardFeature } from './features/panel-keyboard.feature';
import { PanelLayoutFeature } from './features/panel-layout.feature';
import { PreviewRetentionFeature } from './features/preview-retention.feature';
import { SidebarPanesFeature } from './features/sidebar-panes.feature';
import { TransfersFeature } from './features/transfers.feature';
import { WindowControlsFeature } from './features/window-controls.feature';
import { WorkbenchResizeFeature } from './features/workbench-resize.feature';
import { OperationsFeature } from './features/operations.feature';
import { MockDataWorkbenchService } from './mock-data/mock-data-workbench.service';
import { AuthService } from '../auth/auth.service';
import { ModalService } from '../modal/modal.service';
import { CommandPaletteFeature } from './features/command-palette.feature';
import { SavedServersFeature } from './features/saved-servers.feature';
import { RemoteConnectionService } from '../file-system/remote-connection.service';

/**
 * The workbench's common state, and the seam every feature talks through.
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`: it holds the handful of signals
 * more than one feature needs — the shared selection, the active group, the
 * sizes of the resizable regions — and owns one instance of each feature class.
 * Everything else (fetching, flattening the tree, building panel view models,
 * formatting) lives in those features; the component only renders them.
 */
@Service()
export class WorkbenchService {
  /** The backend file system: every listing, detail, download and upload. */
  readonly fileSystem = inject(FileSystemService);

  /**
   * The application's own window, when there is one. Absent in a browser,
   * where the tab supplies its own decorations.
   */
  readonly desktopWindow = inject(DesktopWindowService);

  /**
   * Pictures the browser can draw, cached by path — read by the panel's viewer
   * and by the details sidebar, so the same image is fetched once.
   */
  readonly images = inject(ImageSourceService);

  /** Who is signed in, if anyone has to be (PRD 003, §2). */
  readonly auth = inject(AuthService);

  /** Modal windows — questions the workbench has to ask (PRD 002, §3). */
  readonly modal = inject(ModalService);

  /**
   * Seed for the parts of the workbench no backend owns yet — the menus, the
   * activity bar and the layout the session starts with.
   */
  readonly mockWorkbench = inject(MockDataWorkbenchService);

  /* -- common state ------------------------------------------------------ */

  /** The entry the details sidebar describes, wherever it was selected. */
  readonly selectedEntryId = signal(this.mockWorkbench.layout.selectedEntryId);

  /** The focused panel group: only its tabs and selection render as active. */
  readonly activeGroupId = signal(this.mockWorkbench.layout.activeGroupId);

  /** Dot-files are hidden until the status bar says otherwise. */
  readonly showHidden = signal(false);

  /** Where the backend is: this computer's, or a remote server (PRD 006, §1). */
  readonly connection = inject(RemoteConnectionService);

  /**
   * Which backend the workbench is talking to (PRD 008, §1.2–1.3): this
   * computer's — the desktop's own, or the server that served the page — or a
   * remote server (PRD 006).
   */
  readonly backend = computed<'local' | 'remote'>(() => (this.connection.connected() ? 'remote' : 'local'));

  readonly leftSidebarWidth = signal(this.mockWorkbench.layout.leftSidebarWidth);
  readonly rightSidebarWidth = signal(this.mockWorkbench.layout.rightSidebarWidth);
  readonly bottomPanelHeight = signal(this.mockWorkbench.layout.bottomPanelHeight);

  /**
   * Set when a group asks for the file picker; the component watches this and
   * opens its hidden `<input type="file">`. A signal rather than a method call
   * because only the component can legally touch that element.
   */
  readonly uploadRequest = signal<{ readonly groupId: string; readonly path: string } | null>(null);

  /* -- features ---------------------------------------------------------- */

  /** Shared formatting; constructed first because other features use it. */
  readonly fileViewModel = new FileViewModelFeature();

  /** The cache every view reads from; constructed before its readers. */
  readonly fsDataFt = new FsDataFeature(this);

  readonly transfersFt = new TransfersFeature(this);
  /** Copy, move, trash and empty trash, followed to the end (PRD 005, §1). */
  readonly operationsFt = new OperationsFeature(this);
  /** Read-only file previews; read by the groups that show them. */
  readonly filePreviewFt = new FilePreviewFeature(this);
  readonly chromeFt = new ChromeFeature(this);
  /** Owns the split tree; constructed before the feature that mutates it. */
  readonly panelLayoutFt = new PanelLayoutFeature(this);
  readonly explorerFt = new ExplorerFeature(this);
  readonly editorGroupsFt = new EditorGroupsFeature(this);
  /** File management: what folder and file tabs show, and navigating in them. */
  readonly fileBrowserFt = new FileBrowserFeature(this);
  /** Frees cached file contents once nothing on screen shows them. */
  readonly previewRetentionFt = new PreviewRetentionFeature(this);
  readonly detailsFt = new DetailsFeature(this);
  /** The panel key map; every binding it runs belongs to the features above. */
  readonly panelKeyboardFt = new PanelKeyboardFeature(this);
  /** Sends focus into a panel body once a chosen tab has rendered. */
  readonly panelFocusFt = new PanelFocusFeature(this);
  /** Each panel's own trail of folders, walked with `Alt`+`←`/`→`. */
  readonly panelHistoryFt = new PanelHistoryFeature(this);
  /** Links the two: constructed after the explorer and the groups it drives. */
  readonly explorerNavFt = new ExplorerNavigationFeature(this);
  readonly bottomPanelFt = new BottomPanelFeature(this);
  readonly sidebarPanesFt = new SidebarPanesFeature(this);
  readonly resizeFt = new WorkbenchResizeFeature(this);
  /** The frameless window's own buttons and drag region. */
  readonly windowControlsFt = new WindowControlsFeature(this);
  /** Remote servers kept on this machine, for *Connect to Remote Server* (PRD 009, §1). */
  readonly savedServersFt = new SavedServersFeature();
  /** The command palette: `Ctrl`+`Shift`+`P` (PRD 009, §1). */
  readonly commandPaletteFt = new CommandPaletteFeature(this);

  /* -- cross-feature operations ------------------------------------------ */

  /**
   * Loads what the workbench starts with. Called once by the component rather
   * than from the constructor, so creating the service in a test fetches
   * nothing on its own.
   */
  start(): void {
    this.windowControlsFt.start();
    this.explorerFt.start();
    this.editorGroupsFt.start();
    this.detailsFt.load(this.selectedEntryId());

    // The folder listing is where someone starts (PRD 001, §10.1), so the
    // keyboard starts there too — otherwise the first arrow key after launch
    // goes nowhere and the app has to be clicked before it can be used.
    // Asked for after the listing has been requested, so the group is already
    // `loading`: the request then waits for the first row rather than settling
    // on an empty body.
    this.panelFocusFt.focusBody(this.activeGroupId());
  }

  /** Selects an entry anywhere in the workbench and describes it on the right. */
  select(path: string): void {
    this.selectedEntryId.set(path);
    this.detailsFt.load(path);
  }

  /** Points the active group at a directory — used by the details actions. */
  openInActiveGroup(path: string, label: string): void {
    this.fileBrowserFt.navigateTo(this.activeGroupId(), path, label);
  }

  /** Asks the component to open the file picker for a group's directory. */
  requestUpload(groupId: string, path?: string): void {
    const directory = path ?? this.editorGroupsFt.pathOf(groupId);
    if (directory === undefined) {
      return;
    }
    this.uploadRequest.set({ groupId, path: directory });
  }

  /** Called by the component once the picker has been opened or dismissed. */
  clearUploadRequest(): void {
    this.uploadRequest.set(null);
  }
}
