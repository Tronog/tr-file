import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fsEnvelope, fsListing, listUrl } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { RESTORE_SESSION_KEY, SESSION_KEY, SessionFeature, type SessionSnapshot } from './session.feature';

/** PRD 003, §6 — the layout, remembered between sessions. */

const SAVED: SessionSnapshot = {
  version: 1,
  grid: {
    kind: 'split',
    direction: 'row',
    children: [
      { kind: 'leaf', groupId: 'group-root', size: 0.4 },
      { kind: 'leaf', groupId: 'group-7', size: 0.6 },
    ],
  },
  groups: [
    {
      id: 'group-root',
      path: 'docs',
      view: 'grid',
      selection: [],
      sort: { key: 'size', direction: 'desc' },
      tabs: [{ id: 'tab-root', label: 'docs', path: 'docs', kind: 'folder', active: true }],
    },
    {
      id: 'group-7',
      path: 'notes',
      view: 'list',
      selection: [],
      tabs: [
        { id: 'tab-group-7', label: 'notes', path: 'notes', kind: 'folder', active: true },
        { id: 'tab-zip-group-9', label: 'a.zip', path: 'a.zip', kind: 'archive', inner: 'x' },
      ],
    },
  ],
  selectedEntryId: '',
  activeGroupId: 'group-7',
  leftSidebarWidth: 333,
  rightSidebarWidth: 250,
  bottomPanelHeight: 180,
  bottomPanel: { tab: 'progress', collapsed: false },
  showHidden: true,
  panes: ['explorer-tree', 'recent'],
  // A pane this version no longer has is dropped; one it does not name keeps its default place.
  paneOrder: { details: ['properties', 'gone', 'git', 'open-with'] },
  paneSizes: { recent: 120, 'explorer-tree': 360 },
};

describe('SessionFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  function create(): void {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts from the default layout when nothing was saved', () => {
    create();
    expect(workbench.restored).toBeNull();
    expect(workbench.editorGroupsFt.states().map((group) => group.path)).toEqual(['']);
  });

  it('restores the last session: panels, tabs, views, sorts, sizes, panes and the bottom panel', () => {
    localStorage.setItem(`${SESSION_KEY}:local`, JSON.stringify(SAVED));
    create();

    expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root', 'group-7']);
    expect(workbench.editorGroupsFt.stateOf('group-root')?.view).toBe('grid');
    expect(workbench.fileBrowserFt.sortOf('group-root')).toEqual({ key: 'size', direction: 'desc' });
    expect(workbench.activeGroupId()).toBe('group-7');
    expect(workbench.leftSidebarWidth()).toBe(333);
    expect(workbench.showHidden()).toBe(true);

    workbench.start();
    expect(workbench.bottomPanelFt.collapsed()).toBe(false);
    expect(workbench.bottomPanelFt.activeTab()).toBe('progress');
    expect(workbench.sidebarPanesFt.isExpanded('recent')).toBe(true);
    expect(workbench.sidebarPanesFt.isExpanded('bookmarks')).toBe(false);
    expect(workbench.sidebarPanesFt.order('details')).toEqual(['properties', 'permissions', 'git', 'open-with']);
    expect(workbench.sidebarPanesFt.order('explorer')).toEqual(['places', 'bookmarks', 'recent', 'explorer-tree']);
    expect(workbench.sidebarPanesFt.sizeOf('recent')).toBe(120);
    expect(workbench.sidebarPanesFt.sizeOf('places')).toBeNull();
    // New ids go past every one the session used, tabs' included.
    expect(workbench.editorGroupsFt.createId()).toBe('group-10');

    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [])));
    http.expectOne(listUrl('notes')).flush(fsEnvelope(fsListing('notes', [])));
    http.match(() => true);
  });

  it('ignores a session that does not hold together', () => {
    const broken = { ...SAVED, grid: { kind: 'leaf', groupId: 'group-gone' } };
    expect(SessionFeature.validate(broken)).toBeNull();
    expect(SessionFeature.validate({ ...SAVED, version: 2 })).toBeNull();
    expect(SessionFeature.validate({ ...SAVED, groups: [{ ...SAVED.groups[0], view: 'sideways' }, SAVED.groups[1]] })).toBeNull();
    expect(SessionFeature.validate('{')).toBeNull();
    // Heights that are not heights are left out, not a reason to start over.
    expect(SessionFeature.validate({ ...SAVED, paneSizes: { recent: -4, places: 'tall', 'explorer-tree': 360 } })?.paneSizes).toEqual({
      'explorer-tree': 360,
    });

    localStorage.setItem(`${SESSION_KEY}:local`, JSON.stringify(broken));
    create();
    expect(workbench.restored).toBeNull();
  });

  it('is not restored once switched off', () => {
    localStorage.setItem(`${SESSION_KEY}:local`, JSON.stringify(SAVED));
    localStorage.setItem(RESTORE_SESSION_KEY, 'false');
    create();
    expect(workbench.restored).toBeNull();
  });

  it('writes the layout a moment after it changes — once started', async () => {
    vi.useFakeTimers();
    create();
    workbench.fileBrowserFt.setView('group-root', 'list');
    TestBed.tick();
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(`${SESSION_KEY}:local`)).toBeNull();

    workbench.sessionFt.start();
    workbench.fileBrowserFt.setView('group-root', 'grid');
    workbench.leftSidebarWidth.set(300);
    workbench.sidebarPanesFt.move('explorer', { paneId: 'explorer-tree', targetId: 'places', position: 'before' });
    workbench.sidebarPanesFt.resize({ sizes: { bookmarks: 100.4, 'explorer-tree': 300 } });
    TestBed.tick();
    vi.advanceTimersByTime(399);
    expect(localStorage.getItem(`${SESSION_KEY}:local`)).toBeNull();
    vi.advanceTimersByTime(1);

    const saved = SessionFeature.validate(JSON.parse(localStorage.getItem(`${SESSION_KEY}:local`) ?? 'null'));
    expect(saved?.groups[0]?.view).toBe('grid');
    expect(saved?.leftSidebarWidth).toBe(300);
    expect(saved?.paneSizes).toEqual({ bookmarks: 100, 'explorer-tree': 300 });
    expect(saved?.paneOrder).toEqual({ explorer: ['explorer-tree', 'places', 'bookmarks', 'recent'] });
  });

  it('forgets the layout and starts over on Reset Layout', () => {
    localStorage.setItem(`${SESSION_KEY}:local`, JSON.stringify(SAVED));
    create();
    const reload = vi.spyOn(workbench.sessionFt, 'reload').mockImplementation(() => undefined);

    workbench.commandsFt.run('view.resetLayout');

    expect(localStorage.getItem(`${SESSION_KEY}:local`)).toBeNull();
    expect(reload).toHaveBeenCalled();
  });
});
