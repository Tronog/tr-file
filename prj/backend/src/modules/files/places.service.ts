import { stat, statfs } from 'node:fs/promises';

import type { Logger } from '../../core/index.js';
import type { FilePathResolver } from './file-path.resolver.js';
import { MOUNT_KINDS, type PlaceDto, type PlaceSpaceDto, type PlacesDto, type PlacesProvider } from './models/index.js';

/** How a file system's room is read: `statfs`, injected for tests. */
export type SpaceReader = (absolute: string) => Promise<PlaceSpaceDto>;

/** `statfs(2)`: what the user may still write (`bavail`), and the whole. */
export const readSpace: SpaceReader = async (absolute) => {
  const fs = await statfs(absolute);
  return { free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize };
};

/**
 * The Places pane's data (PRD 003, §6): the root, the folder to start in, and
 * the places the host names — each proven inside the root and there as a
 * folder, or left out. A server has no places but its root; the desktop,
 * whose root is the whole file system, has the user's folders and every
 * drive and mount.
 *
 * Host paths never leave: a place is answered with its root-relative path,
 * so a server that only ever names its root discloses nothing about its disk.
 *
 * Every mount point — the root, drives, USB sticks, shares — comes with its
 * free space (PRD 001, §14.2), read as the places are asked for, so asking
 * again is how it is kept up to date. A file system that does not answer
 * within `SPACE_TIMEOUT_MS` (a share whose server has gone) is listed
 * without it rather than holding up the pane.
 */
export class PlacesService {
  /** How long a file system has to say how much room it has. */
  static readonly SPACE_TIMEOUT_MS = 1500;

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly provider: PlacesProvider,
    private readonly logger: Logger,
    private readonly space: SpaceReader = readSpace,
    private readonly spaceTimeoutMs = PlacesService.SPACE_TIMEOUT_MS,
  ) {}

  async places(): Promise<PlacesDto> {
    // Over every drive the root is no folder at all (`FilePathResolver.drives`): its drives have the space.
    const rootSpace = this.resolver.allDrives ? undefined : await this.spaceOf(this.resolver.rootPath);
    const root: PlaceDto = {
      id: 'root',
      label: this.provider.rootLabel,
      kind: 'root',
      path: '',
      ...(rootSpace === undefined ? {} : { space: rootSpace }),
    };
    let named: Awaited<ReturnType<PlacesProvider['places']>> = [];
    try {
      named = await this.provider.places();
    } catch (error) {
      // A mount table that cannot be read must not cost the user the root.
      this.logger.warn('failed to list places', { reason: error instanceof Error ? error.message : String(error) });
    }

    const seen = new Set<string>(['']);
    const places: PlaceDto[] = [root];
    const found = await Promise.all(
      named.map(async (place) => {
        const path = await this.folderPath(place.absolute);
        const space = path !== null && MOUNT_KINDS.has(place.kind) ? await this.spaceOf(place.absolute) : undefined;
        return { place, path, space };
      }),
    );
    for (const { place, path, space } of found) {
      if (path === null || seen.has(path)) {
        continue;
      }
      seen.add(path);
      places.push({ id: place.id, label: place.label, kind: place.kind, path, ...(space === undefined ? {} : { space }) });
    }

    const home = this.provider.home();
    return { home: home === null ? '' : ((await this.folderPath(home)) ?? ''), places };
  }

  /** A file system's room, or nothing when it cannot say — or not in time. */
  private async spaceOf(absolute: string): Promise<PlaceSpaceDto | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), this.spaceTimeoutMs);
      timer.unref?.();
    });
    try {
      const space = await Promise.race([this.space(absolute), late]);
      return space !== undefined && Number.isFinite(space.free) && Number.isFinite(space.total) && space.total > 0 ? space : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The root-relative path of a folder in the root, or `null`. */
  private async folderPath(absolute: string): Promise<string | null> {
    const relative = this.resolver.toRootRelative(absolute);
    if (relative === null || this.resolver.isReserved(relative)) {
      return null;
    }
    try {
      return (await stat(absolute)).isDirectory() ? relative : null;
    } catch {
      return null;
    }
  }
}
