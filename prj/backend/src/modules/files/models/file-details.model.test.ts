import assert from 'node:assert/strict';
import type { Stats } from 'node:fs';
import { describe, it } from 'node:test';

import { FileDetails } from './file-details.model.js';

/** Minimal `fs.Stats` stand-in: only the fields the model actually reads. */
function statsOf(overrides: Partial<Stats> & { mode: number }): Stats {
  const now = new Date('2024-05-01T12:00:00.000Z');
  return {
    size: 10,
    blocks: 8,
    uid: 1000,
    gid: 1000,
    ino: 42,
    atime: now,
    mtime: now,
    ctime: now,
    birthtime: now,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  } as unknown as Stats;
}

describe('FileDetails.formatMode', () => {
  it('renders the permission bits as four octal digits', () => {
    assert.equal(FileDetails.formatMode(0o644), '0644');
    assert.equal(FileDetails.formatMode(0o755), '0755');
    assert.equal(FileDetails.formatMode(0o4755), '4755');
    assert.equal(FileDetails.formatMode(0o7), '0007');
  });

  it('ignores the file-type bits carried in the same field', () => {
    // 0o100644 is a regular file with mode 0644.
    assert.equal(FileDetails.formatMode(0o100644), '0644');
    assert.equal(FileDetails.formatMode(0o040755), '0755');
  });
});

describe('FileDetails.permissionsOf', () => {
  it('splits the nine permission bits into triplets', () => {
    assert.deepEqual(FileDetails.permissionsOf(0o100640), {
      owner: { read: true, write: true, execute: false },
      group: { read: true, write: false, execute: false },
      others: { read: false, write: false, execute: false },
    });
  });

  it('marks every bit for 0777 and none for 0000', () => {
    const all = { read: true, write: true, execute: true };
    assert.deepEqual(FileDetails.permissionsOf(0o777), { owner: all, group: all, others: all });

    const none = { read: false, write: false, execute: false };
    assert.deepEqual(FileDetails.permissionsOf(0o000), { owner: none, group: none, others: none });
  });

  it('maps execute-only bits to the execute flag alone', () => {
    assert.deepEqual(FileDetails.permissionsOf(0o111), {
      owner: { read: false, write: false, execute: true },
      group: { read: false, write: false, execute: true },
      others: { read: false, write: false, execute: true },
    });
  });
});

describe('FileDetails.guessMimeType', () => {
  it('recognises common web, image and archive extensions', () => {
    assert.equal(FileDetails.guessMimeType('index.html'), 'text/html');
    assert.equal(FileDetails.guessMimeType('app.JS'), 'text/javascript');
    assert.equal(FileDetails.guessMimeType('logo.png'), 'image/png');
    assert.equal(FileDetails.guessMimeType('photo.JPEG'), 'image/jpeg');
    assert.equal(FileDetails.guessMimeType('bundle.zip'), 'application/zip');
    assert.equal(FileDetails.guessMimeType('notes.md'), 'text/markdown');
  });

  it('returns null without an extension or for unknown ones', () => {
    assert.equal(FileDetails.guessMimeType('Makefile'), null);
    assert.equal(FileDetails.guessMimeType('archive.qqq'), null);
    assert.equal(FileDetails.guessMimeType(''), null);
  });
});

describe('FileDetails.fromStats', () => {
  it('derives sizeOnDisk from the 512-byte block count', () => {
    const details = FileDetails.fromStats('a/b.txt', statsOf({ mode: 0o100644, blocks: 8 }));
    assert.equal(details.sizeOnDisk, 4096);
    assert.equal(details.toJSON().sizeOnDisk, 4096);
  });

  it('exposes the shared entry fields alongside the extras', () => {
    const dto = FileDetails.fromStats('docs/a.txt', statsOf({ mode: 0o100644 })).toJSON();
    assert.equal(dto.name, 'a.txt');
    assert.equal(dto.path, 'docs/a.txt');
    assert.equal(dto.type, 'file');
    assert.equal(dto.parent, 'docs');
    assert.equal(dto.mode, '0644');
    assert.equal(dto.mimeType, 'text/plain');
    assert.equal(dto.inode, 42);
    assert.equal(dto.symlinkTarget, null);
    assert.equal(dto.entryCount, null);
  });

  it('reports a null parent at the root and an empty parent one level down', () => {
    assert.equal(FileDetails.fromStats('', statsOf({ mode: 0o40755 })).parent, null);
    assert.equal(FileDetails.fromStats('a.txt', statsOf({ mode: 0o100644 })).parent, '');
  });

  it('never guesses a mime type for a directory', () => {
    const stats = statsOf({ mode: 0o40755, isDirectory: () => true, isFile: () => false });
    assert.equal(FileDetails.fromStats('assets.zip', stats).mimeType, null);
  });
});
