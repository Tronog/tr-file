import { computed, signal } from '@angular/core';
import type { UiContextMenuRequest, UiIconName, UiTreeNode } from '@tr-file/ui';
import type { FsPlaceKind, FsPlaces } from '../../file-system/file-system.model';
import type { WorkbenchService } from '../workbench.service';

/** Settings keys of the user's own places; the backend they belong to is appended. */
export const BOOKMARKS_KEY = 'tr-file.bookmarks.v1';
export const RECENT_KEY = 'tr-file.recent.v1';

/** How many recent folders are kept. */
export const RECENT_LIMIT = 12;

/** A folder the user pinned, and what they call it. */
export interface Bookmark {
  readonly path: string;
  readonly label: string;
}

/** Which of the Places panes a row is in; its tree id is `<section>:<path>`. */
export type PlaceSection = 'place' | 'bookmark' | 'recent';

const ICONS: Readonly<Record<FsPlaceKind, UiIconName>> = {
  root: 'device-hdd',
  home: 'home',
  desktop: 'desktop',
  documents: 'file-text',
  downloads: 'download',
  pictures: 'photo',
  music: 'music',
  videos: 'movie',
  drive: 'device-hdd',
  removable: 'usb',
  network: 'network',
};

/**
 * What a file manager's sidebar lists above the tree (PRD 003, §6): *Places*
 * — the root, the home folder and the user's folders, drives, USB sticks and
 * network mounts, as the backend names them — *Bookmarks*, folders the user
 * pinned, and *Recent*, the folders last opened.
 *
 * Places are the backend's (`/api/fs/places`): a server names its root only,
 * the desktop names the machine's. Bookmarks and recent folders are the
 * user's, kept in the settings *per backend* — a path on this computer means
 * nothing on a remote server. Clicking any of them shows the folder in the
 * active panel, as a click in the tree does.
 */
export class PlacesFeature {
  private readonly answer = signal<FsPlaces | null>(null);
  /** The request in flight, or answered: places are asked for once per window. */
  private loading: Promise<FsPlaces | null> | null = null;
  private readonly bookmarkList = signal<readonly Bookmark[]>([]);
  private readonly recentList = signal<readonly string[]>([]);

  constructor(private readonly parent: WorkbenchService) {
    this.bookmarkList.set(this.loadBookmarks());
    this.recentList.set(this.loadRecent());
  }

  /** What the root is called: the backend's name for it, or the workspace's until it says. */
  readonly rootLabel = computed(
    () => this.answer()?.places.find((place) => place.kind === 'root')?.label ?? this.parent.mockWorkbench.workspaceName,
  );

  /** The folder a fresh session starts in; `''` until the backend has said. */
  readonly home = computed(() => this.answer()?.home ?? '');

  readonly bookmarks = this.bookmarkList.asReadonly();
  readonly recent = this.recentList.asReadonly();

  /**
   * Asks the backend for its places. A backend that cannot say leaves the
   * root as the only place, and the session starts there.
   */
  load(): Promise<FsPlaces | null> {
    this.loading ??= this.parent.fileSystem.readFt.places().then(
      (places) => {
        this.answer.set(places);
        return places;
      },
      () => {
        this.loading = null; // Asked again next time.
        return null;
      },
    );
    return this.loading;
  }

  /* -- the panes ------------------------------------------------------------ */

  readonly placeNodes = computed<readonly UiTreeNode[]>(() =>
    (this.answer()?.places ?? []).map((place) => this.node('place', place.path, place.label, ICONS[place.kind])),
  );

  readonly bookmarkNodes = computed<readonly UiTreeNode[]>(() =>
    this.bookmarkList().map((bookmark) => this.node('bookmark', bookmark.path, bookmark.label, 'star')),
  );

  readonly recentNodes = computed<readonly UiTreeNode[]>(() =>
    this.recentList().map((path) => this.node('recent', path, this.labelFor(path), 'history', PlacesFeature.parentLabel(path))),
  );

