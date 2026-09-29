import type { UiMenuItem, UiPanelView } from '@tr-file/ui';
import { isFile, isFolder } from '../../file-system/fs-entry-kind';
import type { PanelSortKey } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

/**
 * What a command acts on. From a menu or the palette it is the active panel —
 * its selection, and the folder it lists; from a context menu, what was
 * right-clicked.
 */
export interface CommandTarget {
  /** The panel it concerns — for a tree row or a menu, the active one. */
  readonly groupId: string;
  /** The entries it acts on; may be none. */
  readonly paths: readonly string[];
  /** Where new entries and pastes go; `null` where there is no folder, as on a file tab. */
  readonly folder: string | null;
  /** A tab, for the commands about tabs. */
  readonly tabId?: string;
}

/** One command of the workbench (PRD 003, §4–5). */
export interface WorkbenchCommand {
  readonly id: string;
  /** Before the label in the palette, as in VS Code: `File: Rename…`. */
  readonly category: string;
  readonly label: (target: CommandTarget) => string;
  /** Whether the palette lists it; context-only commands (tabs, *Open*) do not. */
  readonly palette: boolean;
  readonly enabled: (target: CommandTarget) => boolean;
  /** For a choice among several — a view, a sort — whether it is the one in effect. */
  readonly checked?: (target: CommandTarget) => boolean;
  readonly run: (target: CommandTarget) => void | Promise<void>;
}

type CommandSpec = Omit<WorkbenchCommand, 'label' | 'palette' | 'enabled'> & {
  readonly label: string | ((target: CommandTarget) => string);
  readonly palette?: boolean;
  readonly enabled?: (target: CommandTarget) => boolean;
};

const always = (): boolean => true;

/**
 * The commands that act on files and then leave the keyboard where it was
 * (PRD 001, Fix 5). Opening, revealing, filtering, searching are not among
 * them: they send the keyboard somewhere of their own on purpose.
 */
const FILE_ACTIONS: ReadonlySet<string> = new Set([
  'file.newFile',
  'file.newFolder',
  'file.rename',
  'file.copyTo',
  'file.moveTo',
  'file.trash',
  'file.delete',
  'file.compress',
  'file.extractHere',
  'file.extractTo',
  'file.copyPath',
  'file.emptyTrash',
  'file.download',
  'edit.undo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'selection.byPattern',
  'selection.unselectByPattern',
]);
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The sort orders the View menu offers, by the column each is. */
const SORTS: readonly { readonly key: PanelSortKey; readonly label: string }[] = [
  { key: 'name', label: 'Sort by Name' },
  { key: 'size', label: 'Sort by Size' },
  { key: 'type', label: 'Sort by Type' },
  { key: 'modified', label: 'Sort by Date Modified' },
];

const VIEWS: readonly { readonly view: UiPanelView; readonly label: string }[] = [
  { view: 'list', label: 'List' },
  { view: 'grid', label: 'Icons' },
  { view: 'tree', label: 'Tree' },
];

/**
 * The one table of commands the workbench offers — the decision PRD 003 §4
 * asked for: the main menu, the context menus, the command palette and the
 * key bindings all name commands from here, so each is written once, is
 * enabled by one rule, and runs the same whichever way it was reached.
 *
 * A command is a label, a key to show beside it, when it applies, and what it
 * does, each a function of a `CommandTarget`. The behaviour itself stays in
 * the feature that owns it; this table only says which feature, and for what.
 */
export class CommandsFeature {
  private readonly table: ReadonlyMap<string, WorkbenchCommand>;

  constructor(private readonly parent: WorkbenchService) {
    this.table = new Map(this.define().map((spec) => [spec.id, CommandsFeature.complete(spec)]));
  }

  /** Every command the palette lists, in table order. */
  paletteCommands(): readonly WorkbenchCommand[] {
    return [...this.table.values()].filter((command) => command.palette);
  }

  /** Every command of the table, the palette's and the context menus' alike. */
  allCommands(): readonly WorkbenchCommand[] {
    return [...this.table.values()];
  }

  command(id: string): WorkbenchCommand | undefined {
    return this.table.get(id);
  }

