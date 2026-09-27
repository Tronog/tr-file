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
  /** Shown beside it in menus and the palette; the binding itself lives with the key's owner. */
  readonly keybinding?: string;
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

  /** Runs a command, if it applies to `target`; what it does is the owning feature's. */
  run(id: string, target = this.activeTarget()): void {
    const command = this.table.get(id);
    if (command !== undefined && command.enabled(target)) {
      void command.run(target);
    }
  }

  /** The menu row for a command: its label and key, disabled or checked as it stands for `target`. */
  menuItem(id: string, target = this.activeTarget(), separatorBefore = false): UiMenuItem {
    const command = this.table.get(id);
    if (command === undefined) {
      return { id, label: id, disabled: true };
    }
    const checked = command.checked?.(target);
    return {
      id,
      label: command.label(target),
      ...(command.keybinding ? { keybinding: command.keybinding } : {}),
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

    return [
      /* File */
      { id: 'file.newFile', category: 'File', label: 'New File…', enabled: inFolder, run: (t) => p.fileEditFt.createFile(t.folder as string, t.groupId) },
      {
        id: 'file.newFolder',
        category: 'File',
        label: 'New Folder…',
        keybinding: 'Ctrl+Shift+N',
        enabled: inFolder,
        run: (t) => p.fileEditFt.createFolder(t.folder as string, t.groupId),
      },
      { id: 'file.open', category: 'File', label: 'Open', keybinding: 'Enter', palette: false, enabled: one, run: (t) => p.fileBrowserFt.openPath(t.groupId, t.paths[0] as string) },
      {
        id: 'file.openToSide',
        category: 'File',
        label: 'Open to the Side',
        keybinding: 'Ctrl+Enter',
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
      { id: 'file.rename', category: 'File', label: 'Rename…', keybinding: 'F2', enabled: one, run: (t) => p.fileEditFt.rename(t.paths[0] as string, t.groupId) },
      { id: 'file.copyTo', category: 'File', label: 'Copy To…', enabled: some, run: (t) => p.operationsFt.transferPaths('copy', t.paths, t.groupId) },
      { id: 'file.moveTo', category: 'File', label: 'Move To…', enabled: some, run: (t) => p.operationsFt.transferPaths('move', t.paths, t.groupId) },
      { id: 'file.trash', category: 'File', label: 'Move to Trash', keybinding: 'Delete', enabled: some, run: (t) => p.operationsFt.trash(t.paths) },
      {
        id: 'file.delete',
        category: 'File',
        label: 'Delete Permanently…',
        keybinding: 'Shift+Delete',
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
        run: (t) => void globalThis.navigator?.clipboard?.writeText((some(t) ? t.paths : [t.folder as string]).map((path) => `/${path}`).join('\n')),
      },
      { id: 'file.emptyTrash', category: 'File', label: 'Empty Trash…', run: () => p.operationsFt.emptyTrash() },

      /* Edit */
      { id: 'edit.undo', category: 'Edit', label: () => p.undoFt.label(), keybinding: 'Ctrl+Z', enabled: () => p.undoFt.canUndo(), run: () => p.undoFt.undo() },
      { id: 'edit.cut', category: 'Edit', label: 'Cut', keybinding: 'Ctrl+X', enabled: some, run: (t) => p.fileClipboardFt.putPaths('cut', t.paths) },
      { id: 'edit.copy', category: 'Edit', label: 'Copy', keybinding: 'Ctrl+C', enabled: some, run: (t) => p.fileClipboardFt.putPaths('copy', t.paths) },
      {
        id: 'edit.paste',
        category: 'Edit',
        label: 'Paste',
        keybinding: 'Ctrl+V',
        enabled: (t) => p.fileClipboardFt.canPaste() && t.folder !== null,
        run: (t) => p.fileClipboardFt.pasteInto(t.folder as string),
      },
      { id: 'edit.filter', category: 'Edit', label: 'Filter Folder', keybinding: 'Ctrl+F', enabled: listing, run: (t) => p.fileBrowserFt.focusFilter(t.groupId) },
      { id: 'edit.search', category: 'Edit', label: 'Search Files…', keybinding: 'Ctrl+Shift+F', run: () => p.searchFt.show() },

      /* Selection */
      { id: 'selection.all', category: 'Selection', label: 'Select All', keybinding: 'Ctrl+A', enabled: listing, run: (t) => p.fileBrowserFt.selectAll(t.groupId) },
      { id: 'selection.none', category: 'Selection', label: 'Select None', enabled: some, run: (t) => p.fileBrowserFt.selectNone(t.groupId) },
      { id: 'selection.invert', category: 'Selection', label: 'Invert Selection', enabled: listing, run: (t) => p.fileBrowserFt.invertSelection(t.groupId) },

      /* View */
      ...VIEWS.map(
        ({ view, label }): CommandSpec => ({
          id: `view.${view}`,
          category: 'View',
          label,
          enabled: listing,
          checked: (t) => group(t)?.view === view,
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
        keybinding: 'Ctrl+H',
        checked: () => p.showHidden(),
        run: () => p.showHidden.update((shown) => !shown),
      },
      { id: 'view.refresh', category: 'View', label: 'Refresh', keybinding: 'F5', enabled: (t) => group(t) !== undefined, run: (t) => p.fileBrowserFt.runToolbarAction(t.groupId, 'refresh') },

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
        label: 'Open to the Side',
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

      /* Session (PRD 003, §6) */
      {
        id: 'settings.restoreSession',
        category: 'Preferences',
        label: 'Restore Layout on Start',
        checked: () => p.sessionFt.restoresSessions,
        run: () => p.sessionFt.setRestoresSessions(!p.sessionFt.restoresSessions),
      },
      { id: 'view.resetLayout', category: 'View', label: 'Reset Layout', run: () => p.sessionFt.resetLayout() },

      /* Go */
      { id: 'go.back', category: 'Go', label: 'Back', keybinding: 'Alt+Left', enabled: (t) => p.panelHistoryFt.canGoBack(t.groupId), run: (t) => this.walk(t.groupId, () => p.panelHistoryFt.back(t.groupId)) },
      {
        id: 'go.forward',
        category: 'Go',
        label: 'Forward',
        keybinding: 'Alt+Right',
        enabled: (t) => p.panelHistoryFt.canGoForward(t.groupId),
        run: (t) => this.walk(t.groupId, () => p.panelHistoryFt.forward(t.groupId)),
      },
      {
        id: 'go.up',
        category: 'Go',
        label: 'Up One Level',
        keybinding: 'Alt+Up',
        enabled: (t) => (group(t)?.path ?? '') !== '',
        run: (t) => this.walk(t.groupId, () => p.fileBrowserFt.navigateUp(t.groupId)),
      },
      { id: 'go.location', category: 'Go', label: 'Go to Location…', keybinding: 'Ctrl+L', enabled: (t) => group(t) !== undefined, run: (t) => p.fileBrowserFt.editLocation(t.groupId) },

      /* Tabs — from a tab's context menu only */
      { id: 'tab.close', category: 'Tab', label: 'Close', keybinding: 'Ctrl+W', palette: false, enabled: (t) => t.tabId !== undefined, run: (t) => p.editorGroupsFt.closeTab(t.groupId, t.tabId as string) },
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
