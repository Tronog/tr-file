import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SystemPlaces } from './system-places.js';

const MOUNTS = [
  '/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
  'proc /proc proc rw,nosuid 0 0',
  '/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
  '/dev/sdb1 /media/me/USB\\040STICK vfat rw 0 0',
  '/dev/sdc1 /run/media/me/Camera exfat rw 0 0',
  '/dev/sdd1 /mnt/backup ext4 rw 0 0',
  'server:/export /home/me/nas nfs4 rw 0 0',
  '//host/share /srv/share cifs rw 0 0',
].join('\n');

const folders: Record<string, string> = {
  desktop: '/home/me/Desktop',
  documents: '/home/me/Documents',
  downloads: '/home/me/Downloads',
  pictures: '/home/me',
};

describe('SystemPlaces (PRD 003, §6)', () => {
  it('lists home, the user folders that are not home, and what is mounted', async () => {
    const places = new SystemPlaces({
      platform: 'linux',
      home: '/home/me',
      userFolder: (name) => {
        if (name === 'videos') {
          throw new Error('no such folder');
        }
        return folders[name] ?? null;
      },
      mountTable: async () => MOUNTS,
    });

    assert.equal(places.rootLabel, 'File System');
    assert.equal(places.home(), '/home/me');
    assert.deepEqual(
      (await places.places()).map((place) => [place.kind, place.label, place.absolute]),
      [
        ['home', 'Home', '/home/me'],
        ['desktop', 'Desktop', '/home/me/Desktop'],
        ['documents', 'Documents', '/home/me/Documents'],
        ['downloads', 'Downloads', '/home/me/Downloads'],
        ['drive', 'backup', '/mnt/backup'],
        ['removable', 'Camera', '/run/media/me/Camera'],
        ['network', 'nas', '/home/me/nas'],
        ['network', 'share', '/srv/share'],
        ['removable', 'USB STICK', '/media/me/USB STICK'],
      ],
    );
  });

  it('keeps the user folders when the mount table cannot be read', async () => {
    const places = new SystemPlaces({
      platform: 'linux',
      home: '/home/me',
      userFolder: () => null,
      mountTable: async () => {
        throw new Error('EACCES');
      },
    });
    assert.deepEqual((await places.places()).map((place) => place.id), ['home']);
  });

  it('lists the drives that answer on Windows', async () => {
    const places = new SystemPlaces({
      platform: 'win32',
      home: 'C:\\Users\\me',
      userFolder: () => null,
      isFolder: async (path) => path === 'C:\\' || path === 'E:\\',
    });
    assert.equal(places.rootLabel, 'This PC');
    assert.deepEqual(
      (await places.places()).map((place) => [place.label, place.absolute]),
      [
        ['Home', 'C:\\Users\\me'],
        ['C:', 'C:\\'],
        ['E:', 'E:\\'],
      ],
    );
  });

  it('lists the volumes on macOS but the start-up disk', async () => {
    const places = new SystemPlaces({
      platform: 'darwin',
      home: '/Users/me',
      userFolder: () => null,
      volumes: async () => ['Macintosh HD', 'Backup'],
      realpath: async (path) => (path === '/Volumes/Macintosh HD' ? '/' : path),
      isFolder: async () => true,
    });
    assert.deepEqual(
      (await places.places()).map((place) => place.label),
      ['Home', 'Backup'],
    );
  });
});