  /** What a menu or the palette acts on: the active panel's selection, in its folder. */
  activeTarget(): CommandTarget {
    const groupId = this.parent.activeGroupId();
    return { groupId, paths: this.parent.operationsFt.selectionIn(groupId), folder: this.folderOf(groupId) };
  }

  /**
   * What a context menu on an entry of a panel acts on: the selection when the
   * entry is part of it, else the entry alone. A folder takes pastes and new
   * entries itself; anything else leaves them to the panel's folder.
   */
  entryTarget(groupId: string, path: string): CommandTarget {
    const paths = this.parent.operationsFt.selectionIn(groupId, path);
    const entry = this.parent.fsDataFt.entryAt(path);
    const folder = paths.length === 1 && entry !== undefined && isFolder(entry) ? path : this.folderOf(groupId);
    return { groupId, paths, folder };
  }

  /** A folder of the explorer tree: it is both what is acted on and where new things go. */
  folderTarget(path: string): CommandTarget {
    return { groupId: this.parent.activeGroupId(), paths: path === '' ? [] : [path], folder: path };
  }

  /** A panel's blank space: nothing selected, its folder. */
  blankTarget(groupId: string): CommandTarget {
    return { groupId, paths: [], folder: this.folderOf(groupId) };
  }

  /** A tab: what it shows, and the folder it lists if it lists one. */
  tabTarget(groupId: string, tabId: string): CommandTarget {
    const tab = this.parent.editorGroupsFt.stateOf(groupId)?.tabs.find((candidate) => candidate.id === tabId);
    return {
      groupId,
      tabId,
      paths: tab === undefined || tab.path === '' ? [] : [tab.path],
      folder: tab?.kind === 'folder' ? tab.path : null,
    };
  }

  isEnabled(id: string, target = this.activeTarget()): boolean {
    return this.table.get(id)?.enabled(target) ?? false;
  }

  /**
   * Runs a command, if it applies to `target`; what it does is the owning
   * feature's. A file action — asked for from a menu, the palette or a key —
   * hands the keyboard back to the panel it acted on once its dialogs are
   * done (PRD 001, Fix 5); a job it starts does the same again when it ends.
   */
  run(id: string, target = this.activeTarget()): void {
    const command = this.table.get(id);
    if (command === undefined || !command.enabled(target)) {
      return;
    }
    const running = Promise.resolve(command.run(target));
    if (FILE_ACTIONS.has(id)) {
      void running.catch(() => undefined).then(() => this.parent.panelFocusFt.returnFocus(target.groupId));
    }
  }

  /** The menu row for a command: its label and key, disabled or checked as it stands for `target`. */
  menuItem(id: string, target = this.activeTarget(), separatorBefore = false): UiMenuItem {
    const command = this.table.get(id);
    if (command === undefined) {
      return { id, label: id, disabled: true };
    }
    const checked = command.checked?.(target);
    // The key shown is the one in force (PRD 010, §2), whatever the user bound.
    const keybinding = this.parent.keybindingsFt.label(id);
    return {
      id,
      label: command.label(target),
      ...(keybinding === undefined ? {} : { keybinding }),
      ...(command.enabled(target) ? {} : { disabled: true }),
      ...(checked === undefined ? {} : { checked }),
      ...(separatorBefore ? { separatorBefore: true } : {}),
    };
  }

  /* -- the table ---------------------------------------------------------- */

