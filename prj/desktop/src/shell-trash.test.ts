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
