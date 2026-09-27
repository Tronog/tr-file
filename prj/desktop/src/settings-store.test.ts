import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SETTINGS_MAX_VALUE_BYTES, SettingsError, SettingsStore } from './settings-store.js';

describe('SettingsStore (PRD 003, §6)', () => {
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tr-file-settings-'));
  });

  after(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('keeps values across instances, as plain JSON', async () => {
    const file = join(folder, 'a', 'settings.json');
    const store = new SettingsStore(file);
    assert.deepEqual(store.all(), {});

    await store.set('session.v1:local', { groups: [1, 2], when: undefined });
    await store.set('bookmarks.v1:local', ['home/me']);
    await store.set('bookmarks.v1:local', null);

    const again = new SettingsStore(file);
    assert.deepEqual(again.all(), { 'session.v1:local': { groups: [1, 2] } });
  });

  it('folds changes made during a write into one more write', async () => {
    const file = join(folder, 'burst.json');
    const store = new SettingsStore(file);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.set('count', index)));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { count: 19 });
  });

  it('starts empty from a file that is not settings', async () => {
    const file = join(folder, 'broken.json');
    await writeFile(file, '{ not json');
    assert.deepEqual(new SettingsStore(file).all(), {});
    await writeFile(file, '[1,2]');
    assert.deepEqual(new SettingsStore(file).all(), {});
  });

  it('refuses bad keys and values that are too big', async () => {
    const store = new SettingsStore(join(folder, 'refused.json'));
    await assert.rejects(() => store.set('../etc', 1), SettingsError);
    await assert.rejects(() => store.set(42, 1), SettingsError);
    await assert.rejects(() => store.set('big', 'x'.repeat(SETTINGS_MAX_VALUE_BYTES)), SettingsError);
    await assert.rejects(() => store.set('fn', () => 1), SettingsError);
  });
});
