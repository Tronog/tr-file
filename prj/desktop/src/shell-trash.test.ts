import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ShellTrash } from './shell-trash.js';

/** PRD 005, §1 — the system trash, without a desktop session: Electron's call and the OS commands are stubbed. */

let home: string;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'tr-file-shell-trash-'));
  delete process.env['XDG_DATA_HOME'];
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('ShellTrash', () => {
  it('trashes through the shell', async () => {
    const seen: string[] = [];
    const trash = new ShellTrash(home, { trashItem: async (path) => void seen.push(path), platform: 'linux', home });

    const id = await trash.trash(join(home, 'a.txt'));

    assert.deepEqual(seen, [join(home, 'a.txt')]);
    assert.equal(trash.kind, 'system');
    assert.equal(id, null, 'the shell gives no id to restore by');
    assert.equal('restore' in trash, false, 'the system file manager restores, not the app');
  });

  it('empties the freedesktop home trash, counting entries', async () => {
    const dir = join(home, '.local', 'share', 'Trash');
    await mkdir(join(dir, 'files', 'folder'), { recursive: true });
    await mkdir(join(dir, 'info'), { recursive: true });
    await writeFile(join(dir, 'files', 'a.txt'), 'a');
    await writeFile(join(dir, 'info', 'a.txt.trashinfo'), '[Trash Info]');
    await writeFile(join(dir, 'info', 'folder.trashinfo'), '[Trash Info]');
    const trash = new ShellTrash(home, { trashItem: async () => undefined, platform: 'linux', home });
    const seen: [number, number | null][] = [];

    await trash.empty((done, total) => seen.push([done, total]), new AbortController().signal);

    assert.deepEqual(await readdir(join(dir, 'files')), []);
    assert.deepEqual(await readdir(join(dir, 'info')), []);
    assert.deepEqual(seen.at(-1), [2, 2]);
    assert.deepEqual(trash.affected, ['.local/share/Trash']);
    assert.ok(trash.contains(join(dir, 'files', 'x')));
    assert.ok(!trash.contains(join(home, 'Documents')));
  });

  it('lists the freedesktop home trash with where each entry was and when, newest first (PRD 001, §14.1)', async () => {
    const own = await mkdtemp(join(tmpdir(), 'tr-file-shell-trash-list-'));
    try {
      const dir = join(own, '.local', 'share', 'Trash');
      await mkdir(join(dir, 'files', 'Old Folder'), { recursive: true });
      await mkdir(join(dir, 'info'), { recursive: true });
      await writeFile(join(dir, 'files', 'notes.txt'), 'hello');
      await writeFile(join(dir, 'info', 'notes.txt.trashinfo'), '[Trash Info]\nPath=/home/me/My%20Notes/notes.txt\nDeletionDate=2026-09-27T10:00:00\n');
      await writeFile(join(dir, 'info', 'Old Folder.trashinfo'), '[Trash Info]\nPath=/home/me/Old%20Folder\nDeletionDate=2026-09-20T08:30:00\n');
      await writeFile(join(dir, 'files', 'orphan.bin'), 'x');
      const trash = new ShellTrash(own, { trashItem: async () => undefined, platform: 'linux', home: own });

      const items = await trash.list?.();

      assert.deepEqual(
        items?.map(({ id, name, location, type, size }) => ({ id, name, location, type, size })),
        [
          { id: 'notes.txt', name: 'notes.txt', location: '/home/me/My Notes/notes.txt', type: 'file', size: 5 },
          { id: 'Old Folder', name: 'Old Folder', location: '/home/me/Old Folder', type: 'directory', size: 0 },
          { id: 'orphan.bin', name: 'orphan.bin', location: null, type: 'file', size: 1 },
        ],
      );
      assert.equal(items?.[0]?.deletedAt, new Date('2026-09-27T10:00:00').toISOString());
      assert.equal(items?.[2]?.deletedAt, null);
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('cannot list the system trash on macOS or Windows', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const trash = new ShellTrash(home, { trashItem: async () => undefined, platform, home });
      assert.equal(trash.list, undefined);
    }
  });

  it('asks Finder on macOS and the Recycle Bin on Windows, without a count', async () => {
    const calls: string[] = [];
    const exec = async (file: string) => void calls.push(file);
    const seen: (number | null)[] = [];

    for (const platform of ['darwin', 'win32'] as const) {
      const trash = new ShellTrash('/elsewhere', { trashItem: async () => undefined, platform, home, exec });
      await trash.empty((_done, total) => seen.push(total), new AbortController().signal);
      assert.deepEqual(trash.affected, []);
    }

    assert.deepEqual(calls, ['osascript', 'powershell.exe']);
    assert.deepEqual(seen, [null, null]);
  });
});
