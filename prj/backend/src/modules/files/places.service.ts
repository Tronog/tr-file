import { stat } from 'node:fs/promises';

import type { Logger } from '../../core/index.js';
import type { FilePathResolver } from './file-path.resolver.js';
import type { PlaceDto, PlacesDto, PlacesProvider } from './models/index.js';

/**
 * The Places pane's data (PRD 003, §6): the root, the folder to start in, and
 * the places the host names — each proven inside the root and there as a
 * folder, or left out. A server has no places but its root; the desktop,
 * whose root is the whole file system, has the user's folders and every
 * drive and mount.
 *
 * Host paths never leave: a place is answered with its root-relative path,
 * so a server that only ever names its root discloses nothing about its disk.
 */
export class PlacesService {
  constructor(
    private readonly resolver: FilePathResolver,
    private readonly provider: PlacesProvider,
    private readonly logger: Logger,
  ) {}

  async places(): Promise<PlacesDto> {
    const root: PlaceDto = { id: 'root', label: this.provider.rootLabel, kind: 'root', path: '' };
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
      named.map(async (place) => ({ place, path: await this.folderPath(place.absolute) })),
    );
    for (const { place, path } of found) {
      if (path === null || seen.has(path)) {
        continue;
      }
      seen.add(path);
      places.push({ id: place.id, label: place.label, kind: place.kind, path });
    }

    const home = this.provider.home();
    return { home: home === null ? '' : ((await this.folderPath(home)) ?? ''), places };
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
