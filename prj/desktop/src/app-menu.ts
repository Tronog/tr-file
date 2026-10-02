import { Menu, type MenuItemConstructorOptions } from 'electron';

import { zoomFocused } from './window-controls.channel.js';

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
 * `Ctrl`+`R` is the same story since PRD 004, §2: it reads a panel's folder
 * again (Midnight Commander's key for it, now that `F5` copies), so the
 * default **Reload** is left out — `Ctrl`+`Shift`+`R` (force reload) still
 * reloads the window.
 *
 * What is kept is what a desktop app is expected to answer: reload, the
 * inspector (the reason `TR_FILE_DEVTOOLS` is not the only way in), full
 * screen and quit.
 */
export function installAppMenu(): void {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      // No `reload` role: `Ctrl`+`R` belongs to the panel, which reads its folder again.
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      // Not the zoom roles: through `applyZoom`, so the title bar's zoom control follows and the
      // level is remembered (PRD 001, §8.2.3). `=` and the keypad zoom in and out as well.
      { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: () => zoomFocused(0) },
      { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: () => zoomFocused(1) },
      { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => zoomFocused(1) },
      { label: 'Zoom In', accelerator: 'CommandOrControl+numadd', click: () => zoomFocused(1) },
      { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => zoomFocused(-1) },
      { label: 'Zoom Out', accelerator: 'CommandOrControl+numsub', click: () => zoomFocused(-1) },
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
