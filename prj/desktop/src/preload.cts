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

const { contextBridge, ipcRenderer } = electron;

/** Must match `FsBridgeChannel.CHANNEL` and the frontend's `BRIDGE_VERSION`. */
const FS_CHANNEL = 'tr-file:fs';
const VERSION = 1;

contextBridge.exposeInMainWorld('trFileBridge', {
  version: VERSION,
  invoke: (request: unknown): Promise<unknown> => ipcRenderer.invoke(FS_CHANNEL, request),
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
