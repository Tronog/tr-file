import { clipboard, ClipboardItem } from 'electron';

import type { ClipboardLike } from './system-clipboard.js';

/** How Electron names a platform's own clipboard format, rather than a web MIME type. */
const raw = (format: string): string => (format === 'text/plain' ? format : `electron application/osclipboard;format="${format}"`);

/**
 * Electron's clipboard as `SystemClipboard` needs it: raw formats in and out
 * (PRD 003, §6). The only file that touches the real clipboard, which is why
 * it is this small.
 */
export const electronClipboard: ClipboardLike = {
  async readFormat(format) {
    const type = raw(format);
    if (!(await clipboard.has(type))) {
      return null;
    }
    for (const item of await clipboard.read()) {
      try {
        const blob = await item.getType(type);
        if (blob instanceof Blob) {
          return Buffer.from(await blob.arrayBuffer());
        }
      } catch {
        // Not in this item; the next may have it.
      }
    }
    return null;
  },
  async writeFormats(formats) {
    await clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(formats).map(([format, text]) => [raw(format), text])))]);
  },
};
