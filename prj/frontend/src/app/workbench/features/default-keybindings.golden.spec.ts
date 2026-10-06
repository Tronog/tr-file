import { DEFAULT_KEYBINDINGS } from './keybindings.feature';

/**
 * The default key table, frozen (PRD 001, §17.1): the first binding of a key
 * wins, so the order is part of what a key does. Splitting the table between
 * the libraries and the app must not change a line of this.
 */
const GOLDEN = [
  'list Enter file.open',
  'list Space list.select',
  'list Backspace go.up',
  'list Delete file.trash',
  'list Shift+Delete file.delete',
  'list Ctrl+A selection.all',
  'list Ctrl+Space list.toggleSelection',
  'list Insert list.mark',
  'list * list.toggleAll',
  'list Plus selection.byPattern',
  'list - selection.unselectByPattern',
  'panel Alt+Left go.back',
  'panel Alt+Right go.forward',
  'panel Alt+Up go.up',
  'panel Ctrl+Enter file.openToSide',
  'panel Ctrl+C edit.copy',
  'panel Ctrl+X edit.cut',
  'panel Ctrl+V edit.paste',
  'panel Ctrl+Z edit.undo',
  'panel Ctrl+F edit.filter',
  'panel Ctrl+L go.location',
  'panel Ctrl+Shift+N file.newFolder',
  'panel Ctrl+R view.refresh',
  'panel Escape view.stopLoading',
  'panel Ctrl+Shift+C file.copyPath',
  'panel Shift+F10 panel.contextMenu',
  'panel ContextMenu panel.contextMenu',
  'panel / view.splitRight',
  'panel Ctrl+T tab.new',
  'panel Ctrl+Up view.toggleMaximize',
  'panel Ctrl+W tab.close',
  'panel Ctrl+PageUp tab.previous',
  'panel Ctrl+PageDown tab.next',
  'panel PageUp image.previous',
  'panel PageDown image.next',
  'image Plus image.zoomIn',
  'image - image.zoomOut',
  'image 1 image.actualSize',
  'image 0 image.fit',
  'window Ctrl+Shift+P view.commandPalette',
  'window Ctrl+P view.commandPalette',
  'window Ctrl+Shift+F edit.search',
  'window Ctrl+H view.hidden',
  'window Ctrl+, workbench.openSettings',
  'window Ctrl+Shift+` view.togglePanel',
  'window Ctrl+E view.toggleExplorer',
  'window Ctrl+D view.toggleDetails',
  'window Ctrl+/ view.toggleSidebars',
  'window Ctrl+U file.checkForUpdates',
  ...Array.from({ length: 9 }, (_, index) => `window Ctrl+${index + 1} places.openBookmark${index + 1}`),
  'window Ctrl+Tab workbench.focusNextPart',
  'window Ctrl+Shift+Tab workbench.focusPreviousPart',
  'panel Tab workbench.nextPanel',
  'panel Shift+Tab workbench.previousPanel',
  'window F1 help.show',
  'window F2 file.rename',
  'window F3 file.open',
  'window F4 file.openExternal',
  'window F5 file.copyTo',
  'window F6 file.moveTo',
  'window F7 file.newFolder',
  'window F8 file.delete',
  'window F9 view.mainMenu',
  'window F10 file.quit',
];

describe('the default key bindings', () => {
  it('are the table they were, in its order', () => {
    expect(DEFAULT_KEYBINDINGS.map((binding) => `${binding.when} ${binding.key} ${binding.command}`)).toEqual(GOLDEN);
  });
});
