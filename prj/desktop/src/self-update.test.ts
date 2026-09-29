import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  appendUpdateLog,
  detectInstallation,
  startDetached,
  isDistributableFor,
  SelfUpdate,
  UpdateMonitor,
  updateSource,
  type Installation,
  type Relaunch,
  type UpdateStatus,
} from './self-update.js';

/** PRD 001, §8.6 — a new version is a file on the share whose name, size or modified time is not what is installed. */

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-update-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A fresh share, install folder and user-data folder. */
async function fixture(name: string): Promise<{ share: string; home: string; data: string }> {
  const base = join(root, name);
  const share = join(base, 'share');
  const home = join(base, 'home');
  const data = join(base, 'data');
  await Promise.all([mkdir(share, { recursive: true }), mkdir(home, { recursive: true }), mkdir(data, { recursive: true })]);
  return { share, home, data };
}

/** Writes a file dated `ageMs` ago. */
async function publish(path: string, content: string, ageMs = 60_000): Promise<void> {
  await writeFile(path, content);
  const time = new Date(Date.now() - ageMs);
  await utimes(path, time, time);
}

function updater(dirs: { share: string; data: string }, installation: Installation): SelfUpdate {
  return new SelfUpdate({
    source: dirs.share,
    installation,
    stateFile: join(dirs.data, 'update-state.json'),
    tempDir: join(dirs.data, 'tmp'),
  });
}

describe('which copy is running', () => {
  it('reads the launchers’ environment, and turns updating off in a development run', () => {
    assert.deepEqual(detectInstallation('linux', { APPIMAGE: '/opt/tr-file.AppImage' }, true, '1.0.0'), {
      kind: 'appimage',
      path: '/opt/tr-file.AppImage',
      version: '1.0.0',
    });
    assert.equal(detectInstallation('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\tr-file.exe' }, true, '1.0.0')?.kind, 'portable');
    assert.equal(detectInstallation('win32', {}, true, '1.0.0')?.kind, 'installed');
    assert.equal(detectInstallation('linux', {}, true, '1.0.0'), null);
    assert.equal(detectInstallation('linux', { APPIMAGE: '/x' }, false, '1.0.0'), null);
    assert.equal(detectInstallation('darwin', {}, true, '1.0.0'), null);
  });

  it('looks on the share by default, elsewhere when told, nowhere when off', () => {
    assert.equal(updateSource('linux', {}), '/S/Library/Software/Applications/Tronog/TR-File');
    assert.equal(updateSource('win32', {}), 'S:\\Library\\Software\\Applications\\Tronog\\TR-File');
    assert.equal(updateSource('linux', { TR_FILE_UPDATE_DIR: '/tmp/x' }), '/tmp/x');
    assert.equal(updateSource('linux', { TR_FILE_UPDATE_DIR: 'off' }), null);
    assert.equal(updateSource('darwin', {}), null);
  });

  it('matches each kind to its own distributable', () => {
    assert.ok(isDistributableFor('appimage', 'tr-file-1.0.1-x86_64.AppImage'));
    assert.ok(!isDistributableFor('appimage', 'tr-file-1.0.1-x64.exe'));
    assert.ok(isDistributableFor('portable', 'tr-file-1.0.1-x64.exe'));
    assert.ok(!isDistributableFor('portable', 'tr-file-Setup-1.0.1-x64.exe'));
    assert.ok(isDistributableFor('installed', 'tr-file-Setup-1.0.1-x64.exe'));
    assert.ok(!isDistributableFor('installed', 'tr-file-1.0.1-x64.exe'));
    assert.ok(!isDistributableFor('appimage', '.tr-file.AppImage.update-part'));
  });
});

