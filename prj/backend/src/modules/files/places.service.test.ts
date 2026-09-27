import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Logger } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';
import { NO_PLACES, type PlacesProvider } from './models/index.js';
import { PlacesService } from './places.service.js';

describe('PlacesService (PRD 003, §6)', () => {
  let workspace: string;
  let root: string;

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'tr-file-places-'));
    root = join(workspace, 'root');
    await mkdir(join(root, 'home', 'me', 'Downloads'), { recursive: true });
    await mkdir(join(root, 'media', 'usb'), { recursive: true });
    await mkdir(join(root, '.trash'), { recursive: true });
    await writeFile(join(root, 'file.txt'), 'x');
    await mkdir(join(workspace, 'outside'), { recursive: true });
  });

  after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('lists only the root for a server', async () => {
    const service = new PlacesService(new FilePathResolver(root), NO_PLACES, Logger.create('error'));
    assert.deepEqual(await service.places(), {
      home: '',
      places: [{ id: 'root', label: 'Files', kind: 'root', path: '' }],
    });
  });

  it('answers the places inside the root as root-relative folders, and leaves out the rest', async () => {
    const provider: PlacesProvider = {
      rootLabel: 'File System',
      home: () => join(root, 'home', 'me'),
      places: async () => [
        { id: 'home', label: 'Home', kind: 'home', absolute: join(root, 'home', 'me') },
        { id: 'downloads', label: 'Downloads', kind: 'downloads', absolute: join(root, 'home', 'me', 'Downloads') },
        { id: 'documents', label: 'Documents', kind: 'documents', absolute: join(root, 'home', 'me', 'Documents') },
        { id: 'file', label: 'A file', kind: 'drive', absolute: join(root, 'file.txt') },
        { id: 'outside', label: 'Outside', kind: 'drive', absolute: join(workspace, 'outside') },
        { id: 'trash', label: 'Trash', kind: 'drive', absolute: join(root, '.trash') },
        { id: 'usb', label: 'usb', kind: 'removable', absolute: join(root, 'media', 'usb') },
        { id: 'usb-again', label: 'usb', kind: 'removable', absolute: join(root, 'media', 'usb') },
      ],
    };
    const service = new PlacesService(new FilePathResolver(root, ['.trash']), provider, Logger.create('error'));
    const answer = await service.places();

    assert.equal(answer.home, 'home/me');
    assert.deepEqual(
      answer.places.map((place) => [place.id, place.path]),
      [
        ['root', ''],
        ['home', 'home/me'],
        ['downloads', 'home/me/Downloads'],
        ['usb', 'media/usb'],
      ],
    );
    assert.equal(answer.places[0]?.label, 'File System');
  });

  it('keeps the root when the system cannot say what else there is', async () => {
    const provider: PlacesProvider = {
      rootLabel: 'File System',
      home: () => join(workspace, 'outside'),
      places: async () => {
        throw new Error('no mount table');
      },
    };
    const service = new PlacesService(new FilePathResolver(root), provider, Logger.create('error'));
    assert.deepEqual(await service.places(), {
      home: '',
      places: [{ id: 'root', label: 'File System', kind: 'root', path: '' }],
    });
  });
});