  private define(): readonly CommandSpec[] {
    const p = this.parent;
    const one = (target: CommandTarget): boolean => target.paths.length === 1;
    const some = (target: CommandTarget): boolean => target.paths.length > 0;
    const inFolder = (target: CommandTarget): boolean => target.folder !== null;
    const singleFile = (target: CommandTarget): boolean => {
      const entry = one(target) ? p.fsDataFt.entryAt(target.paths[0] as string) : undefined;
      return entry !== undefined && isFile(entry);
    };
    const group = (target: CommandTarget) => p.editorGroupsFt.stateOf(target.groupId);
    const archive = (target: CommandTarget): boolean => singleFile(target) && p.archiveBrowserFt.isArchive(target.paths[0] as string);
    /** The folder a bookmark command is about: the one entry, when it is a folder, else the target's folder. */
    const bookmarkable = (target: CommandTarget): string | null => {
      const entry = one(target) ? p.fsDataFt.entryAt(target.paths[0] as string) : undefined;
      if (entry !== undefined && isFolder(entry)) {
        return entry.path;
      }
      // The root is a place already.
      return target.paths.length === 0 && target.folder !== '' ? target.folder : null;
    };
    const listing = (target: CommandTarget): boolean => target.folder !== null && group(target) !== undefined;
    /* Git (PRD 011, §1): about the repository the Git pane shows, whatever the target. */
    const git = p.gitFt;
    const repo = (): boolean => git.repository() !== null && !git.busy();
    const changes = (area?: string): number => git.repository()?.changes.filter((change) => (area === undefined ? true : area === 'unstaged' ? change.area === 'unstaged' || change.area === 'untracked' : change.area === area)).length ?? 0;
    const tracking = (): boolean => repo() && git.repository()?.upstream !== null;
    const remote = (): boolean => repo() && git.repository()?.hasRemote === true;

    return [
      /* File */
      { id: 'file.newFile', category: 'File', label: 'New File…', enabled: inFolder, run: (t) => p.fileEditFt.createFile(t.folder as string, t.groupId) },
      {
        id: 'file.newFolder',
        category: 'File',
        label: 'New Folder…',
        enabled: inFolder,
        run: (t) => p.fileEditFt.createFolder(t.folder as string, t.groupId),
      },
      { id: 'file.open', category: 'File', label: 'Open', palette: false, enabled: one, run: (t) => p.fileBrowserFt.openPath(t.groupId, t.paths[0] as string) },
      {
        id: 'file.openToSide',
        category: 'File',
        label: 'Open in Other Panel',
        palette: false,
        enabled: one,
        run: (t) => p.fileBrowserFt.openPathAside(t.groupId, t.paths[0] as string),
      },
      {
        id: 'file.openExternal',
        category: 'File',
        label: () => p.systemOpenFt.openLabel(),
        enabled: one,
        run: (t) => p.systemOpenFt.open(t.paths[0] as string),
      },
      {
        id: 'file.reveal',
        category: 'File',
        label: () => p.systemOpenFt.revealLabel(),
        enabled: (t) => p.systemOpenFt.canReveal() && (one(t) || t.folder !== null),
        run: (t) => p.systemOpenFt.reveal(t.paths[0] ?? (t.folder as string)),
      },
      { id: 'file.rename', category: 'File', label: 'Rename…', enabled: one, run: (t) => p.fileEditFt.rename(t.paths[0] as string, t.groupId) },
      { id: 'file.copyTo', category: 'File', label: 'Copy To…', enabled: some, run: (t) => p.operationsFt.transferPaths('copy', t.paths, t.groupId) },
      { id: 'file.moveTo', category: 'File', label: 'Move To…', enabled: some, run: (t) => p.operationsFt.transferPaths('move', t.paths, t.groupId) },
      { id: 'file.trash', category: 'File', label: 'Move to Trash', enabled: some, run: (t) => p.operationsFt.trash(t.paths) },
      {
        id: 'file.delete',
        category: 'File',
        label: 'Delete Permanently…',
        enabled: some,
        run: (t) => p.operationsFt.deletePermanently(t.paths),
      },
      {
        id: 'file.download',
        category: 'File',
        // A folder, or several entries, go as one zip (PRD 003, §6).
        label: (t) => (some(t) && !singleFile(t) ? 'Download as Zip' : 'Download'),
        enabled: some,
        run: (t) =>
          singleFile(t)
            ? p.transfersFt.download(t.paths[0] as string, nameOf(t.paths[0] as string))
            : p.transfersFt.downloadZip(t.paths, CommandsFeature.zipName(t.paths)),
      },
      { id: 'file.upload', category: 'File', label: 'Upload Files…', enabled: inFolder, run: (t) => p.requestUpload(t.groupId, t.folder as string) },
      {
        id: 'file.uploadFolder',
        category: 'File',
        label: 'Upload Folder…',
        enabled: inFolder,
        run: (t) => p.requestUpload(t.groupId, t.folder as string, true),
      },

      /* Archives (PRD 003, §6) */
      { id: 'file.compress', category: 'File', label: 'Compress…', enabled: some, run: (t) => p.operationsFt.compress(t.paths, t.groupId) },
      {
        id: 'file.extractHere',
        category: 'File',
        label: 'Extract Here',
        enabled: archive,
        run: (t) => p.operationsFt.extract(t.paths[0] as string, CommandsFeature.parentOf(t.paths[0] as string)),
      },
      { id: 'file.extractTo', category: 'File', label: 'Extract To…', enabled: archive, run: (t) => p.operationsFt.extract(t.paths[0] as string) },
      {
        id: 'file.browseArchive',
        category: 'File',
        label: 'Browse Archive',
        palette: false,
        enabled: archive,
        run: (t) => p.archiveBrowserFt.open(t.groupId, t.paths[0] as string),
      },
      {
        id: 'file.copyPath',
        category: 'File',
        label: 'Copy Path',
        enabled: (t) => some(t) || t.folder !== null,
        run: (t) => p.systemOpenFt.copyPaths(some(t) ? t.paths : [t.folder as string]),
      },
      { id: 'file.emptyTrash', category: 'File', label: 'Empty Trash…', run: () => p.operationsFt.emptyTrash() },
      // Midnight Commander's `F10` (PRD 004, §2): only a window of the desktop app can be quit.
      { id: 'file.quit', category: 'File', label: 'Quit', enabled: () => p.desktopWindow.isAvailable, run: () => this.quit() },

      /* Edit */
      { id: 'edit.undo', category: 'Edit', label: () => p.undoFt.label(), enabled: () => p.undoFt.canUndo(), run: () => p.undoFt.undo() },
      { id: 'edit.cut', category: 'Edit', label: 'Cut', enabled: some, run: (t) => p.fileClipboardFt.putPaths('cut', t.paths) },
      { id: 'edit.copy', category: 'Edit', label: 'Copy', enabled: some, run: (t) => p.fileClipboardFt.putPaths('copy', t.paths) },
      {
        id: 'edit.paste',
        category: 'Edit',
        label: 'Paste',
        enabled: (t) => p.fileClipboardFt.canPaste() && t.folder !== null,
        run: (t) => p.fileClipboardFt.pasteInto(t.folder as string),
      },
      { id: 'edit.filter', category: 'Edit', label: 'Filter Folder', enabled: listing, run: (t) => p.fileBrowserFt.focusFilter(t.groupId) },
      { id: 'edit.search', category: 'Edit', label: 'Search Files…', run: () => p.searchFt.show() },

      /* Selection */
      { id: 'selection.all', category: 'Selection', label: 'Select All', enabled: listing, run: (t) => p.fileBrowserFt.selectAll(t.groupId) },
      { id: 'selection.none', category: 'Selection', label: 'Select None', enabled: some, run: (t) => p.fileBrowserFt.selectNone(t.groupId) },
      { id: 'selection.invert', category: 'Selection', label: 'Invert Selection', enabled: listing, run: (t) => p.fileBrowserFt.invertSelection(t.groupId) },
      /* Midnight Commander's `+` and `-` (PRD 004, §2) */
      {
        id: 'selection.byPattern',
        category: 'Selection',
        label: 'Select by Pattern…',
        enabled: listing,
        run: (t) => p.fileBrowserFt.selectByPattern(t.groupId, true),
      },
      {
        id: 'selection.unselectByPattern',
        category: 'Selection',
        label: 'Unselect by Pattern…',
        enabled: listing,
        run: (t) => p.fileBrowserFt.selectByPattern(t.groupId, false),
      },

      /* View */
      ...VIEWS.map(
        ({ view, label }): CommandSpec => ({
          id: `view.${view}`,
          category: 'View',
          label,
          enabled: listing,
          checked: (t) => group(t) !== undefined && p.fileBrowserFt.viewOf(t.groupId) === view,
          run: (t) => p.fileBrowserFt.setView(t.groupId, view),
        }),
      ),
      ...SORTS.map(
        ({ key, label }): CommandSpec => ({
          id: `view.sort.${key}`,
          category: 'View',
          label,
          enabled: listing,
          checked: (t) => p.fileBrowserFt.sortOf(t.groupId).key === key,
          run: (t) => p.fileBrowserFt.setSort(t.groupId, { key, direction: p.fileBrowserFt.sortOf(t.groupId).direction }),
        }),
      ),
      {
        id: 'view.sortDescending',
        category: 'View',
        label: 'Descending',
        enabled: listing,
        checked: (t) => p.fileBrowserFt.sortOf(t.groupId).direction === 'desc',
        run: (t) => {
          const sort = p.fileBrowserFt.sortOf(t.groupId);
          p.fileBrowserFt.setSort(t.groupId, { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
        },
      },
      {
        id: 'view.hidden',
        category: 'View',
        label: 'Show Hidden Files',
        checked: () => p.showHidden(),
        run: () => p.showHidden.update((shown) => !shown),
      },
      { id: 'view.refresh', category: 'View', label: 'Refresh', enabled: (t) => group(t) !== undefined, run: (t) => p.fileBrowserFt.runToolbarAction(t.groupId, 'refresh') },

      /* Places (PRD 003, §6) */
      {
        id: 'places.open',
        category: 'Places',
        label: 'Open',
        palette: false,
        enabled: (t) => t.folder !== null,
        run: (t) => p.placesFt.open(`place:${t.folder as string}`),
      },
      {
        id: 'places.openToSide',
        category: 'Places',
        label: 'Open in Other Panel',
        palette: false,
        enabled: (t) => t.folder !== null,
        run: (t) => p.placesFt.openAside(t.folder as string),
      },
      {
        id: 'places.addBookmark',
        category: 'Places',
        label: 'Add to Bookmarks',
        enabled: (t) => bookmarkable(t) !== null && !p.placesFt.isBookmarked(bookmarkable(t) as string),
        run: (t) => p.placesFt.addBookmark(bookmarkable(t) as string),
      },
      {
        id: 'places.removeBookmark',
        category: 'Places',
        label: 'Remove from Bookmarks',
        enabled: (t) => bookmarkable(t) !== null && p.placesFt.isBookmarked(bookmarkable(t) as string),
        run: (t) => p.placesFt.removeBookmark(bookmarkable(t) as string),
      },
      {
        id: 'places.renameBookmark',
        category: 'Places',
        label: 'Rename Bookmark…',
        palette: false,
        enabled: (t) => t.folder !== null && p.placesFt.isBookmarked(t.folder),
        run: (t) => p.placesFt.promptRenameBookmark(t.folder as string),
      },
      {
        id: 'places.moveBookmarkUp',
        category: 'Places',
        label: 'Move Up',
        palette: false,
        enabled: (t) => t.folder !== null && p.placesFt.canMoveBookmark(t.folder, -1),
        run: (t) => p.placesFt.moveBookmark(t.folder as string, -1),
      },
      {
        id: 'places.moveBookmarkDown',
        category: 'Places',
        label: 'Move Down',
        palette: false,
        enabled: (t) => t.folder !== null && p.placesFt.canMoveBookmark(t.folder, 1),
        run: (t) => p.placesFt.moveBookmark(t.folder as string, 1),
      },
      {
        id: 'places.removeRecent',
        category: 'Places',
        label: 'Remove from Recent',
        palette: false,
        enabled: (t) => t.folder !== null && p.placesFt.recent().includes(t.folder),
        run: (t) => p.placesFt.removeRecent(t.folder as string),
      },
      {
        id: 'places.clearRecent',
        category: 'Places',
        label: 'Clear Recent Folders',
        enabled: () => p.placesFt.recent().length > 0,
        run: () => p.placesFt.clearRecent(),
      },
      { id: 'places.show', category: 'View', label: 'Show Bookmarks', run: () => p.chromeFt.showBookmarks() },
      /* The bottom panel's Notes (PRD 001, §12.2) */
      { id: 'view.notes', category: 'View', label: 'Show Notes', run: () => p.bottomPanelFt.showNotes() },
      /* PRD 001, §12.3 */
      { id: 'view.togglePanel', category: 'View', label: 'Toggle Panel', run: () => p.bottomPanelFt.toggleCollapsed() },

      /* Session (PRD 003, §6) */
      {
        id: 'settings.restoreSession',
        category: 'Preferences',
        label: 'Restore Layout on Start',
        // Through the settings (PRD 010, §1), so the window shows the switch as it stands.
        checked: () => p.preferencesFt.value('window.restoreLayout'),
        run: () => p.preferencesFt.set('window.restoreLayout', !p.preferencesFt.value('window.restoreLayout')),
      },
      { id: 'view.resetLayout', category: 'View', label: 'Reset Layout', run: () => void p.sessionFt.confirmResetLayout() },

      /* The settings window (PRD 010) */
      { id: 'workbench.openSettings', category: 'Preferences', label: 'Open Settings', run: () => p.settingsEditorFt.open('general') },
      {
        id: 'workbench.openKeybindings',
        category: 'Preferences',
        label: 'Open Keyboard Shortcuts',
        run: () => p.settingsEditorFt.open('keyboard-shortcuts'),
      },

      /* The window, for the function keys (PRD 004, §2): `F1` and `F9` */
      { id: 'view.commandPalette', category: 'View', label: 'Show All Commands', palette: false, run: () => p.commandPaletteFt.show() },
      { id: 'view.mainMenu', category: 'View', label: 'Open the Main Menu', palette: false, run: () => p.chromeFt.openMainMenu() },

      /* Go */
      { id: 'go.back', category: 'Go', label: 'Back', enabled: (t) => p.panelHistoryFt.canGoBack(t.groupId), run: (t) => this.walk(t.groupId, () => p.panelHistoryFt.back(t.groupId)) },
      {
        id: 'go.forward',
        category: 'Go',
        label: 'Forward',
        enabled: (t) => p.panelHistoryFt.canGoForward(t.groupId),
        run: (t) => this.walk(t.groupId, () => p.panelHistoryFt.forward(t.groupId)),
      },
      {
        id: 'go.up',
        category: 'Go',
        label: 'Up One Level',
        enabled: (t) => (group(t)?.path ?? '') !== '',
        run: (t) => this.walk(t.groupId, () => p.fileBrowserFt.navigateUp(t.groupId)),
      },
      { id: 'go.location', category: 'Go', label: 'Go to Location…', enabled: (t) => group(t) !== undefined, run: (t) => p.fileBrowserFt.editLocation(t.groupId) },

      /* Git (PRD 011, §1) */
      {
        id: 'git.commit',
        category: 'Git',
        label: 'Commit',
        enabled: repo,
        run: () => (git.canCommit() ? void git.commit() : git.focusMessage()),
      },
      { id: 'git.commitAmend', category: 'Git', label: 'Commit (Amend)', enabled: () => repo() && git.repository()?.head !== null, run: () => void git.commit(true) },
      { id: 'git.stageAll', category: 'Git', label: 'Stage All Changes', enabled: () => repo() && changes('unstaged') + changes('conflict') > 0, run: () => void git.stageAll() },
      { id: 'git.unstageAll', category: 'Git', label: 'Unstage All Changes', enabled: () => repo() && changes('staged') > 0, run: () => void git.unstageAll() },
      { id: 'git.discardAll', category: 'Git', label: 'Discard All Changes…', enabled: () => repo() && changes('unstaged') > 0, run: () => void git.discardAll() },
      { id: 'git.sync', category: 'Git', label: 'Sync', enabled: tracking, run: () => void git.sync() },
      { id: 'git.pull', category: 'Git', label: 'Pull', enabled: tracking, run: () => void git.pull() },
      {
        id: 'git.push',
        category: 'Git',
        label: () => (git.repository()?.upstream === null ? 'Publish Branch' : 'Push'),
        enabled: () => remote() && git.repository()?.branch !== null,
        run: () => void git.push(),
      },
      { id: 'git.fetch', category: 'Git', label: 'Fetch', enabled: remote, run: () => void git.fetch() },
      { id: 'git.checkout', category: 'Git', label: 'Checkout to…', enabled: repo, run: () => void git.pickBranch() },
      { id: 'git.createBranch', category: 'Git', label: 'Create Branch…', enabled: repo, run: () => void git.createBranch() },
      { id: 'git.deleteBranch', category: 'Git', label: 'Delete Branch…', enabled: repo, run: () => void git.deleteBranch() },
      { id: 'git.stash', category: 'Git', label: 'Stash…', enabled: () => repo() && changes() > 0, run: () => void git.stash() },
      { id: 'git.stashPop', category: 'Git', label: 'Pop Latest Stash', enabled: () => repo() && (git.repository()?.stashes ?? 0) > 0, run: () => void git.popStash() },
      { id: 'git.init', category: 'Git', label: 'Initialize Repository', enabled: () => git.canInit(), run: () => void git.init() },
      { id: 'git.refresh', category: 'Git', label: 'Refresh', enabled: () => git.available() && !git.busy(), run: () => void git.refresh() },

      /* Tabs */
      { id: 'tab.new', category: 'Tab', label: 'New Tab', run: (t) => p.editorGroupsFt.newTab(t.groupId) },
      {
        id: 'view.toggleMaximize',
        category: 'View',
        label: 'Toggle Maximized Panel',
        checked: (t) => p.panelLayoutFt.isMaximized(t.groupId),
        run: (t) => p.editorGroupsFt.runAction(t.groupId, 'maximize'),
      },
      /* … the rest from a tab's context menu only */
      { id: 'tab.close', category: 'Tab', label: 'Close', palette: false, enabled: (t) => t.tabId !== undefined, run: (t) => p.editorGroupsFt.closeTab(t.groupId, t.tabId as string) },
      {
        id: 'tab.closeOthers',
        category: 'Tab',
        label: 'Close Others',
        palette: false,
        enabled: (t) => t.tabId !== undefined && (group(t)?.tabs.length ?? 0) > 1,
        run: (t) => this.closeTabs(t, (index, at) => index !== at),
      },
      {
        id: 'tab.closeRight',
        category: 'Tab',
        label: 'Close to the Right',
        palette: false,
        enabled: (t) => {
          const tabs = group(t)?.tabs ?? [];
          const at = tabs.findIndex((tab) => tab.id === t.tabId);
          return at !== -1 && at < tabs.length - 1;
        },
        run: (t) => this.closeTabs(t, (index, at) => index > at),
      },
    ];
  }

  /** The folder a panel lists, or `null` when it shows a file. */
  private folderOf(groupId: string): string | null {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    return group !== undefined && groups.activeTabOf(group)?.kind === 'folder' ? group.path : null;
  }

  /** A move along a panel's trail from a menu keeps the keyboard in the panel, as the keys do. */
  private walk(groupId: string, move: () => void): void {
    move();
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** `F10`: the window closes, once the user has said so — as Midnight Commander asks before it quits. */
  private async quit(): Promise<void> {
    const sure = await this.parent.modal.confirm({ message: 'Quit tr-file?', confirmLabel: 'Quit' });
    if (sure) {
      this.parent.desktopWindow.close();
    }
  }

  /** Closes the tabs of `target`'s group that `close` picks, by index against the target tab's. */
  private closeTabs(target: CommandTarget, close: (index: number, at: number) => boolean): void {
    const tabs = this.parent.editorGroupsFt.stateOf(target.groupId)?.tabs ?? [];
    const at = tabs.findIndex((tab) => tab.id === target.tabId);
    for (const tab of tabs.filter((_tab, index) => close(index, at))) {
      this.parent.editorGroupsFt.closeTab(target.groupId, tab.id);
    }
  }

  /** A zip of one entry is named after it; of several, after the folder they are in. */
  private static zipName(paths: readonly string[]): string {
    const base = paths.length === 1 ? nameOf(paths[0] as string) : nameOf(CommandsFeature.parentOf(paths[0] as string)) || 'Archive';
    return `${base}.zip`;
  }

  private static parentOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  }

  private static complete(spec: CommandSpec): WorkbenchCommand {
    const { label } = spec;
    return {
      ...spec,
      label: typeof label === 'string' ? () => label : label,
      palette: spec.palette ?? true,
      enabled: spec.enabled ?? always,
    };
  }
}
