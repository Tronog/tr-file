import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { UI_KEYBINDING_DEFAULTS, type UiKeybinding } from '@tr-file/ui';

/**
 * The file manager's keys, as they are until the application says otherwise:
 * a listing's (`UiFileList`, `UiIconView` — `when: 'list'`), a file
 * browser's (`UiFileBrowser` — `when: 'panel'`) and Task Manager's list of
 * processes' (`UiProcessList`).
 *
 * Where a key does what a command of the application's table does, it is
 * bound to that command's id — `file.open`, `edit.copy` — so one binding
 * governs the key in the list and the key the menu shows beside the command.
 * The rest are a listing's own gestures: `list.select`, `list.mark`, …
 */
export const FILE_UI_DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [
  // On a row or a tile.
  { command: 'file.open', key: 'Enter', when: 'list' },
  { command: 'list.select', key: 'Space', when: 'list' },
  { command: 'go.up', key: 'Backspace', when: 'list' },
  { command: 'file.trash', key: 'Delete', when: 'list' },
  { command: 'file.delete', key: 'Shift+Delete', when: 'list' },
  { command: 'selection.all', key: 'Ctrl+A', when: 'list' },
  { command: 'list.toggleSelection', key: 'Ctrl+Space', when: 'list' },
  // Midnight Commander's (PRD 004, §2).
  { command: 'list.mark', key: 'Insert', when: 'list' },
  { command: 'list.toggleAll', key: '*', when: 'list' },
  { command: 'selection.byPattern', key: 'Plus', when: 'list' },
  { command: 'selection.unselectByPattern', key: '-', when: 'list' },
  // Anywhere in a file browser.
  { command: 'go.back', key: 'Alt+Left', when: 'panel' },
  { command: 'go.forward', key: 'Alt+Right', when: 'panel' },
  { command: 'go.up', key: 'Alt+Up', when: 'panel' },
  { command: 'file.openToSide', key: 'Ctrl+Enter', when: 'panel' },
  { command: 'edit.copy', key: 'Ctrl+C', when: 'panel' },
  { command: 'edit.cut', key: 'Ctrl+X', when: 'panel' },
  { command: 'edit.paste', key: 'Ctrl+V', when: 'panel' },
  { command: 'edit.undo', key: 'Ctrl+Z', when: 'panel' },
  { command: 'edit.filter', key: 'Ctrl+F', when: 'panel' },
  { command: 'go.location', key: 'Ctrl+L', when: 'panel' },
  { command: 'file.newFolder', key: 'Ctrl+Shift+N', when: 'panel' },
  { command: 'view.refresh', key: 'Ctrl+R', when: 'panel' },
  { command: 'view.stopLoading', key: 'Escape', when: 'panel' },
  { command: 'file.copyPath', key: 'Ctrl+Shift+C', when: 'panel' },
  { command: 'panel.contextMenu', key: 'Shift+F10', when: 'panel' },
  { command: 'panel.contextMenu', key: 'ContextMenu', when: 'panel' },
  // Over an image a file browser shows (PRD 012, §1.1).
  { command: 'image.previous', key: 'PageUp', when: 'panel' },
  { command: 'image.next', key: 'PageDown', when: 'panel' },
  // Over any file a file browser shows: its tab closed (PRD 005, §3.1; PRD 012, §1.3). The same key
  // stops a large folder's reading, over a listing only.
  { command: 'viewer.close', key: 'Escape', when: 'panel' },
  // Over a listing: back to normal selection, nothing selected (PRD 004, §2.2) — after the two above.
  { command: 'selection.clear', key: 'Escape', when: 'panel' },
  // On a row of Task Manager's processes (PRD 014, §2).
  { command: 'process.endTask', key: 'Delete', when: 'list' },
  { command: 'process.endTree', key: 'Shift+Delete', when: 'list' },
];

/**
 * What the file manager's components need from the application's injector:
 * their keys among the keymap's defaults. Add it to the application's
 * providers — and a spec's, when it renders them on their own.
 */
export function provideFileUi(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: UI_KEYBINDING_DEFAULTS, multi: true, useValue: FILE_UI_DEFAULT_KEYBINDINGS }]);
}
