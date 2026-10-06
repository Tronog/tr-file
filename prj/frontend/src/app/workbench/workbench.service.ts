import { computed, inject, Service, signal } from '@angular/core';
import { DesktopWindowService } from '../desktop/desktop-window.service';
import { DesktopUpdateService } from '../desktop/desktop-update.service';
import { FileSystemService } from '../file-system/file-system.service';
import { ImageSourceService } from '../file-system/image-source.service';
import { BottomPanelFeature } from './features/bottom-panel.feature';
import { NotesFeature } from './features/notes.feature';
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
import { PreviewRetentionFeature } from './features/preview-retention.feature';
import { SidebarPanesFeature } from './features/sidebar-panes.feature';
import { ListingOrderFeature } from './listing/listing-order.feature';
import { TransfersFeature } from './features/transfers.feature';
import { WindowControlsFeature } from './features/window-controls.feature';
import { AppUpdateFeature } from './features/app-update.feature';
import { HelpFeature } from './features/help.feature';
import { DiskUsageFeature } from './features/disk-usage.feature';
import { SubAppsFeature } from './features/sub-apps.feature';
import { WorkbenchResizeFeature } from './features/workbench-resize.feature';
import { OperationsFeature } from './features/operations.feature';
import { FocusCycleFeature } from './features/focus-cycle.feature';
import { FileClipboardFeature } from './features/file-clipboard.feature';
import { MockDataWorkbenchService } from './mock-data/mock-data-workbench.service';
import { AuthService } from '../auth/auth.service';
import { CommandPaletteFeature } from './features/command-palette.feature';
import { SavedServersFeature } from './features/saved-servers.feature';
import { RemoteConnectionService } from '../file-system/remote-connection.service';
import { AutoRefreshFeature } from './features/auto-refresh.feature';
import { CommandsFeature } from './features/commands.feature';
import { FunctionKeysFeature } from './features/function-keys.feature';
import { KeybindingsFeature } from './features/keybindings.feature';
import { PreferencesFeature } from './features/preferences.feature';
import { SettingsEditorFeature } from './features/settings-editor.feature';
import { TrashFeature } from './features/trash.feature';
import { ServerClockFeature } from './features/server-clock.feature';
import { ContextMenuFeature } from './features/context-menu.feature';
import { FileEditFeature } from './features/file-edit.feature';
import { SearchFeature } from './features/search.feature';
import { SystemOpenFeature } from './features/system-open.feature';
import { UndoFeature } from './features/undo.feature';
import { SettingsService } from '../settings/settings.service';
import { PlacesFeature } from './features/places.feature';
import { SessionFeature, type SessionSnapshot } from './features/session.feature';
import { ArchiveBrowserFeature } from './features/archive-browser.feature';
import { ThumbnailsFeature } from './features/thumbnails.feature';
import { GitFeature } from './features/git.feature';
import { FolderViewsFeature } from './features/folder-views.feature';
import { GitDiffFeature } from './features/git-diff.feature';
import type { MockWorkbenchLayout } from './mock-data/mock-data.model';
import { UiModalService, UiPanelLayout } from '@tr-file/ui';

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

  /** The desktop's self-update: whether the share holds a newer version (PRD 001, §8.6). */
  readonly desktopUpdate = inject(DesktopUpdateService);

  /**
   * Pictures the browser can draw, cached by path — read by the panel's viewer
   * and by the details sidebar, so the same image is fetched once.
   */
  readonly images = inject(ImageSourceService);

  /** Who is signed in, if anyone has to be (PRD 003, §2). */
  readonly auth = inject(AuthService);

  /** Modal windows — questions the workbench has to ask (PRD 002, §3). */
  readonly modal = inject(UiModalService);

  /**
   * Seed for the parts of the workbench no backend owns yet — the menus, the
   * activity bar and the layout the session starts with.
   */
  readonly mockWorkbench = inject(MockDataWorkbenchService);

  /** What is remembered between sessions — `localStorage`, or the desktop's settings file (PRD 003, §6). */
  readonly settings = inject(SettingsService);

  /** Where the backend is: this computer's, or a remote server (PRD 006, §1). */
  readonly connection = inject(RemoteConnectionService);

  /**
   * The last session on this backend, when there is one to restore
   * (PRD 003, §6) — read before any feature is made, so each starts from it.
   */
  readonly restored: SessionSnapshot | null = SessionFeature.restore(this.settings, this.connection.label() ?? 'local');

  /** The layout the workbench starts from: the restored session's, or the default one. */
  readonly layout: MockWorkbenchLayout = this.restored ?? this.mockWorkbench.layout;

  /* -- common state ------------------------------------------------------ */

  /** The entry the details sidebar describes, wherever it was selected. */
  readonly selectedEntryId = signal(this.layout.selectedEntryId);

  /** The focused panel group: only its tabs and selection render as active. */
  readonly activeGroupId = signal(this.layout.activeGroupId);

  /**
   * The panel group that was active before the active one (PRD 002, §2.7) —
   * one level deep, `null` until there has been another. With three or more
   * panels on screen it is what makes a file action's *destination*: the
   * source is the panel the user is in, the destination the one they were in
   * before. Kept by `EditorGroupsFeature`, the one place the active group changes.
   */
  readonly previousGroupId = signal<string | null>(null);

  /** Dot-files are hidden until the status bar says otherwise. */
  readonly showHidden = signal(this.restored?.showHidden ?? false);

  /**
   * Which backend the workbench is talking to (PRD 008, §1.2–1.3): this
   * computer's — the desktop's own, or the server that served the page — or a
   * remote server (PRD 006).
   */
  readonly backend = computed<'local' | 'remote'>(() => (this.connection.connected() ? 'remote' : 'local'));

  readonly leftSidebarWidth = signal(this.layout.leftSidebarWidth);
  readonly rightSidebarWidth = signal(this.layout.rightSidebarWidth);
  readonly bottomPanelHeight = signal(this.layout.bottomPanelHeight);

  /**
   * Set when a group asks for the file picker; the component watches this and
   * opens its hidden `<input type="file">`. A signal rather than a method call
   * because only the component can legally touch that element.
   */
  readonly uploadRequest = signal<{ readonly groupId: string; readonly path: string; readonly folder?: boolean } | null>(null);

  /* -- features ---------------------------------------------------------- */

  /** Which sub-application fills the window (PRD 001, §1.1); read by nearly everything below. */
  readonly subAppsFt = new SubAppsFeature(this);

  /** Shared formatting; constructed first because other features use it. */
  readonly fileViewModel = new FileViewModelFeature();

  /** The cache every view reads from; constructed before its readers. */
  readonly fsDataFt = new FsDataFeature(this);

  /** Each folder's view and order, kept in the client's storage (PRD 004, §1.3.1); read by the panels. */
  readonly folderViewsFt = new FolderViewsFeature(this);

  /** Places, bookmarks and recent folders (PRD 003, §6); names the root for everything else. */
  readonly placesFt = new PlacesFeature(this);
  /** Pictures of images for the icon view (PRD 003, §6). */
  readonly thumbnailsFt = new ThumbnailsFeature(this);

  readonly transfersFt = new TransfersFeature(this);
  /** Copy, move, trash and empty trash, followed to the end (PRD 005, §1). */
  readonly operationsFt = new OperationsFeature(this);
  /** Copy, cut and paste of entries, within a panel or across panels (PRD 005, §2). */
  readonly fileClipboardFt = new FileClipboardFeature(this);
  /** Read-only file previews; read by the groups that show them. */
  readonly filePreviewFt = new FilePreviewFeature(this);
  readonly chromeFt = new ChromeFeature(this);
  /** Owns the split tree; constructed before the feature that mutates it. */
  readonly panelLayoutFt = new UiPanelLayout(this.layout.grid);
  readonly explorerFt = new ExplorerFeature(this);
  readonly editorGroupsFt = new EditorGroupsFeature(this);
  /** File management: what folder and file tabs show, and navigating in them. */
  readonly fileBrowserFt = new FileBrowserFeature(this);
  readonly listingOrderFt = new ListingOrderFeature(this);
  /** Inside a zip, as a panel tab of its own (PRD 003, §6). */
  readonly archiveBrowserFt = new ArchiveBrowserFeature(this);
  /** The trash, as a Places row and a panel tab of its own (PRD 001, §14.1). */
  readonly trashFt = new TrashFeature(this);
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
  /** The bottom panel's Notes, kept in the app's settings (PRD 001, §12.2). */
  readonly notesFt = new NotesFeature(this.settings);
  readonly sidebarPanesFt = new SidebarPanesFeature(this);
  readonly resizeFt = new WorkbenchResizeFeature(this);
  /** The frameless window's own buttons and drag region. */
  readonly windowControlsFt = new WindowControlsFeature(this);
  /** The title bar's blue *Upgrade* button (PRD 001, §8.6). */
  readonly appUpdateFt = new AppUpdateFeature(this);
  /** Remote servers kept on this machine, for *Connect to Remote Server* (PRD 009, §1). */
  readonly savedServersFt = new SavedServersFeature(undefined, this.settings);
  /** The command palette: `Ctrl`+`Shift`+`P` (PRD 009, §1). */
  readonly commandPaletteFt = new CommandPaletteFeature(this);
  /** `Ctrl`+`Tab` between the explorer, the panels, the bottom panel and the details (PRD 002, §2.6). */
  readonly focusCycleFt = new FocusCycleFeature(this);
  /** Rename, new folder, new file (PRD 003, §5). */
  readonly fileEditFt = new FileEditFeature(this);
  /** `Ctrl`+`Z`: the last change to the file system, taken back (PRD 003, §5). */
  readonly undoFt = new UndoFeature(this);
  /** Open with the system's application; reveal in its file manager (PRD 003, §5). */
  readonly systemOpenFt = new SystemOpenFeature(this);
  /** The Git pane: the repository the active panel's folder is in (PRD 011, §1); made before the command table, which names its commands. */
  readonly gitFt = new GitFeature(this);
  /** A file's git changes, as a panel tab of their own (PRD 011, §1). */
  readonly gitDiffFt = new GitDiffFeature(this);
  /** The one table of commands the menus, context menus, palette and keys share (PRD 003, §4–5). */
  readonly commandsFt = new CommandsFeature(this);
  /** Midnight Commander's `F1`–`F10`, and the status bar's strip of them (PRD 004, §2). */
  readonly functionKeysFt = new FunctionKeysFeature(this);
  /** Right-click menus on entries, blank space, the tree and tabs (PRD 003, §5). */
  readonly contextMenuFt = new ContextMenuFeature(this);
  /** The Search view: files and folders by name, anywhere under a folder (PRD 003, §5). */
  readonly searchFt = new SearchFeature(this);
  /** Listings that follow the disk without a Refresh (PRD 003, §5). */
  readonly autoRefreshFt = new AutoRefreshFeature(this);
  /** The layout, remembered for the next session (PRD 003, §6); made last, since it reads them all. */
  readonly sessionFt = new SessionFeature(this);
  /** The settings of the settings window (PRD 010, §1); after the session, whose switch it shows. */
  readonly preferencesFt = new PreferencesFeature(this);
  /** Every key, as the user may have changed it (PRD 010, §2). */
  readonly keybindingsFt = new KeybindingsFeature(this);
  /** The settings window itself (PRD 010). */
  readonly settingsEditorFt = new SettingsEditorFeature(this);
  /** The Help window: `F1`, the cheatsheet of every key (PRD 001, §16). */
  readonly helpFt = new HelpFeature(this);
  /** The backend machine's date and time, at the right of the status bar (PRD 001, §13.1). */
  readonly serverClockFt = new ServerClockFeature(this);
  /** What takes up a folder's space, opened from its Size in Details (PRD 001, §9.3.2). */
  readonly diskUsageFt = new DiskUsageFeature(this);

  /** What the root is called: the backend's name for it (PRD 003, §6). */
  readonly workspaceName = computed(() => this.placesFt.rootLabel());

  /* -- cross-feature operations ------------------------------------------ */

  /**
   * Loads what the workbench starts with. Called once by the component rather
   * than from the constructor, so creating the service in a test fetches
   * nothing on its own.
   */
  start(): void {
    this.windowControlsFt.start();
    if (this.restored !== null) {
      this.bottomPanelFt.restore(this.restored.bottomPanel.collapsed);
      this.sidebarPanesFt.restore(this.restored.panes);
      this.sidebarPanesFt.restoreOrders(this.restored.paneOrder);
      this.sidebarPanesFt.restoreSizes(this.restored.paneSizes);
      this.sidebarPanesFt.restoreHidden(this.restored.hiddenPanes);
      this.chromeFt.restoreSidebars(this.restored.hiddenSidebars);
    }
    // A fresh start on the desktop begins in the home folder (PRD 003, §6),
    // which only the backend knows: the panels wait for it. A browser's
    // server names its root and nothing else, and a restored session knows
    // where it was — neither needs to ask before starting.
    if (this.restored === null && this.fileSystem.transport.systemShell) {
      void this.placesFt.load().then((places) => this.startAt(places?.home ?? ''));
      return;
    }
    if (this.fileSystem.transport.systemShell || this.sidebarPanesFt.isExpanded('places')) {
      void this.placesFt.load();
    }
    this.startAt(null);
  }

  /**
   * Starts the panels, the tree and the rest — with a fresh session's one
   * panel moved to `home` first, when there is one.
   */
  private startAt(home: string | null): void {
    if (home !== null && home !== '') {
      const label = home.split('/').at(-1) ?? home;
      for (const group of this.editorGroupsFt.states()) {
        this.editorGroupsFt.update(group.id, (state) => ({
          ...state,
          path: home,
          tabs: state.tabs.map((tab) => (tab.active || state.tabs.length === 1 ? { ...tab, path: home, label } : tab)),
        }));
      }
    }
    this.explorerFt.start();
    this.editorGroupsFt.start();
    // The tree shows where the active panel is — home on a fresh start, the
    // folder it was on in a restored one.
    const shown = this.editorGroupsFt.pathOf(this.activeGroupId());
    if (shown !== undefined && shown !== '' && (home !== null || this.restored !== null)) {
      this.explorerFt.reveal(shown);
    }
    this.detailsFt.load(this.selectedEntryId());

    // The folder listing is where someone starts (PRD 001, §10.1), so the
    // keyboard starts there too — otherwise the first arrow key after launch
    // goes nowhere and the app has to be clicked before it can be used.
    // Asked for after the listing has been requested, so the group is already
    // `loading`: the request then waits for the first row rather than settling
    // on an empty body.
    this.panelFocusFt.focusBody(this.activeGroupId());
    if (this.preferencesFt.autoRefresh()) {
      this.autoRefreshFt.start();
    }
    this.sessionFt.start();
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

  /**
   * Asks the component to open the file picker for a group's directory — or,
   * with `folder`, the folder picker (PRD 003, §6).
   */
  requestUpload(groupId: string, path?: string, folder = false): void {
    const directory = path ?? this.editorGroupsFt.pathOf(groupId);
    if (directory === undefined) {
      return;
    }
    this.uploadRequest.set({ groupId, path: directory, ...(folder ? { folder: true } : {}) });
  }

  /** Called by the component once the picker has been opened or dismissed. */
  clearUploadRequest(): void {
    this.uploadRequest.set(null);
  }
}
