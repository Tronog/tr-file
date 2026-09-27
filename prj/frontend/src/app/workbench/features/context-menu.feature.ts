import { computed, signal } from '@angular/core';
import type { UiContextMenuRequest, UiMenuItem } from '@tr-file/ui';
import { isFolder } from '../../file-system/fs-entry-kind';
import type { CommandTarget } from './commands.feature';
import type { PlaceSection } from './places.feature';
import type { WorkbenchService } from '../workbench.service';

/** A context menu on screen: where, what it offers, and what its commands act on. */
export interface OpenContextMenu {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly UiMenuItem[];
  readonly target: CommandTarget;
}

/** A menu's rows by command id; `'-'` starts a new section, drawn as a separator. */
type Layout = readonly string[];

/** A file, or several entries: what is done *to* them. */
const ENTRY_FILE: Layout = [
  'file.open', 'file.openToSide', 'file.openExternal', 'file.reveal',
  '-', 'edit.cut', 'edit.copy',
  '-', 'file.copyPath', 'file.download',
  '-', 'file.compress', 'file.extractHere', 'file.extractTo',
  '-', 'file.rename', 'file.copyTo', 'file.moveTo', 'file.trash', 'file.delete',
];

/** A folder is also a place: things are made and pasted into it. */
const ENTRY_FOLDER: Layout = [
  'file.open', 'file.openToSide', 'file.reveal',
  '-', 'file.newFile', 'file.newFolder',
  '-', 'edit.cut', 'edit.copy', 'edit.paste',
  '-', 'file.copyPath', 'file.download', 'file.compress', 'places.addBookmark',
  '-', 'file.rename', 'file.copyTo', 'file.moveTo', 'file.trash', 'file.delete',
];

/** Several entries at once: only what applies to all of them. */
const ENTRIES: Layout = [
  'edit.cut', 'edit.copy',
  '-', 'file.copyPath', 'file.download', 'file.compress',
  '-', 'file.copyTo', 'file.moveTo', 'file.trash', 'file.delete',
];

/** The blank space of a listing: the folder itself. */
const BLANK: Layout = [
  'file.newFile', 'file.newFolder',
  '-', 'edit.paste', 'edit.undo',
  '-', 'file.upload', 'file.uploadFolder', 'file.reveal', 'file.copyPath', 'places.addBookmark',
  '-', 'selection.all', 'view.refresh',
];

/** A folder of the explorer tree. */
const TREE_FOLDER: Layout = [
  'file.open', 'file.openToSide', 'file.reveal',
  '-', 'file.newFile', 'file.newFolder',
  '-', 'edit.cut', 'edit.copy', 'edit.paste',
  '-', 'file.copyPath', 'places.addBookmark',
  '-', 'file.rename', 'file.trash', 'file.delete',
];

/** The workspace root in the tree: nothing to rename, move or delete. */
const TREE_ROOT: Layout = ['file.newFile', 'file.newFolder', '-', 'edit.paste', '-', 'file.reveal', 'file.copyPath'];

const TAB: Layout = ['tab.close', 'tab.closeOthers', 'tab.closeRight', '-', 'file.copyPath', 'file.reveal'];

/** The Places panes (PRD 003, §6): a place, a bookmark, a recent folder. */
const PLACE: Layout = ['places.open', 'places.openToSide', '-', 'places.addBookmark', '-', 'file.reveal', 'file.copyPath'];
const BOOKMARK: Layout = [
  'places.open', 'places.openToSide',
  '-', 'places.renameBookmark', 'places.moveBookmarkUp', 'places.moveBookmarkDown', 'places.removeBookmark',
  '-', 'file.reveal', 'file.copyPath',
];
const RECENT: Layout = [
  'places.open', 'places.openToSide',
  '-', 'places.addBookmark', 'places.removeRecent', 'places.clearRecent',
  '-', 'file.reveal', 'file.copyPath',
];

/**
 * The right-click menus (PRD 003, §5) — on an entry, on a listing's blank
 * space, on a folder in the explorer, on a tab — and `Shift`+`F10` for each.
 *
 * Every row is a command of `CommandsFeature`, laid out here per kind of
 * target, so a right-click offers nothing the menus and the palette do not,
 * enabled by the same rules; a row that does not apply is shown disabled
 * rather than left out, so the menu keeps its shape. The library's
 * `UiContextMenu` draws it, and asks to close.
 */
export class ContextMenuFeature {
  private readonly current = signal<OpenContextMenu | null>(null);

  constructor(private readonly parent: WorkbenchService) {}

  readonly menu = this.current.asReadonly();

  /**
   * The open menu as a list of one, for the template to track by identity: a
   * second right-click is a new menu — placed, and focused, afresh — not the
   * old one with new rows.
   */
  readonly menus = computed<readonly OpenContextMenu[]>(() => {
    const menu = this.current();
    return menu === null ? [] : [menu];
  });

  /** A right-click in a panel: on an entry, or on blank space (`target: null`). */
  openInPanel(groupId: string, request: UiContextMenuRequest): void {
    this.parent.editorGroupsFt.focus(groupId);
    const commands = this.parent.commandsFt;
    if (request.target === null) {
      this.show(request, 'Folder actions', BLANK, commands.blankTarget(groupId));
      return;
    }
    const target = commands.entryTarget(groupId, request.target);
    const entry = this.parent.fsDataFt.entryAt(request.target);
    const layout = target.paths.length > 1 ? ENTRIES : entry !== undefined && isFolder(entry) ? ENTRY_FOLDER : ENTRY_FILE;
    this.show(request, 'Entry actions', layout, target);
  }

  /** A right-click on a folder of the explorer tree. */
  openInTree(request: UiContextMenuRequest): void {
    const path = request.target ?? '';
    this.parent.explorerFt.select(path);
    this.show(request, 'Folder actions', path === '' ? TREE_ROOT : TREE_FOLDER, this.parent.commandsFt.folderTarget(path));
  }

  /** A right-click on a tab. */
  openOnTab(groupId: string, request: UiContextMenuRequest): void {
    if (request.target === null) {
      return;
    }
    this.show(request, 'Tab actions', TAB, this.parent.commandsFt.tabTarget(groupId, request.target));
  }

  /** A right-click on a place, a bookmark or a recent folder (PRD 003, §6): the folder is what is acted on. */
  openOnPlace(request: UiContextMenuRequest, section: PlaceSection, path: string): void {
    const layout = section === 'bookmark' ? BOOKMARK : section === 'recent' ? RECENT : PLACE;
    const label = section === 'bookmark' ? 'Bookmark actions' : section === 'recent' ? 'Recent folder actions' : 'Place actions';
    this.show(request, label, layout, { groupId: this.parent.activeGroupId(), paths: [], folder: path });
  }

  /** A row was chosen: the menu closes, and its command runs against what was right-clicked. */
  run(id: string): void {
    const menu = this.current();
    this.close();
    if (menu !== null) {
      this.parent.commandsFt.run(id, menu.target);
    }
  }

  close(): void {
    this.current.set(null);
  }

  private show(request: UiContextMenuRequest, label: string, layout: Layout, target: CommandTarget): void {
    const commands = this.parent.commandsFt;
    const items: UiMenuItem[] = [];
    let separate = false;
    for (const id of layout) {
      if (id === '-') {
        separate = items.length > 0;
        continue;
      }
      items.push(commands.menuItem(id, target, separate));
      separate = false;
    }
    this.current.set({ x: request.x, y: request.y, label, items, target });
  }
}
