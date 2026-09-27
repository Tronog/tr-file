import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SystemClipboard, type ClipboardLike } from './system-clipboard.js';

/** A clipboard of raw formats, replaced whole on each write as the system's is. */
class FakeClipboard implements ClipboardLike {
  formats = new Map<string, Buffer>();
  async readFormat(format: string): Promise<Buffer | null> {
    return this.formats.get(format) ?? null;
  }
  async writeFormats(formats: Readonly<Record<string, string>>): Promise<void> {
    this.formats = new Map(Object.entries(formats).map(([format, text]) => [format, Buffer.from(text)]));
  }
}

describe('SystemClipboard (PRD 003, §6)', () => {
  it('reads what GNOME Files copied or cut', async () => {
    const fake = new FakeClipboard();
    fake.formats.set('x-special/gnome-copied-files', Buffer.from('cut\nfile:///home/me/a%20b.txt\nfile:///home/me/c\0'));
    assert.deepEqual(await new SystemClipboard(fake, 'linux').readFiles(), { files: ['/home/me/a b.txt', '/home/me/c'], cut: true });
  });

  it('reads a uri list with KDE’s cut marker, and skips what is not a local file', async () => {
    const fake = new FakeClipboard();
    fake.formats.set('text/uri-list', Buffer.from('# comment\r\nfile:///srv/x\r\nhttps://example.com/\r\n'));
    fake.formats.set('application/x-kde-cutselection', Buffer.from('1'));
    assert.deepEqual(await new SystemClipboard(fake, 'linux').readFiles(), { files: ['/srv/x'], cut: true });
  });

  it('writes files GNOME Files can paste, and reads them back', async () => {
    const fake = new FakeClipboard();
    const clipboard = new SystemClipboard(fake, 'linux');
    await clipboard.writeFiles(['/home/me/a b.txt'], false);
    assert.equal(fake.formats.get('x-special/gnome-copied-files')?.toString(), 'copy\nfile:///home/me/a%20b.txt');
    assert.equal(fake.formats.get('text/uri-list')?.toString(), 'file:///home/me/a%20b.txt\r\n');
    assert.equal(fake.formats.get('text/plain')?.toString(), '/home/me/a b.txt');
    assert.deepEqual(await clipboard.readFiles(), { files: ['/home/me/a b.txt'], cut: false });
  });

  it('round-trips Finder’s list of paths', async () => {
    const fake = new FakeClipboard();
    const clipboard = new SystemClipboard(fake, 'darwin');
    await clipboard.writeFiles(['/Users/me/R&D <1>.txt', '/Users/me/b'], true);
    assert.deepEqual(await clipboard.readFiles(), { files: ['/Users/me/R&D <1>.txt', '/Users/me/b'], cut: false });
  });

  it('reads the first file Explorer copied', async () => {
    const fake = new FakeClipboard();
    fake.formats.set('FileNameW', Buffer.from('C:\\Users\\me\\a.txt\0', 'utf16le'));
    assert.deepEqual(await new SystemClipboard(fake, 'win32').readFiles(), { files: ['C:\\Users\\me\\a.txt'], cut: false });
  });

  it('has no files when there are none, or the clipboard cannot be read', async () => {
    const fake = new FakeClipboard();
    fake.formats.set('text/plain', Buffer.from('hello'));
    assert.deepEqual(await new SystemClipboard(fake, 'linux').readFiles(), { files: [], cut: false });
    const broken: ClipboardLike = {
      readFormat: async () => {
        throw new Error('no display');
      },
      writeFormats: async () => undefined,
    };
    assert.deepEqual(await new SystemClipboard(broken, 'linux').readFiles(), { files: [], cut: false });
  });
});
