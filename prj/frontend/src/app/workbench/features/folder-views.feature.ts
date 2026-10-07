import { signal } from '@angular/core';
import type { UiPanelView } from '@tr-file/file-ui';
import type { PanelSort, PanelSortKey } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

/** Where each folder's view and sort are kept; one list per backend, as bookmarks are. */
export const FOLDER_VIEWS_KEY = 'tr-file.folder-views.v1';

/** Folders remembered at most; the ones least recently chosen for go first. */
export const FOLDER_VIEWS_LIMIT = 1000;

const VIEWS: ReadonlySet<string> = new Set<UiPanelView>(['list', 'grid', 'tree']);
const SORT_KEYS: ReadonlySet<string> = new Set<PanelSortKey>(['name', 'size', 'type', 'modified']);

/** What was chosen for one folder: its view, its order, or both. */
export interface FolderView {
  readonly view?: UiPanelView;
  readonly sort?: PanelSort;
  /** When it was last chosen, for letting go of the oldest. */
  readonly at: number;
}

/**
 * How each folder is shown (PRD 004, §1.3.1): its view — details, icons,
 * tree — and its order are the folder's, not the panel's. Choosing either in
 * a folder remembers it for that folder, in the client's own storage
 * (`SettingsService`: `localStorage` in a browser, the settings file on the
 * desktop), and every panel that shows the folder, now or later, shows it
 * that way.
 *
 * A folder nothing was chosen for yet keeps what its panel last showed —
 * so walking into a new folder does not change how things look until
 * someone changes it there. A folder that is renamed or moved in the app
 * keeps what was chosen for it, and for the folders in it.
 */
export class FolderViewsFeature {
  private readonly folders = signal<ReadonlyMap<string, FolderView>>(new Map());

  constructor(private readonly parent: WorkbenchService) {
    this.folders.set(FolderViewsFeature.parse(this.parent.settings.get<unknown>(this.key)));
  }

  /** The view chosen for `path`, if one was. */
  viewOf(path: string): UiPanelView | undefined {
    return this.folders().get(path)?.view;
  }

  /** The order chosen for `path`, if one was. */
  sortOf(path: string): PanelSort | undefined {
    return this.folders().get(path)?.sort;
  }

  rememberView(path: string, view: UiPanelView): void {
    this.remember(path, { view });
  }

  rememberSort(path: string, sort: PanelSort): void {
    this.remember(path, { sort: { key: sort.key, direction: sort.direction } });
  }

  /** A folder was renamed or moved: it — and everything in it — keeps what was chosen for it. */
  relocate(move: (path: string) => string): void {
    const current = this.folders();
    if (![...current.keys()].some((path) => move(path) !== path)) {
      return;
    }
    this.save(new Map([...current].map(([path, folder]) => [move(path), folder] as const)));
  }

  private remember(path: string, choice: Omit<FolderView, 'at'>): void {
    const next = new Map(this.folders());
    const previous = next.get(path);
    // Re-inserted, so the map's order is the order folders were last chosen for.
    next.delete(path);
    next.set(path, { ...previous, ...choice, at: Date.now() });
    while (next.size > FOLDER_VIEWS_LIMIT) {
      next.delete(next.keys().next().value as string);
    }
    this.save(next);
  }

  private save(folders: ReadonlyMap<string, FolderView>): void {
    this.folders.set(folders);
    this.parent.settings.set(
      this.key,
      [...folders].map(([path, folder]) => ({ path, ...folder })),
    );
  }

  private get key(): string {
    return `${FOLDER_VIEWS_KEY}:${this.parent.connection.label() ?? 'local'}`;
  }

  /** What storage held, keeping only what still makes sense, oldest first. */
  private static parse(raw: unknown): ReadonlyMap<string, FolderView> {
    if (!Array.isArray(raw)) {
      return new Map();
    }
    const folders: [string, FolderView][] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const value = item as Record<string, unknown>;
      if (typeof value['path'] !== 'string') {
        continue;
      }
      const view = typeof value['view'] === 'string' && VIEWS.has(value['view']) ? (value['view'] as UiPanelView) : undefined;
      const sort = FolderViewsFeature.sort(value['sort']);
      if (view === undefined && sort === undefined) {
        continue;
      }
      folders.push([
        value['path'],
        {
          ...(view === undefined ? {} : { view }),
          ...(sort === undefined ? {} : { sort }),
          at: typeof value['at'] === 'number' ? value['at'] : 0,
        },
      ]);
    }
    folders.sort((a, b) => a[1].at - b[1].at);
    return new Map(folders.slice(-FOLDER_VIEWS_LIMIT));
  }

  private static sort(raw: unknown): PanelSort | undefined {
    if (typeof raw !== 'object' || raw === null) {
      return undefined;
    }
    const value = raw as Record<string, unknown>;
    return typeof value['key'] === 'string' && SORT_KEYS.has(value['key']) && (value['direction'] === 'asc' || value['direction'] === 'desc')
      ? { key: value['key'] as PanelSortKey, direction: value['direction'] }
      : undefined;
  }
}