describe('SelfUpdate', () => {
  it('says when the share cannot be read, and offers nothing when it holds what is running', async () => {
    const dirs = await fixture('same');
    const self = join(dirs.home, 'tr-file-1.0.0-x86_64.AppImage');
    await publish(self, 'v1', 0);
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };

    await assert.rejects(updater({ share: join(dirs.share, 'none'), data: dirs.data }, install).check(), /could not be read/);

    // Copied by hand: the same name and size, though the copy's time is its own.
    await publish(join(dirs.share, 'tr-file-1.0.0-x86_64.AppImage'), 'v1', 120_000);
    assert.equal(await updater(dirs, install).check(), null);
    // …and from then on the share's key is recorded.
    const recorded = JSON.parse(await readFile(join(dirs.data, 'update-state.json'), 'utf8')) as { installed: { name: string } };
    assert.equal(recorded.installed.name, 'tr-file-1.0.0-x86_64.AppImage');
  });

  it('offers the newest distributable whose key differs, once it has stood still', async () => {
    const dirs = await fixture('newer');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'v1', 0);
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };
    await publish(join(dirs.share, 'tr-file-1.0.0-x86_64.AppImage'), 'v1', 300_000);
    await publish(join(dirs.share, 'tr-file-1.0.1-x86_64.AppImage'), 'v1.0.1', 200_000);
    await publish(join(dirs.share, 'tr-file-1.0.1-x64.exe'), 'windows', 100_000);

    assert.equal((await updater(dirs, install).check())?.name, 'tr-file-1.0.1-x86_64.AppImage');

    // One still being copied is not offered yet.
    await publish(join(dirs.share, 'tr-file-1.0.2-x86_64.AppImage'), 'v1.0', 1_000);
    assert.equal((await updater(dirs, install).check())?.name, 'tr-file-1.0.1-x86_64.AppImage');
  });

  it('knows a file republished under the same name by its size and time', async () => {
    const dirs = await fixture('republished');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'v1', 0);
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };
    const published = join(dirs.share, 'tr-file.AppImage');
    await publish(published, 'v1', 300_000);
    assert.equal(await updater(dirs, install).check(), null);

    await publish(published, 'v2', 100_000);
    assert.equal((await updater(dirs, install).check())?.name, 'tr-file.AppImage');
  });

  it('knows a new version by size and time alone — the name may stay the same', async () => {
    const dirs = await fixture('same-name');
    const self = join(dirs.home, 'tr-file.exe');
    await publish(self, 'v1', 0);
    const install: Installation = { kind: 'portable', path: self, version: '1.0.0' };
    const published = join(dirs.share, 'tr-file.exe');
    await publish(published, 'v1', 300_000);
    assert.equal(await updater(dirs, install).check(), null);

    // Republished under the very same name, one byte longer…
    await publish(published, 'v1b', 200_000);
    assert.equal((await updater(dirs, install).check())?.name, 'tr-file.exe');
    // …or the same size, but newer.
    await publish(published, 'v1', 100_000);
    assert.equal((await updater(dirs, install).check())?.name, 'tr-file.exe');
  });

  it('runs a newer portable .exe from the local temporary folder, leaving the old one alone', async () => {
    const dirs = await fixture('portable');
    const self = join(dirs.home, 'tr-file.exe');
    await publish(self, 'old', 0);
    await publish(join(dirs.share, 'tr-file.exe'), 'new version', 100_000);

    const update = updater(dirs, { kind: 'portable', path: self, version: '1.0.0' });
    const candidate = await update.check();
    assert.ok(candidate);
    const relaunch = await update.apply(candidate);

    assert.equal(dirname(dirname(relaunch.command)), join(dirs.data, 'tmp'));
    assert.equal(basename(relaunch.command), 'tr-file.exe');
    assert.equal(await readFile(relaunch.command, 'utf8'), 'new version');
    assert.equal(await readFile(self, 'utf8'), 'old');

    // Started from there, it is up to date — and keeps its own folder when cleaning up.
    const upgraded = updater(dirs, { kind: 'portable', path: relaunch.command, version: '1.0.1' });
    await mkdir(join(dirs.data, 'tmp', 'stale'));
    await upgraded.cleanUp();
    await access(relaunch.command);
    await assert.rejects(access(join(dirs.data, 'tmp', 'stale')));
    assert.equal(await upgraded.check(), null);

    // The old one, started from its old shortcut, is still offered the new version.
    assert.equal((await updater(dirs, { kind: 'portable', path: self, version: '1.0.0' }).check())?.name, 'tr-file.exe');
  });

  it('puts an AppImage in place of the running one, keeping its path, and records it', async () => {
    const dirs = await fixture('apply');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'old', 0);
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };
    await publish(join(dirs.share, 'tr-file-1.0.1-x86_64.AppImage'), 'new version', 100_000);

    const update = updater(dirs, install);
    const candidate = await update.check();
    assert.ok(candidate);
    const relaunch = await update.apply(candidate);

    assert.deepEqual(relaunch, { command: self, args: [] });
    assert.equal(await readFile(self, 'utf8'), 'new version');
    assert.equal((await stat(self)).mode & 0o111, 0o111);
    assert.equal(await update.check(), null);
  });

  it('refuses a file that changed since it was offered, leaving the running copy', async () => {
    const dirs = await fixture('changed');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'old', 0);
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };
    const published = join(dirs.share, 'tr-file-1.0.1-x86_64.AppImage');
    await publish(published, 'new build', 100_000);

    const update = updater(dirs, install);
    const candidate = await update.check();
    assert.ok(candidate);
    await publish(published, 'newer still', 0);

    await assert.rejects(update.apply(candidate), /changed since it was offered/);
    assert.equal(await readFile(self, 'utf8'), 'old');
  });

  it('runs a newer setup silently for an installed copy', async () => {
    const dirs = await fixture('installed');
    const install: Installation = { kind: 'installed', version: '1.0.0' };
    await publish(join(dirs.share, 'tr-file-Setup-1.0.0-x64.exe'), 'setup 1', 300_000);
    assert.equal(await updater(dirs, install).check(), null);

    await publish(join(dirs.share, 'tr-file-Setup-1.0.1-x64.exe'), 'setup 2', 100_000);
    const update = updater(dirs, install);
    const candidate = await update.check();
    assert.equal(candidate?.name, 'tr-file-Setup-1.0.1-x64.exe');
    const relaunch = await update.apply(candidate!);
    // Run from the local temporary folder: a program on the share will not run.
    assert.equal(relaunch.command, join(dirs.data, 'tmp', 'setup', 'tr-file-Setup-1.0.1-x64.exe'));
    assert.deepEqual(relaunch.args, ['--updated', '/S', '--force-run']);
    assert.equal(await readFile(relaunch.command, 'utf8'), 'setup 2');
  });
});

