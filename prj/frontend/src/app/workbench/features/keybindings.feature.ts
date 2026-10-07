import { FILE_UI_DEFAULT_KEYBINDINGS } from '@tr-file/file-ui';
import { UI_DEFAULT_KEYBINDINGS, UI_FOCUS_COMMANDS, UiKeybindingsFeature, uiKeybindingsKey, type UiKeybinding } from '@tr-file/ui';
import { STORAGE_PREFIX } from '../../settings/settings.service';
import type { WorkbenchService } from '../workbench.service';
import type { CommandTarget } from './commands.feature';
import { BOOKMARK_KEYS, openBookmarkCommand } from './places.feature';

/** Where the user's changes to the key bindings are kept (PRD 010, §2) — for every backend alike. */
export const KEYBINDINGS_KEY = uiKeybindingsKey(STORAGE_PREFIX);

/**
 * The window's own keys (`when: 'window'`), and the application's keys in a
 * panel (`Tab` between panels). The library's are `UI_DEFAULT_KEYBINDINGS`.
 */
export const WORKBENCH_DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [
  { command: 'view.commandPalette', key: 'Ctrl+Shift+P', when: 'window' },
  { command: 'view.commandPalette', key: 'Ctrl+P', when: 'window' },
  { command: 'edit.search', key: 'Ctrl+Shift+F', when: 'window' },
  { command: 'view.hidden', key: 'Ctrl+H', when: 'window' },
  { command: 'workbench.openSettings', key: 'Ctrl+,', when: 'window' },
  { command: 'view.togglePanel', key: 'Ctrl+Shift+`', when: 'window' },
  // PRD 001, §9.2.1.
  { command: 'view.toggleExplorer', key: 'Ctrl+E', when: 'window' },
  { command: 'view.toggleDetails', key: 'Ctrl+D', when: 'window' },
  { command: 'view.toggleSidebars', key: 'Ctrl+/', when: 'window' },
  // PRD 001, §8.6.1 — the desktop's; in a browser the command is disabled and the key does nothing.
  { command: 'file.checkForUpdates', key: 'Ctrl+U', when: 'window' },
  // The editor's Save (PRD 005, §4) — a window key, so it reaches the page from the editor's text.
  { command: 'file.save', key: 'Ctrl+S', when: 'window' },
  // Task Manager (PRD 014, §3). A browser keeps the chord for reopening a tab: it reaches the page on the desktop.
  { command: 'view.app.task-manager', key: 'Ctrl+Shift+T', when: 'window' },
  // The bookmarks, in their order, from any panel (PRD 002, §6.1).
  ...Array.from({ length: BOOKMARK_KEYS }, (_, index): UiKeybinding => ({
    command: openBookmarkCommand(index + 1),
    key: `Ctrl+${index + 1}`,
    when: 'window',
  })),
  { command: 'workbench.focusNextPart', key: 'Ctrl+Tab', when: 'window' },
  { command: 'workbench.focusPreviousPart', key: 'Ctrl+Shift+Tab', when: 'window' },
  { command: 'workbench.nextPanel', key: 'Tab', when: 'panel' },
  { command: 'workbench.previousPanel', key: 'Shift+Tab', when: 'panel' },
  // Midnight Commander's function keys (PRD 004, §2).
  // Help, as Midnight Commander's `F1` is (PRD 001, §16).
  { command: 'help.show', key: 'F1', when: 'window' },
  { command: 'file.rename', key: 'F2', when: 'window' },
  { command: 'file.open', key: 'F3', when: 'window' },
  // Midnight Commander's Edit (PRD 005, §4): the built-in editor; what it cannot edit, the system's application.
  { command: 'file.edit', key: 'F4', when: 'window' },
  { command: 'file.copyTo', key: 'F5', when: 'window' },
  { command: 'file.moveTo', key: 'F6', when: 'window' },
  { command: 'file.newFolder', key: 'F7', when: 'window' },
  // Midnight Commander's Delete: for good, after asking — the trash is `Delete` (PRD 004, §2.1).
  { command: 'file.delete', key: 'F8', when: 'window' },
  { command: 'view.mainMenu', key: 'F9', when: 'window' },
  { command: 'file.quit', key: 'F10', when: 'window' },
];

/**
 * Every binding as it is before the user changes anything: the file manager's
 * components' (`FILE_UI_DEFAULT_KEYBINDINGS`), the generic library's
 * (`UI_DEFAULT_KEYBINDINGS`) and the window's — in `UiKeymap.defaults`' order.
 */
export const DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [...FILE_UI_DEFAULT_KEYBINDINGS, ...UI_DEFAULT_KEYBINDINGS, ...WORKBENCH_DEFAULT_KEYBINDINGS];

/** Window keys the shell handles itself, because they move DOM focus. */
export const FOCUS_COMMANDS = UI_FOCUS_COMMANDS;

/**
 * Window keys that act on the entry the cursor is on rather than on the
 * selection — as Midnight Commander's `F2`–`F4` do (PRD 004, §2).
 */
const CURSOR_COMMANDS = new Set(['file.rename', 'file.open', 'file.openExternal', 'file.edit']);

/**
 * Every key the workbench answers, in one table the user can change
 * (PRD 010, §2) — the library's `UiKeybindingsFeature`, over the defaults
 * above. The window's keys run as commands of `CommandsFeature` on the active
 * panel; `F2`–`F4` on the entry its cursor is on.
 */
export class KeybindingsFeature extends UiKeybindingsFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /** What a window command acts on; see `CURSOR_COMMANDS`. */
  override targetOf(command: string): CommandTarget {
    const target = this.parent.commandsFt.activeTarget();
    if (!CURSOR_COMMANDS.has(command)) {
      return target;
    }
    const cursor = this.cursorOf(target);
    return { ...target, paths: cursor === null ? [] : [cursor] };
  }

  /**
   * The entry the active panel's cursor is on — the focused one, else the one
   * selected first — while the panel lists a folder that has it.
   */
  private cursorOf(target: CommandTarget): string | null {
    const group = this.parent.editorGroupsFt.stateOf(target.groupId);
    if (group === undefined || target.folder === null) {
      return null;
    }
    const cursor = group.focusedEntryId ?? group.selection[0];
    return cursor !== undefined && this.parent.fsDataFt.entryAt(cursor) !== undefined ? cursor : null;
  }
}
