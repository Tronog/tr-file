/**
 * The only thing the renderer is given (PRD 001, §8.1).
 *
 * A sandboxed preload, so it runs as CommonJS and may touch nothing but
 * `contextBridge` and `ipcRenderer` — which is the point. What lands on
 * `window` is one function that forwards a command object and returns the
 * answer; no file handles, no paths, no Node, no way to name a channel other
 * than this one.
 *
 * Everything crossing here is validated on the other side by
 * `FileSystemBridge`, which treats these requests exactly as untrusted as an
 * HTTP query string.
 */

// `import =` rather than an ESM import: a sandboxed preload is CommonJS, and
// this package is otherwise ESM, so the `.cts` extension and this form are
// what make the emitted `preload.cjs` loadable at all.
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

/** Must match `FsBridgeChannel.CHANNEL` and the frontend's `BRIDGE_VERSION`. */
const CHANNEL = 'tr-file:fs';
const VERSION = 1;

contextBridge.exposeInMainWorld('trFileBridge', {
  version: VERSION,
  invoke: (request: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNEL, request),
});
