/**
 * The only thing the renderer is given (PRD 001, §8.1).
 *
 * A sandboxed preload, so it runs as CommonJS and may touch nothing but
 * `contextBridge` and `ipcRenderer` — which is the point. What lands on
 * `window` are two small objects that forward a command and return the answer;
 * no file handles, no paths, no Node, no way to name a channel other than the
 * two below.
 *
 * Everything crossing here is validated on the other side by
 * `FileSystemBridge` and `WindowControlsChannel`, which treat these requests
 * exactly as untrusted as an HTTP query string.
 */

// `import =` rather than an ESM import: a sandboxed preload is CommonJS, and
// this package is otherwise ESM, so the `.cts` extension and this form are
// what make the emitted `preload.cjs` loadable at all.
import electron = require('electron');

const { contextBridge, ipcRenderer, webUtils } = electron;

/** Must match `FsBridgeChannel.CHANNEL` and the frontend's `BRIDGE_VERSION`. */
const FS_CHANNEL = 'tr-file:fs';
/**
 * Version 2 (PRD 003, §1): reads and uploads move in chunks, and downloads go
 * through `save`. A page built for version 1 must not use this bridge.
 */
const FS_VERSION = 2;
const VERSION = 1;

/** Must match `SaveFileChannel`'s channel and progress event. */
const SAVE_CHANNEL = 'tr-file:save';
const SAVE_PROGRESS_EVENT = 'tr-file:save:progress';

/** Must match `DragOutChannel`'s channel. */
const DRAG_CHANNEL = 'tr-file:drag';

contextBridge.exposeInMainWorld('trFileBridge', {
  version: FS_VERSION,
  invoke: (request: unknown): Promise<unknown> => ipcRenderer.invoke(FS_CHANNEL, request),
  /**
   * Downloads a file: the main process asks where with the native dialog and
   * streams the copy. `cancel` stops one by the id the page gave it.
   */
  save: (request: unknown): Promise<unknown> => ipcRenderer.invoke(SAVE_CHANNEL, request),
  onSaveProgress: (listener: (progress: unknown) => void): (() => void) => {
    const handler = (_event: unknown, progress: unknown): void => listener(progress);
    ipcRenderer.on(SAVE_PROGRESS_EVENT, handler);
    return () => void ipcRenderer.removeListener(SAVE_PROGRESS_EVENT, handler);
  },
  /**
   * Entries dragged out to another app (PRD 003, §6): the page names them by
   * root-relative path at the start of its drag, and the main process starts
   * the system's drag with their host paths.
   */
  startDrag: (paths: unknown): void => ipcRenderer.send(DRAG_CHANNEL, { paths }),
  /**
   * Where files dropped on the window are in the root, if they are
   * (PRD 003, §6): their host paths are read here and go straight to the
   * main process, which answers with root-relative paths or `null` — so the
   * page learns what it could list anyway, and not one host path.
   */
  localPaths: (files: unknown): Promise<unknown> => {
    const list = Array.isArray(files) ? files : [];
    const absolute = list.map((file) => {
      try {
        return file instanceof File ? webUtils.getPathForFile(file) : '';
      } catch {
        return '';
      }
    });
    return ipcRenderer.invoke(FS_CHANNEL, { command: 'local-paths', absolute });
  },
});

/*
 * What the page remembers between sessions (PRD 003, §6). The window's origin
 * changes with every start, so `localStorage` forgets; the main process keeps
 * a file instead — `all` once at start, `set` per change.
 */
const SETTINGS_CHANNEL = 'tr-file:settings';

contextBridge.exposeInMainWorld('trFileSettings', {
  version: VERSION,
  all: (): Promise<unknown> => ipcRenderer.invoke(SETTINGS_CHANNEL, { command: 'all' }),
  set: (key: unknown, value: unknown): Promise<unknown> => ipcRenderer.invoke(SETTINGS_CHANNEL, { command: 'set', key, value }),
});

/*
 * The window's own buttons (PRD 001, §8.2). The frame is gone, so the page
 * draws minimise / maximise / close — but only the main process can act on
 * them, and this is the entire vocabulary it accepts.
 *
 * `platform` is exposed because the page has to know it: macOS draws its own
 * traffic lights over the bar, so the app hides its buttons and leaves room
 * instead. A sandboxed preload gets exactly this much of `process`.
 */
const WINDOW_CHANNEL = 'tr-file:window';
const WINDOW_STATE_EVENT = 'tr-file:window:state';

contextBridge.exposeInMainWorld('trFileWindow', {
  version: VERSION,
  platform: process.platform,
  invoke: (request: unknown): Promise<unknown> => ipcRenderer.invoke(WINDOW_CHANNEL, request),
  /**
   * Subscribes to state the *window* changed by itself — an OS snap, a
   * keyboard shortcut, a drag off the top of the screen. Returns its own
   * unsubscribe, so the page never has to name the channel to stop listening.
   */
  onState: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown): void => listener(state);
    ipcRenderer.on(WINDOW_STATE_EVENT, handler);
    return () => void ipcRenderer.removeListener(WINDOW_STATE_EVENT, handler);
  },
});

/*
 * Self-updating (PRD 001, §8.6): whether the share holds a newer version, and
 * the title bar's *Upgrade* button. The main process decides what is newer and
 * does the upgrading; the page may only ask.
 */
const UPDATE_CHANNEL = 'tr-file:update';
const UPDATE_STATUS_EVENT = 'tr-file:update:status';

contextBridge.exposeInMainWorld('trFileUpdate', {
  version: VERSION,
  invoke: (command: unknown): Promise<unknown> => ipcRenderer.invoke(UPDATE_CHANNEL, { command }),
  onStatus: (listener: (status: unknown) => void): (() => void) => {
    const handler = (_event: unknown, status: unknown): void => listener(status);
    ipcRenderer.on(UPDATE_STATUS_EVENT, handler);
    return () => void ipcRenderer.removeListener(UPDATE_STATUS_EVENT, handler);
  },
});
