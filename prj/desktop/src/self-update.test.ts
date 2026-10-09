import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  appendUpdateLog,
  compareVersions,
  detectInstallation,
  FolderUpdateFeed,
  GitHubReleaseFeed,
  startDetached,
  isDistributableFor,
  SelfUpdate,
  UpdateMonitor,
  updateSource,
  type HttpFetch,
  type Installation,
  type Relaunch,
  type UpdateStatus,
} from './self-update.js';

/**
 * PRD 001, §8.6 — a new version is a file whose size or modified time is not what is installed;
 * PRD 017, §2 — found in the latest GitHub release, whose tag says its version.
 */

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
    feed: new FolderUpdateFeed(dirs.share),
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

  it('follows the GitHub releases by default, another repository or a folder when told, nothing when off', () => {
    assert.deepEqual(updateSource({}), { kind: 'github', repo: 'Tronog/tr-file' });
    assert.deepEqual(updateSource({ TR_FILE_UPDATE_REPO: 'me/fork' }), { kind: 'github', repo: 'me/fork' });
    assert.deepEqual(updateSource({ TR_FILE_UPDATE_DIR: '/tmp/x' }), { kind: 'folder', path: '/tmp/x' });
    assert.equal(updateSource({ TR_FILE_UPDATE_DIR: 'off' }), null);
    assert.equal(updateSource({ TR_FILE_UPDATE_REPO: 'off' }), null);
  });

  it('orders versions', () => {
    assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
    assert.equal(compareVersions('v1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
    assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
    assert.equal(compareVersions('latest', '1.0.0'), null);
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

/** A release asset as GitHub's API describes it, for `content` uploaded `ageMs` ago. */
function asset(name: string, content: string, ageMs = 60_000, state = 'uploaded'): GitHubAsset {
  return {
    name,
    size: Buffer.byteLength(content),
    state,
    updated_at: new Date(Date.now() - ageMs).toISOString(),
    browser_download_url: `https://github.com/o/r/releases/download/v/${name}`,
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    content,
  };
}

interface GitHubAsset {
  name: string;
  size: number;
  state: string;
  updated_at: string;
  browser_download_url: string;
  digest: string;
  content: string;
}

/** GitHub, as far as the feed asks of it: `releases/latest` (with its ETag) and the downloads. */
class FakeGitHub {
  release: { tag_name: string; assets: GitHubAsset[] } | null = null;
  /** What `releases/latest` answers instead, when set: a status and headers. */
  refuse: { status: number; headers?: Record<string, string> } | null = null;
  /** Served for a download in place of the asset's own content. */
  tampered: string | null = null;
  readonly asked: { url: string; etag: string | null; status: number }[] = [];

  readonly fetch: HttpFetch = async (url, init) => {
    const etag = new Headers(init?.headers).get('if-none-match');
    const answer = (response: Response): Response => {
      this.asked.push({ url, etag, status: response.status });
      return response;
    };
    if (url.endsWith('/releases/latest')) {
      if (this.refuse) {
        return answer(new Response('{}', this.refuse));
      }
      if (this.release === null) {
        return answer(new Response('{"message":"Not Found"}', { status: 404 }));
      }
      const body = JSON.stringify(this.release);
      const tag = `"${createHash('sha1').update(body).digest('hex')}"`;
      return answer(etag === tag ? new Response(null, { status: 304 }) : new Response(body, { status: 200, headers: { etag: tag } }));
    }
    const found = this.release?.assets.find((each) => each.browser_download_url === url);
    return answer(found ? new Response(this.tampered ?? found.content) : new Response('', { status: 404 }));
  };
}

function gitHubUpdater(github: FakeGitHub, data: string, installation: Installation): SelfUpdate {
  return new SelfUpdate({
    feed: new GitHubReleaseFeed('o/r', github.fetch, 'https://api.github.test'),
    installation,
    stateFile: join(data, 'update-state.json'),
    tempDir: join(data, 'tmp'),
  });
}

describe('GitHub releases (PRD 017, §2)', () => {
  it('offers a newer release’s distributable for this kind, never an older one', async () => {
    const dirs = await fixture('gh-newer');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'v1', 0);
    const github = new FakeGitHub();
    const install: Installation = { kind: 'appimage', path: self, version: '1.0.0' };

    // No release yet: nothing to offer, and nothing wrong.
    assert.equal(await gitHubUpdater(github, dirs.data, install).check(), null);

    github.release = {
      tag_name: 'v1.0.1',
      assets: [
        asset('tr-file-1.0.1-x86_64.AppImage', 'v1.0.1'),
        asset('tr-file-1.0.1-x64.exe', 'windows'),
        asset('tr-file-1.0.1-mac-arm64.tar.gz', 'mac'),
      ],
    };
    const candidate = await gitHubUpdater(github, dirs.data, install).check();
    assert.equal(candidate?.name, 'tr-file-1.0.1-x86_64.AppImage');
    assert.equal(candidate?.version, '1.0.1');
    assert.equal(candidate?.source, 'https://github.com/o/r/releases/download/v/tr-file-1.0.1-x86_64.AppImage');

    // A copy newer than the latest release is not offered a downgrade.
    assert.equal(await gitHubUpdater(github, dirs.data, { ...install, version: '1.1.0' }).check(), null);

    // One still uploading is not offered yet.
    github.release = { tag_name: 'v1.0.2', assets: [asset('tr-file-1.0.2-x86_64.AppImage', 'v1.0.2', 0, 'starter')] };
    assert.equal(await gitHubUpdater(github, dirs.data, install).check(), null);
  });

  it('tells a release of the same version, published again, by its files', async () => {
    const dirs = await fixture('gh-same');
    const self = join(dirs.home, 'tr-file-1.0.0-x64.exe');
    await publish(self, 'build 1', 0);
    const github = new FakeGitHub();
    const install: Installation = { kind: 'portable', path: self, version: '1.0.0' };

    github.release = { tag_name: 'v1.0.0', assets: [asset('tr-file-1.0.0-x64.exe', 'build 1', 300_000)] };
    assert.equal(await gitHubUpdater(github, dirs.data, install).check(), null);

    // Its files replaced by a rebuild (`publish:github` on a release that exists).
    github.release = { tag_name: 'v1.0.0', assets: [asset('tr-file-1.0.0-x64.exe', 'build 2', 1_000)] };
    assert.equal((await gitHubUpdater(github, dirs.data, install).check())?.name, 'tr-file-1.0.0-x64.exe');
  });

  it('asks again with the last ETag, and says when GitHub allows no more', async () => {
    const dirs = await fixture('gh-etag');
    const github = new FakeGitHub();
    github.release = { tag_name: 'v1.0.1', assets: [asset('tr-file-Setup-1.0.1-x64.exe', 'setup')] };
    const update = gitHubUpdater(github, dirs.data, { kind: 'installed', version: '1.0.0' });

    assert.equal((await update.check())?.name, 'tr-file-Setup-1.0.1-x64.exe');
    assert.equal((await update.check())?.name, 'tr-file-Setup-1.0.1-x64.exe');
    assert.deepEqual(
      github.asked.map(({ etag, status }) => [etag !== null, status]),
      [
        [false, 200],
        [true, 304],
      ],
    );

    github.refuse = { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' } };
    await assert.rejects(update.check(), /allows no more update checks/);
    github.refuse = { status: 502 };
    await assert.rejects(update.check(), /GitHub answered 502/);
  });

  it('says when GitHub cannot be reached', async () => {
    const dirs = await fixture('gh-offline');
    const feed = new GitHubReleaseFeed('o/r', async () => {
      throw new TypeError('fetch failed');
    });
    const update = new SelfUpdate({ feed, installation: { kind: 'installed', version: '1.0.0' }, stateFile: join(dirs.data, 's.json'), tempDir: dirs.data });
    await assert.rejects(update.check(), /GitHub could not be reached: fetch failed/);
  });

  it('downloads an AppImage in place of the running one, checking it against its digest', async () => {
    const dirs = await fixture('gh-apply');
    const self = join(dirs.home, 'tr-file.AppImage');
    await publish(self, 'old', 0);
    const github = new FakeGitHub();
    github.release = { tag_name: 'v1.0.1', assets: [asset('tr-file-1.0.1-x86_64.AppImage', 'new version')] };
    const update = gitHubUpdater(github, dirs.data, { kind: 'appimage', path: self, version: '1.0.0' });

    const candidate = await update.check();
    assert.ok(candidate);
    // Replaced on GitHub meanwhile, though the same size: refused, the running copy left alone.
    github.tampered = 'NEW VERSION';
    await assert.rejects(update.apply(candidate), /did not download as published/);
    assert.equal(await readFile(self, 'utf8'), 'old');
    await assert.rejects(access(join(dirs.home, '.tr-file.AppImage.update-part')));

    github.tampered = null;
    assert.deepEqual(await update.apply(candidate), { command: self, args: [] });
    assert.equal(await readFile(self, 'utf8'), 'new version');
    assert.equal((await stat(self)).mode & 0o111, 0o111);
  });

  it('downloads a newer setup into the local temporary folder, to be run silently', async () => {
    const dirs = await fixture('gh-setup');
    const github = new FakeGitHub();
    github.release = { tag_name: 'v1.0.1', assets: [asset('tr-file-Setup-1.0.1-x64.exe', 'setup 2'), asset('tr-file-1.0.1-x64.exe', 'portable')] };
    const update = gitHubUpdater(github, dirs.data, { kind: 'installed', version: '1.0.0' });

    const candidate = await update.check();
    assert.equal(candidate?.name, 'tr-file-Setup-1.0.1-x64.exe');
    const relaunch = await update.apply(candidate!);
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
