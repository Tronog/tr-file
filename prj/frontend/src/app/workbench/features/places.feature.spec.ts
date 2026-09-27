import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RemoteConnectionService } from '../../file-system/remote-connection.service';
import type { RemoteConnectionStatus } from '../../file-system/fs-bridge.service';
import type { FsPlaces } from '../../file-system/file-system.model';
import { fsDirectory, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { BOOKMARKS_KEY, RECENT_KEY, RECENT_LIMIT } from './places.feature';

/** PRD 003, §6 — Places, Bookmarks and Recent: what a file manager's sidebar lists above the tree. */

const PLACES: FsPlaces = {
  home: 'home/me',
  places: [
    { id: 'root', label: 'File System', kind: 'root', path: '' },
    { id: 'home', label: 'Home', kind: 'home', path: 'home/me' },
    { id: 'downloads', label: 'Downloads', kind: 'downloads', path: 'home/me/Downloads' },
    { id: 'mount-/media/me/USB', label: 'USB', kind: 'removable', path: 'media/me/USB' },
  ],
};

describe('PlacesFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  function create(): void {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const places = () => workbench.placesFt;

  /** Answers every listing still asked for — the tree revealing a folder asks for each above it — with an empty one. */
  async function flushListings(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      for (const request of http.match((candidate) => candidate.url.startsWith('/api/fs/list'))) {
        request.flush(fsEnvelope(fsListing(request.request.params.get('path') ?? '', [])));
      }
      await settled();
    }
  }

  it('asks the backend once, and names the root after its answer', async () => {
    create();
    expect(places().rootLabel()).toBe('tr-file');

    void places().load();
    void places().load();
    http.expectOne('/api/fs/places').flush(fsEnvelope(PLACES));
    await settled();

    expect(places().rootLabel()).toBe('File System');
    expect(workbench.workspaceName()).toBe('File System');
    expect(places().home()).toBe('home/me');
    expect(places().placeNodes().map((node) => [node.id, node.label, node.icon, node.meta])).toEqual([
      ['place:', 'File System', 'device-hdd', undefined],
      ['place:home/me', 'Home', 'home', undefined],
      ['place:home/me/Downloads', 'Downloads', 'download', undefined],
      ['place:media/me/USB', 'USB', 'usb', undefined],
      ['trash:', 'Trash', 'trash', undefined],
    ]);
  });

  it('takes a server from before places existed for one with only its root', async () => {
    create();
    void places().load();
    http.expectOne('/api/fs/places').flush(null, { status: 404, statusText: 'Not Found' });
    await settled();

    expect(places().placeNodes().map((node) => node.label)).toEqual(['Files', 'Trash']);
  });

  it('opens a place in the active panel', async () => {
    create();
    places().open('place:home/me/Downloads');

    await flushListings();
    const group = workbench.editorGroupsFt.stateOf(workbench.activeGroupId());
    expect(group?.path).toBe('home/me/Downloads');
    expect(workbench.fileBrowserFt.browser(workbench.activeGroupId())?.breadcrumbs.map((crumb) => crumb.label)).toEqual([
      'tr-file',
      'home',
      'me',
      'Downloads',
    ]);
  });

  describe('bookmarks', () => {
    beforeEach(() => create());

    it('pins folders, renames and reorders them, and remembers them for this backend', () => {
      places().addBookmark('home/me/projects');
      places().addBookmark('srv/share');
      places().addBookmark('home/me/projects');

      expect(places().bookmarkNodes().map((node) => [node.label, node.meta, node.icon])).toEqual([
        ['projects', undefined, 'star'],
        ['share', undefined, 'star'],
      ]);

      places().renameBookmark('srv/share', '  The share ');
      places().moveBookmark('srv/share', -1);
      expect(places().canMoveBookmark('srv/share', -1)).toBe(false);
      expect(places().bookmarks()).toEqual([
        { path: 'srv/share', label: 'The share' },
        { path: 'home/me/projects', label: 'projects' },
      ]);
      expect(workbench.settings.get(`${BOOKMARKS_KEY}:local`)).toEqual(places().bookmarks());

      places().removeBookmark('srv/share');
      expect(places().isBookmarked('srv/share')).toBe(false);
    });

    it('follows a renamed folder — keeping a label the user chose', () => {
      places().addBookmark('docs/old');
      places().addBookmark('docs/old/inner');
      places().renameBookmark('docs/old/inner', 'Mine');

      places().relocate((path) => (path === 'docs/old' || path.startsWith('docs/old/') ? `docs/new${path.slice('docs/old'.length)}` : path));

      expect(places().bookmarks()).toEqual([
        { path: 'docs/new', label: 'new' },
        { path: 'docs/new/inner', label: 'Mine' },
      ]);
    });

    it('is offered on a folder and on blank space, and taken back the same way', () => {
      const commands = workbench.commandsFt;
      const folder = { groupId: workbench.activeGroupId(), paths: [], folder: 'docs' };

      expect(commands.isEnabled('places.addBookmark', folder)).toBe(true);
      expect(commands.isEnabled('places.removeBookmark', folder)).toBe(false);
      commands.run('places.addBookmark', folder);
      expect(places().isBookmarked('docs')).toBe(true);
      expect(commands.isEnabled('places.addBookmark', folder)).toBe(false);
      commands.run('places.removeBookmark', folder);
      expect(places().isBookmarked('docs')).toBe(false);
      // The root is a place already.
      expect(commands.isEnabled('places.addBookmark', { ...folder, folder: '' })).toBe(false);
    });
  });

  describe('recent folders', () => {
    beforeEach(() => create());

    it('keeps the last folders opened, newest first, but for the root and home', () => {
      for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
        places().recordRecent(`f${index}`);
      }
      places().recordRecent('f5');
      places().recordRecent('');

      expect(places().recent()).toHaveLength(RECENT_LIMIT);
      expect(places().recent().slice(0, 3)).toEqual(['f5', `f${RECENT_LIMIT + 2}`, `f${RECENT_LIMIT + 1}`]);
      expect(places().recentNodes()[0]).toMatchObject({ id: 'recent:f5', label: 'f5', icon: 'history', meta: '/' });
      expect(workbench.settings.get(`${RECENT_KEY}:local`)).toEqual(places().recent());
    });

    it('forgets what was trashed, and can be cleared', () => {
      places().recordRecent('a');
      places().recordRecent('a/b');
      places().recordRecent('c');

      places().forget(['a']);
      expect(places().recent()).toEqual(['c']);

      workbench.commandsFt.run('places.clearRecent');
      expect(places().recent()).toEqual([]);
    });

    it('records what a panel opens', async () => {
      workbench.fileBrowserFt.navigateTo(workbench.activeGroupId(), 'docs', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsDirectory('docs/a')])));
      await settled();

      expect(places().recent()).toEqual(['docs']);
      await flushListings();
    });
  });

  it('keeps a remote server’s bookmarks apart from this computer’s', () => {
    localStorage.setItem(`${BOOKMARKS_KEY}:local`, JSON.stringify([{ path: 'home/me', label: 'me' }]));
    localStorage.setItem(`${BOOKMARKS_KEY}:ana@nas:4310`, JSON.stringify([{ path: 'data', label: 'data' }]));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const connection = TestBed.inject(RemoteConnectionService) as unknown as { state: WritableSignal<RemoteConnectionStatus> };
    connection.state.set({ connected: true, scheme: 'http', host: 'nas', port: 4310, user: 'ana' });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);

    expect(places().bookmarks()).toEqual([{ path: 'data', label: 'data' }]);
  });
});
