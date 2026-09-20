import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * The application menu — which this app never shows.
 *
 * The window is frameless and carries its own menu bar in the page, so nothing
 * here is ever drawn. It exists for one reason: a menu is also an accelerator
 * table, and Electron installs a default one whose **Close** item claims
 * `Ctrl`+`W`. Since §6.2.2 that chord closes the focused *tab*, and a stray
 * accelerator that closed the whole window instead would be a spectacular way
 * to lose someone's work.
 *
 * Chromium does give the page first refusal on a non-reserved accelerator, so
 * the renderer's `preventDefault` already wins in practice — but "in practice"
 * is not a guarantee worth betting a window on, and the platforms differ. The
 * chord is simply not bound here.
 *
 * What is kept is what a desktop app is expected to answer: reload, the
 * inspector (the reason `TR_FILE_DEVTOOLS` is not the only way in), full
 * screen and quit.
 */
export function installAppMenu(): void {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const window: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      // No `close` role: `Ctrl`+`W` belongs to the tab, not to the window.
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  Menu.setApplicationMenu(Menu.buildFromTemplate([view, window]));
}
