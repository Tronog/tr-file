import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { desktopEntry, desktopIconSource, desktopLaunch, ensureDesktopEntry, ensureDesktopIcon } from './desktop-entry.js';

/** PRD 001, §8.5 — on Wayland the global shortcut needs a desktop file the portal can find. */

let folder: string;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tr-file-desktop-entry-'));
});

after(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('desktopLaunch', () => {
  it('starts an AppImage from its file, a packaged binary bare, and Electron with the app folder', () => {
    assert.deepEqual(desktopLaunch({ APPIMAGE: '/opt/tr-file.AppImage' }, '/tmp/.mount_x/tr-file', '/tmp/.mount_x/app', true), {
      exec: '/opt/tr-file.AppImage',
      args: [],
    });
    assert.deepEqual(desktopLaunch({}, '/opt/tr-file/tr-file', '/opt/tr-file/resources/app.asar', true), { exec: '/opt/tr-file/tr-file', args: [] });
    assert.deepEqual(desktopLaunch({}, '/x/electron', '/src/desktop', false), { exec: '/x/electron', args: ['/src/desktop'] });
  });
});

describe('desktopEntry', () => {
  it('names the id the portal asks about, and quotes what needs quoting', () => {
    const text = desktopEntry({ exec: '/home/me/My Apps/tr-file.AppImage', args: [] });
    assert.match(text, /^\[Desktop Entry\]\n/);
    assert.match(text, /^Exec="\/home\/me\/My Apps\/tr-file\.AppImage" %U$/m);
    assert.match(text, /^StartupWMClass=tr-file$/m);
    assert.match(desktopEntry({ exec: '/x/electron', args: ['/src/desktop'] }), /^Exec=\/x\/electron \/src\/desktop %U$/m);
  });
});

describe('ensureDesktopEntry', () => {
  it('writes the entry once, and again only when the copy has moved', async () => {
    const dir = join(folder, 'applications');
    const launch = { exec: '/opt/a.AppImage', args: [] };
    assert.equal(ensureDesktopEntry(dir, launch), true);
    assert.equal(await readFile(join(dir, 'tr-file.desktop'), 'utf8'), desktopEntry(launch));
    assert.equal(ensureDesktopEntry(dir, launch), false);
    assert.equal(ensureDesktopEntry(dir, { exec: '/opt/b.AppImage', args: [] }), true);
  });
});

describe('ensureDesktopIcon', () => {
  it('finds the icon in the resources or build/, and installs it into hicolor once', async () => {
    assert.equal(desktopIconSource('/opt/res', '/opt/res/app.asar', true), join('/opt/res', 'icon.png'));
    assert.equal(desktopIconSource('/x', '/src/desktop', false), join('/src/desktop', 'build', 'icon.png'));

    const source = join(folder, 'icon.png');
    await writeFile(source, 'png');
    const dataHome = join(folder, 'share');
    assert.equal(ensureDesktopIcon(dataHome, source), true);
    assert.equal(await readFile(join(dataHome, 'icons/hicolor/512x512/apps/tr-file.png'), 'utf8'), 'png');
    assert.equal(ensureDesktopIcon(dataHome, source), false);
  });
});