describe('UpdateMonitor', () => {
  it('reports a newer version, and restarts into it when asked', async () => {
    const dirs = await fixture('monitor');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'old', 0);
    await publish(join(dirs.share, 'tr-file-1.0.1-x86_64.AppImage'), 'new build', 100_000);

    const statuses: UpdateStatus[] = [];
    const restarts: Relaunch[] = [];
    const monitor = new UpdateMonitor(updater(dirs, { kind: 'appimage', path: self, version: '1.0.0' }), {
      changed: (status) => statuses.push(status),
      restart: async (relaunch) => void restarts.push(relaunch),
      log: () => undefined,
    });
    await monitor.start();
    monitor.stop();

    assert.deepEqual(monitor.status, { available: 'tr-file-1.0.1-x86_64.AppImage', upgrading: false });
    assert.equal(await monitor.upgrade(), null);
    assert.deepEqual(restarts, [{ command: self, args: [] }]);
    assert.deepEqual(statuses.at(-1), { available: 'tr-file-1.0.1-x86_64.AppImage', upgrading: true });
  });

  it('says why when there is nothing to upgrade to', async () => {
    const dirs = await fixture('nothing');
    const monitor = new UpdateMonitor(updater(dirs, { kind: 'installed', version: '1.0.0' }), {
      changed: () => undefined,
      restart: async () => assert.fail('nothing to restart into'),
      log: () => undefined,
    });
    assert.match((await monitor.upgrade()) ?? '', /no newer version/);
  });

  it('answers a check asked for with why the share could not be read, logging it once', async () => {
    const dirs = await fixture('unreachable');
    const logged: string[] = [];
    const monitor = new UpdateMonitor(updater({ share: join(dirs.share, 'gone'), data: dirs.data }, { kind: 'installed', version: '1.0.0' }), {
      changed: () => undefined,
      restart: async () => undefined,
      log: (message) => logged.push(message),
    });
    assert.match((await monitor.check()) ?? '', /could not be read/);
    assert.match((await monitor.check()) ?? '', /could not be read/);
    assert.deepEqual(logged, ['update check failed']);

    await mkdir(join(dirs.share, 'gone'));
    assert.equal(await monitor.check(), null);
    assert.deepEqual(monitor.status, { available: null, upgrading: false });
  });
});

describe('starting the new version', () => {
  it('starts the new copy as a process of its own, from its own folder, with what it is given', { skip: process.platform === 'win32' }, async () => {
    const dirs = await fixture('relaunch');
    const done = join(dirs.data, 'started');
    const program = join(dirs.home, 'new-version.sh');
    await writeFile(program, `#!/bin/sh\necho "$PWD $* $PORTABLE_EXECUTABLE_FILE" > "${done}"\n`, { mode: 0o755 });

    process.env['PORTABLE_EXECUTABLE_FILE'] = 'C:\\old\\tr-file.exe';
    try {
      await startDetached({ command: program, args: ['--tr-file-upgraded'] });
    } finally {
      delete process.env['PORTABLE_EXECUTABLE_FILE'];
    }
    for (let i = 0; i < 50 && !(await access(done).then(() => true, () => false)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // In its own folder, with its flag — and none of the old launcher's variables.
    assert.equal((await readFile(done, 'utf8')).trim(), `${dirs.home} --tr-file-upgraded`);
  });

  it('rejects when the new copy cannot be started', async () => {
    await assert.rejects(startDetached({ command: join(root, 'no-such-program'), args: [] }), /could not be started/);
  });

  it('says so, rather than quitting into nothing, when the new version cannot start', async () => {
    const dirs = await fixture('no-helper');
    await publish(join(dirs.share, 'tr-file-1.0.1-x86_64.AppImage'), 'new build', 100_000);
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'old', 0);
    const monitor = new UpdateMonitor(updater(dirs, { kind: 'appimage', path: self, version: '1.0.0' }), {
      changed: () => undefined,
      restart: async () => {
        throw new Error('The upgrade could not be started: spawn ENOENT');
      },
      log: () => undefined,
    });
    assert.match((await monitor.upgrade()) ?? '', /could not be started/);
    assert.deepEqual(monitor.status, { available: 'tr-file-1.0.1-x86_64.AppImage', upgrading: false });
  });

  it('keeps a log to read afterwards', async () => {
    const dirs = await fixture('log');
    const file = join(dirs.data, 'update.log');
    appendUpdateLog(file, 'upgrading', { to: 'tr-file.exe' });
    assert.match(await readFile(file, 'utf8'), /^\S+Z upgrading \{"to":"tr-file.exe"\}\n$/);
    appendUpdateLog(join(dirs.data, 'missing', 'x.log'), 'nowhere');
  });
});