  /** A row was clicked: its folder, in the active panel. */
  open(nodeId: string): void {
    const path = PlacesFeature.pathOf(nodeId);
    if (path === null) {
      return;
    }
    const groupId = this.parent.activeGroupId();
    this.parent.fileBrowserFt.openFolder(groupId, path, this.labelFor(path));
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** A folder of the Places panes in a new panel beside the active one. */
  openAside(path: string): void {
    const groupId = this.parent.editorGroupsFt.openBeside(this.parent.activeGroupId(), 'right', (id) => ({
      id: `tab-${id}`,
      label: this.labelFor(path),
      path,
      kind: 'folder',
    }));
    if (groupId === undefined) {
      return;
    }
    this.parent.panelHistoryFt.record(groupId, path);
    this.recordRecent(path);
    this.parent.fsDataFt.ensureListing(path);
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** A row was right-clicked: the Places menu, for its section. */
  openMenu(request: UiContextMenuRequest): void {
    if (request.target === null) {
      return;
    }
    const path = PlacesFeature.pathOf(request.target);
    const section = PlacesFeature.sectionOf(request.target);
    if (path === null || section === null) {
      return;
    }
    this.parent.contextMenuFt.openOnPlace(request, section, path);
  }

  /* -- bookmarks ----------------------------------------------------------- */

  isBookmarked(path: string): boolean {
    return this.bookmarkList().some((bookmark) => bookmark.path === path);
  }

  /** Pins a folder at the end of the list; one already pinned stays where it is. */
  addBookmark(path: string): void {
    if (this.isBookmarked(path)) {
      return;
    }
    this.saveBookmarks([...this.bookmarkList(), { path, label: this.labelFor(path) }]);
  }

  removeBookmark(path: string): void {
    this.saveBookmarks(this.bookmarkList().filter((bookmark) => bookmark.path !== path));
  }

  /** Moves a bookmark one place up (`-1`) or down (`1`). */
  moveBookmark(path: string, by: -1 | 1): void {
    const list = [...this.bookmarkList()];
    const at = list.findIndex((bookmark) => bookmark.path === path);
    const to = at + by;
    if (at === -1 || to < 0 || to >= list.length) {
      return;
    }
    [list[at], list[to]] = [list[to] as Bookmark, list[at] as Bookmark];
    this.saveBookmarks(list);
  }

  canMoveBookmark(path: string, by: -1 | 1): boolean {
    const at = this.bookmarkList().findIndex((bookmark) => bookmark.path === path);
    return at !== -1 && at + by >= 0 && at + by < this.bookmarkList().length;
  }

  /** Renames a bookmark's label — not the folder. */
  renameBookmark(path: string, label: string): void {
    const trimmed = label.trim();
    if (trimmed === '') {
      return;
    }
    this.saveBookmarks(this.bookmarkList().map((bookmark) => (bookmark.path === path ? { ...bookmark, label: trimmed } : bookmark)));
  }

  /** Asks for a bookmark's new label. */
  async promptRenameBookmark(path: string): Promise<void> {
    const bookmark = this.bookmarkList().find((candidate) => candidate.path === path);
    if (bookmark === undefined) {
      return;
    }
    const label = await this.parent.modal.prompt({
      message: `Rename the bookmark for /${path}`,
      detail: 'Only the bookmark is renamed; the folder keeps its name.',
      label: 'Bookmark name',
      value: bookmark.label,
      confirmLabel: 'Rename',
      validate: (value) => (value.trim() === '' ? 'A bookmark needs a name.' : null),
    });
    if (label !== null) {
      this.renameBookmark(path, label);
    }
  }

  /* -- recent folders ------------------------------------------------------ */

  /** A folder was opened: it goes to the top of the recent list. The root and home are places already. */
  recordRecent(path: string): void {
    if (path === '' || path === this.home()) {
      return;
    }
    const list = [path, ...this.recentList().filter((candidate) => candidate !== path)].slice(0, RECENT_LIMIT);
    if (list.join('\n') !== this.recentList().join('\n')) {
      this.saveRecent(list);
    }
  }

  removeRecent(path: string): void {
    this.saveRecent(this.recentList().filter((candidate) => candidate !== path));
  }

  clearRecent(): void {
    this.saveRecent([]);
  }

  /**
   * Renamed or moved entries (Rename, a move, Undo): bookmarks and recent
   * folders follow them, as the panels do.
   */
  relocate(move: (path: string) => string): void {
    const bookmarks = this.bookmarkList();
    if (bookmarks.some((bookmark) => move(bookmark.path) !== bookmark.path)) {
      this.saveBookmarks(
        bookmarks.map((bookmark) => {
          const path = move(bookmark.path);
          // A label that was the folder's name follows the name; one the user chose stays.
          const label = path !== bookmark.path && bookmark.label === this.labelFor(bookmark.path) ? this.labelFor(path) : bookmark.label;
          return { path, label };
        }),
      );
    }
    const recent = this.recentList();
    if (recent.some((path) => move(path) !== path)) {
      this.saveRecent([...new Set(recent.map(move))]);
    }
  }

  /**
   * Entries that are gone for good — trashed, deleted: a recent folder that
   * was one of them, or inside one, goes. A bookmark stays, as in every file
   * manager: the folder may be back, and the user said to keep it.
   */
  forget(paths: readonly string[]): void {
    const gone = (path: string): boolean => paths.some((removed) => path === removed || path.startsWith(`${removed}/`));
    const recent = this.recentList();
    if (recent.some(gone)) {
      this.saveRecent(recent.filter((path) => !gone(path)));
    }
  }

  /* -- storage --------------------------------------------------------------- */

  /** Which backend the user's places belong to: this computer's, or a remote server. */
  private get scope(): string {
    return this.parent.connection.label() ?? 'local';
  }

  private loadBookmarks(): readonly Bookmark[] {
    const raw = this.parent.settings.get<unknown>(`${BOOKMARKS_KEY}:${this.scope}`);
    return Array.isArray(raw)
      ? raw.filter(
          (item): item is Bookmark =>
            typeof item === 'object' && item !== null && typeof (item as Bookmark).path === 'string' && typeof (item as Bookmark).label === 'string',
        )
      : [];
  }

  private loadRecent(): readonly string[] {
    const raw = this.parent.settings.get<unknown>(`${RECENT_KEY}:${this.scope}`);
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : [];
  }

  private saveBookmarks(list: readonly Bookmark[]): void {
    this.bookmarkList.set(list);
    this.parent.settings.set(`${BOOKMARKS_KEY}:${this.scope}`, list);
  }

  private saveRecent(list: readonly string[]): void {
    this.recentList.set(list);
    this.parent.settings.set(`${RECENT_KEY}:${this.scope}`, list);
  }

  /* -- helpers ------------------------------------------------------------- */

  /**
   * One row. The hint beside a label is kept short — a whole path would push
   * the label out of a narrow sidebar — so only a recent folder has one: the
   * folder it is in, to tell two of one name apart.
   */
  private node(section: PlaceSection, path: string, label: string, icon: UiIconName, meta?: string): UiTreeNode {
    const groupPath = this.parent.editorGroupsFt.stateOf(this.parent.activeGroupId())?.path;
    return {
      id: `${section}:${path}`,
      label,
      depth: 0,
      icon,
      expandable: false,
      guides: [],
      ...(meta === undefined ? {} : { meta }),
      ...(groupPath === path ? { selected: true } : {}),
    };
  }

  private labelFor(path: string): string {
    return path === '' ? this.rootLabel() : (path.split('/').at(-1) ?? path);
  }

  /** Where a recent folder is: the name of the folder it is in, so two of one name tell apart. */
  private static parentLabel(path: string): string {
    const at = path.lastIndexOf('/');
    return at === -1 ? '/' : (path.slice(0, at).split('/').at(-1) as string);
  }

  static pathOf(nodeId: string): string | null {
    const at = nodeId.indexOf(':');
    return at === -1 ? null : nodeId.slice(at + 1);
  }

  static sectionOf(nodeId: string): PlaceSection | null {
    const section = nodeId.slice(0, nodeId.indexOf(':'));
    return section === 'place' || section === 'bookmark' || section === 'recent' ? section : null;
  }
}
