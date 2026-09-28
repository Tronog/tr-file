import type { UiPanelKey } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';
import type { CommandTarget } from './commands.feature';

/**
 * What a panel's keyboard does (PRD 001, Section 6.2).
 *
 * The split is deliberate. `UiFileList` and `UiIconView` own everything that
 * is only about *where focus is* — the arrows, `Home`/`End`, the page keys and
 * type-to-find — because a roving tabindex can only be rolled where the
 * elements live, and because nothing outside the panel cares which row a
 * keyboard user is standing on. Every key that changes what the workbench
 * *shows* arrives here instead, as a `UiPanelKey`, so the binding table below
 * is the whole answer to "what does this key do in a panel".
 *
 * That also keeps the bindings honest about their reach: `open` and `select`
 * are the same operations a double click and a click perform, `up` is the
 * toolbar's Up button, and `Ctrl`+`R` is its Refresh — a keyboard user gets at the
 * panel's existing verbs rather than a parallel set of their own. `back` and
 * `forward` are the exception, and the reason `PanelHistoryFeature` exists:
 * `Alt`+`←`/`→` is the only way to walk a panel's trail, since nothing in the
 * chrome offers it yet — as is `Ctrl`+`Enter`, which opens an entry in a panel
 * that does not exist until the key is pressed (§6.2.5). `Delete` moves the
 * selection to the trash, after asking (PRD 005, §1), and `Ctrl`+`C` / `X` /
 * `V` are the clipboard (§2). PRD 003, §5 adds `Shift`+`Delete` (delete for
 * good, after asking), `Ctrl`+`Shift`+`N` (new folder) and `Ctrl`+`Z` (undo)
 * — each the same command its menu entry runs — and PRD 004, §2 `+` / `-`,
 * select and unselect by a pattern. The function keys are not here: they
 * mean the same wherever focus is, and `FunctionKeysFeature` binds them.
 */
export class PanelKeyboardFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /**
   * Runs one key of a panel body against the group it was pressed in.
   *
   * A command that needs an entry and has none is dropped rather than guessed
   * at: an empty listing can still be left or reloaded, but there is nothing
   * in it to open.
   */
  run(groupId: string, key: UiPanelKey): void {
    // File management is the only panel content that reports keys so far.
    const files = this.parent.fileBrowserFt;

    switch (key.command) {
      case 'open':
        // `openEntry` keeps the focus itself, since a double click has to do
        // exactly the same thing.
        if (key.entryId !== null) {
          files.openEntry(groupId, key.entryId);
        }
        break;

      case 'open-aside':
        // No `keepFocusInBody` here: the new panel takes the keyboard, and
        // asking the old one for it too would drag focus back out of it.
        if (key.entryId !== null) {
          files.openEntryAside(groupId, key.entryId);
        }
        break;

      case 'stop-loading': {
        // `Escape` in a large folder being read (PRD 004, §3.1.4): stopped, what came kept.
        const path = this.parent.editorGroupsFt.pathOf(groupId);
        if (path !== undefined) {
          this.parent.fsDataFt.abortLarge(path, true);
        }
        break;
      }

      case 'previous-image':
      case 'next-image':
        // The viewer stays where it is and keeps the keyboard; only its picture changes.
        void this.parent.filePreviewFt.stepImage(groupId, key.command === 'next-image' ? 1 : -1);
        break;

      case 'select':
        if (key.entryId !== null) {
          files.selectEntry(groupId, key.entryId);
        }
        break;

      case 'up':
        files.navigateUp(groupId);
        this.keepFocusInBody(groupId);
        break;

      case 'refresh':
        files.runToolbarAction(groupId, 'refresh');
        break;

      case 'back':
        this.parent.panelHistoryFt.back(groupId);
        this.keepFocusInBody(groupId);
        break;

      case 'forward':
        this.parent.panelHistoryFt.forward(groupId);
        this.keepFocusInBody(groupId);
        break;

      // The clipboard (PRD 005, §2): the panel's selection, or the entry the key was pressed on.
      case 'copy':
        this.parent.fileClipboardFt.copy(groupId, key.entryId);
        break;

      case 'cut':
        this.parent.fileClipboardFt.cut(groupId, key.entryId);
        break;

      case 'paste':
        void this.parent.fileClipboardFt.paste(groupId);
        break;

      // PRD 004, §1.3.2: `Ctrl`+`Shift`+`C`, the command *Copy Path* runs.
      case 'copy-path':
        this.parent.commandsFt.run('file.copyPath', this.copyPathTarget(groupId, key.entryId));
        break;

      case 'delete':
        // Asks first, always (PRD 005, §1); the rows it takes away are re-read when it ends.
        void this.parent.operationsFt.trashSelection(groupId, key.entryId);
        break;

      // PRD 003, §5: `Shift`+`Delete`, `Ctrl`+`Shift`+`N`, `Ctrl`+`Z`.
      case 'delete-permanently':
        void this.parent.operationsFt.deleteSelection(groupId, key.entryId);
        break;

      case 'new-folder': {
        const folder = this.parent.editorGroupsFt.stateOf(groupId)?.path;
        if (folder !== undefined) {
          void this.parent.fileEditFt.createFolder(folder, groupId);
        }
        break;
      }

      case 'undo':
        void this.parent.undoFt.undo();
        break;

      // PRD 004, §2: Midnight Commander's `+` and `-`.
      case 'select-pattern':
      case 'unselect-pattern':
        void files.selectByPattern(groupId, key.command === 'select-pattern');
        break;
    }
  }

  /**
   * What `Ctrl`+`Shift`+`C` copies the path of: the selection, when the entry
   * the key was pressed on is part of it, else that entry; with no entry, a
   * file tab's file, or the folder the panel lists.
   */
  private copyPathTarget(groupId: string, entryId: string | null): CommandTarget {
    const commands = this.parent.commandsFt;
    if (entryId !== null) {
      return commands.entryTarget(groupId, entryId);
    }
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    return tab !== undefined && tab.kind !== 'folder' ? commands.tabTarget(groupId, tab.id) : commands.blankTarget(groupId);
  }

  /**
   * Puts the keyboard back in the body after a key changed what the panel is
   * showing.
   *
   * Not a nicety. A panel that lands somewhere new renders a different set of
   * rows, so the element that had focus is gone and the browser drops focus to
   * `<body>` — outside the panel, where the next `Alt`+`←` reaches nothing and
   * a keyboard user is simply stranded. Re-uses the §6.3 request, which waits
   * for a listing that is still loading, so the focus lands on the first row
   * of the new folder whenever it arrives.
   *
   * `select` and `refresh` are left out on purpose: neither changes the
   * folder, so the rows keep their identity and focus never moves.
   */
  private keepFocusInBody(groupId: string): void {
    this.parent.panelFocusFt.focusBody(groupId);
  }
}
