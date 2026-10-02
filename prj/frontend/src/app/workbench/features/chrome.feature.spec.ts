import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiStatusItem } from '@tr-file/ui';
import {
  detailsUrl,
  fsDetails,
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
  uploadUrl,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

const ROOT_ENTRIES = [fsDirectory('docs'), fsEntry('README.md', { size: 3482 }), fsEntry('.env')];

describe('ChromeFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const leading = (id: string): UiStatusItem | undefined =>
    workbench.chromeFt.statusLeadingItems().find((item) => item.id === id);

  const trailing = (id: string): UiStatusItem | undefined =>
    workbench.chromeFt.statusTrailingItems().find((item) => item.id === id);

  const startRoot = async (): Promise<void> => {
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    await settled();
  };

  /** PRD 008, §1 — the main menu, and its Go menu. */
  describe('the main menu', () => {
    const menus = () => workbench.chromeFt.menuItems();
    const go = () => menus().find((menu) => menu.id === 'go');

    it('has File, Edit, Selection, View, Go and Help, all closed', () => {
      expect(menus().map((menu) => menu.label)).toEqual(['File', 'Edit', 'Selection', 'View', 'Go', 'Help']);
      expect(menus().every((menu) => !menu.open)).toBe(true);
    });

    /** PRD 003, §5 — every menu is made of the command table's commands; none holds a placeholder. */
    it('holds commands in every menu, labelled and keyed by the command table', () => {
      for (const menu of menus()) {
        expect(menu.items?.length).toBeGreaterThan(0);
        expect(menu.items?.some((item) => item.id === 'todo')).toBe(false);
      }
      const rename = menus().find((menu) => menu.id === 'file')?.items?.find((item) => item.id === 'file.rename');
      expect(rename).toMatchObject({ label: 'Rename…', keybinding: 'F2', disabled: true, separatorBefore: true });
    });

    it('checks the active panel’s view and sort in View', async () => {
      await startRoot();
      const view = () => menus().find((menu) => menu.id === 'view')?.items ?? [];
      const checked = () => view().filter((item) => item.checked).map((item) => item.id);
      expect(checked()).toEqual(['view.list', 'view.sort.name']);

      workbench.chromeFt.runMenuItem({ menuId: 'view', itemId: 'view.sort.size' });
      workbench.chromeFt.runMenuItem({ menuId: 'view', itemId: 'view.sortDescending' });
      workbench.chromeFt.runMenuItem({ menuId: 'view', itemId: 'view.grid' });

      expect(checked()).toEqual(['view.grid', 'view.sort.size', 'view.sortDescending']);
      expect(workbench.chromeFt.statusTrailingItems().find((item) => item.id === 'sort')?.label).toBe(
        'Sorted by Size, descending',
      );
    });

    it('offers Back, Forward, Up and Go to Location, then Local Computer, checked by default, and Remote Computer in Go', () => {
      expect(go()?.items?.map((item) => item.id)).toEqual([
        'go.back',
        'go.forward',
        'go.up',
        'go.location',
        'places.addBookmark',
        'places.removeBookmark',
        'go.local',
        'go.remote',
      ]);
      expect(go()?.items?.slice(-2)).toEqual([
        { id: 'go.local', label: 'Local Computer', checked: true, separatorBefore: true },
        { id: 'go.remote', label: 'Remote Computer…', checked: false },
      ]);
    });

    /** PRD 006, §1: on a remote server, Remote Computer is checked and Local Computer disconnects. */
    describe('on a remote server', () => {
      let sent: Record<string, unknown>[];
      let reloads: number;

      beforeEach(async () => {
        sent = [];
        reloads = 0;
        Object.defineProperty(window, 'trFileBridge', {
          configurable: true,
          writable: true,
          value: {
            version: 2,
            invoke: async (request: Record<string, unknown>) => {
              sent.push(request);
              return request['command'] === 'connection-status'
                ? { data: { connected: true, scheme: 'http', host: 'nas.local', port: 4310, user: 'ana' } }
                : { data: { connected: false } };
            },
            save: async () => ({ data: { saved: false } }),
            onSaveProgress: () => () => undefined,
          },
        });
        vi.spyOn(workbench.connection, 'reload').mockImplementation(() => (reloads += 1));
        await workbench.connection.load();
      });

      afterEach(() => {
        Object.defineProperty(window, 'trFileBridge', { configurable: true, writable: true, value: undefined });
      });

      it('checks Remote Computer, and names the server in the status bar', () => {
        expect(workbench.backend()).toBe('remote');
        expect(go()?.items?.slice(-2).map((item) => item.checked)).toEqual([false, true]);
        expect(workbench.chromeFt.statusLeadingItems()[0]).toMatchObject({ label: 'ana@nas.local:4310', icon: 'cloud' });
      });

      it('disconnects with Local Computer, and starts over on this computer', async () => {
        workbench.chromeFt.runMenuItem({ menuId: 'go', itemId: 'go.local' });
        await vi.waitFor(() => expect(reloads).toBe(1));

        expect(sent.at(-1)).toEqual({ command: 'disconnect' });
        expect(workbench.backend()).toBe('local');
      });
    });

    it('opens one menu at a time, and closes', () => {
      workbench.chromeFt.setMenuOpen('go');
      expect(menus().filter((menu) => menu.open).map((menu) => menu.id)).toEqual(['go']);

      workbench.chromeFt.setMenuOpen('file');
      expect(menus().filter((menu) => menu.open).map((menu) => menu.id)).toEqual(['file']);

      workbench.chromeFt.setMenuOpen(null);
      expect(menus().some((menu) => menu.open)).toBe(false);
    });

    it('stays on this computer for Local Computer, closing the menu', () => {
      workbench.chromeFt.setMenuOpen('go');
      workbench.chromeFt.runMenuItem({ menuId: 'go', itemId: 'go.local' });

      expect(workbench.backend()).toBe('local');
      expect(go()?.open).toBe(false);
      expect(workbench.commandPaletteFt.isOpen()).toBe(false);
    });

    /** §1.3: Remote Computer is the palette's Connect to Remote Server. */
    it('opens the command palette at Connect to Remote Server for Remote Computer', () => {
      workbench.chromeFt.setMenuOpen('go');
      workbench.chromeFt.runMenuItem({ menuId: 'go', itemId: 'go.remote' });

      const palette = workbench.commandPaletteFt;
      expect(go()?.open).toBe(false);
      expect(palette.isOpen()).toBe(true);
      // The saved servers to pick from, and a row to add one (PRD 009, §1).
      expect(palette.showList()).toBe(true);
      expect(palette.label()).toBe('Connect to remote server');
      expect(palette.items().at(-1)?.label).toBe('Add New Remote Server…');
    });
  });

  /** PRD 007, §1 — the Settings gear opens a menu beside it. */
  describe('the Settings menu', () => {
    const gear = () => workbench.chromeFt.activityBottomItems().find((item) => item.id === 'settings');
    const anchor = { id: 'settings', left: 0, top: 700, right: 48, bottom: 748 };

    it('is a menu button, closed to start with', () => {
      expect(gear()).toMatchObject({ hasMenu: true, expanded: false });
      expect(workbench.chromeFt.settingsMenu()).toBeNull();
    });

    /** PRD 003, §6: what the app shows and remembers — commands of the table, checked as they stand. */
    it('opens beside the gear, from its bottom edge, and offers what the app shows and remembers', () => {
      workbench.chromeFt.openMenu(anchor);

      expect(workbench.chromeFt.settingsMenu()).toEqual({ x: 48, y: 748 });
      expect(gear()).toMatchObject({ expanded: true, active: true });
      expect(workbench.chromeFt.settingsMenuItems()).toEqual([
        { id: 'workbench.openSettings', label: 'Settings', keybinding: 'Ctrl+,' },
        { id: 'workbench.openKeybindings', label: 'Keyboard Shortcuts' },
        { id: 'view.hidden', label: 'Show Hidden Files', keybinding: 'Ctrl+H', checked: false, separatorBefore: true },
        { id: 'settings.restoreSession', label: 'Restore Layout on Start', checked: true, separatorBefore: true },
        { id: 'view.resetLayout', label: 'Reset Layout' },
        { id: 'places.clearRecent', label: 'Clear Recent Folders', disabled: true, separatorBefore: true },
      ]);
    });

    it('runs its entries: hidden files shown, and the layout not restored next time', () => {
      workbench.chromeFt.runSettingsItem('view.hidden');
      workbench.chromeFt.runSettingsItem('settings.restoreSession');

      expect(workbench.showHidden()).toBe(true);
      expect(workbench.settings.get('tr-file.restore-session.v1')).toBe(false);
      expect(workbench.chromeFt.settingsMenuItems().find((item) => item.id === 'settings.restoreSession')?.checked).toBe(false);
    });

    it('closes when the gear is pressed again, when dismissed, and after a choice', () => {
      workbench.chromeFt.openMenu(anchor);
      workbench.chromeFt.openMenu(anchor);
      expect(workbench.chromeFt.settingsMenu()).toBeNull();

      workbench.chromeFt.openMenu(anchor);
      workbench.chromeFt.closeSettingsMenu();
      expect(workbench.chromeFt.settingsMenu()).toBeNull();

      workbench.chromeFt.openMenu(anchor);
      workbench.chromeFt.runSettingsItem('places.clearRecent');
      expect(workbench.chromeFt.settingsMenu()).toBeNull();
    });

    it('ignores a menu request from anything else', () => {
      workbench.chromeFt.openMenu({ ...anchor, id: 'account' });

      expect(workbench.chromeFt.settingsMenu()).toBeNull();
    });
  });

  /** PRD 003, §2 — the account button is how a signed-in user signs out. */
  describe('the account button', () => {
    const account = () => workbench.chromeFt.activityBottomItems().find((item) => item.id === 'account');

    const signIn = async (): Promise<void> => {
      const started = workbench.auth.start();
      http.expectOne('/api/auth/session').flush({ data: { required: true, authenticated: true, username: 'ana' } });
      await started;
    };

    it('is plain Account when nobody has to sign in', async () => {
      const started = workbench.auth.start();
      http.expectOne('/api/auth/session').flush({ data: { required: false, authenticated: true, username: null } });
      await started;

      expect(account()?.label).toBe('Account');
      workbench.chromeFt.selectActivity('account');
      http.expectNone('/api/auth/logout');
    });

    it('names who is signed in, and signs them out', async () => {
      await signIn();
      expect(account()?.label).toBe('Sign out ana');

      workbench.chromeFt.selectActivity('account');
      http.expectOne('/api/auth/logout').flush({ data: { required: true, authenticated: false, username: null } });
      await settled();

      expect(workbench.auth.view()).toBe('signed-out');
    });
  });

  it('names the workspace and reports a clean session', () => {
    expect(leading('root')).toMatchObject({ label: workbench.mockWorkbench.workspaceName, accent: true });
    expect(leading('problems')).toMatchObject({ label: 'No problems', icon: 'check' });
    expect(leading('transfers')).toBeUndefined();
  });

  describe('problems', () => {
    it('counts the paths that failed to load, singular at one', async () => {
      workbench.fsDataFt.ensureListing('a');
      http.expectOne(listUrl('a')).flush(fsErrorBody('FORBIDDEN', 'Denied'), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(leading('problems')).toMatchObject({ label: '1 problem', icon: 'alert-triangle' });

      workbench.fsDataFt.ensureListing('b');
      http.expectOne(listUrl('b')).flush(fsErrorBody('NOT_FOUND', 'Gone'), { status: 404, statusText: 'Not Found' });
      await settled();

      expect(leading('problems')?.label).toBe('2 problems');
    });
  });

  describe('uploads', () => {
    it('appears while uploads are running and disappears when they finish', async () => {
      workbench.transfersFt.uploadFiles('', [new File(['a'], 'a.txt')]);

      expect(leading('transfers')).toMatchObject({ label: '1 transferring', icon: 'sync' });
      expect(
        workbench.chromeFt.activityItems().find((item) => item.id === 'transfers')?.badge,
      ).toBe(1);

      http.expectOne(uploadUrl('')).flush(fsEnvelope(fsDetails('a.txt')));
      await settled();

      expect(leading('transfers')).toBeUndefined();
      expect(workbench.chromeFt.activityItems().find((item) => item.id === 'transfers')?.badge).toBeUndefined();
    });
  });

  describe('the trailing items', () => {
    it('summarises the active group listing, then the selection', async () => {
      expect(trailing('selection')?.label).toBe('0 items');

      await startRoot();

      // `.env` is hidden, so it is not part of what the group shows.
      expect(trailing('selection')?.label).toBe('2 items');

      workbench.fileBrowserFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      expect(trailing('selection')?.label).toBe('1 of 2 selected · 3.4 KB');
    });

    /** PRD 004, §1.2: the count and size are the whole selection's. */
    it('counts a multiple selection, folders adding no size', async () => {
      await startRoot();

      workbench.fileBrowserFt.setSelection('group-root', { selected: ['docs', 'README.md'], focused: 'README.md' });
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      expect(trailing('selection')?.label).toBe('2 of 2 selected · 3.4 KB');
    });

    it('says so when the active group has no folder at all', async () => {
      await startRoot();

      workbench.activeGroupId.set('nowhere');

      expect(trailing('selection')?.label).toBe('No folder open');
    });

    it('reports whether hidden files are shown', () => {
      expect(trailing('hidden')?.label).toBe('Hidden files: hidden');

      workbench.showHidden.set(true);

      expect(trailing('hidden')?.label).toBe('Hidden files: shown');
    });
  });

  it('toggles the bottom panel from the title bar (PRD 001, §12.3)', () => {
    expect(workbench.bottomPanelFt.collapsed()).toBe(true);
    workbench.chromeFt.runTitleBarAction('toggle-panel');
    expect(workbench.bottomPanelFt.collapsed()).toBe(false);
    workbench.chromeFt.runTitleBarAction('toggle-panel');
    expect(workbench.bottomPanelFt.collapsed()).toBe(true);
  });

  describe('runStatusAction()', () => {
    it('hidden toggles the hidden files, which re-counts the listing', async () => {
      await startRoot();

      workbench.chromeFt.runStatusAction('hidden');

      expect(workbench.showHidden()).toBe(true);
      expect(trailing('hidden')?.label).toBe('Hidden files: shown');
      expect(trailing('selection')?.label).toBe('3 items');

      workbench.chromeFt.runStatusAction('hidden');

      expect(workbench.showHidden()).toBe(false);
    });

    it('problems and transfers switch the bottom panel tab', () => {
      expect(workbench.bottomPanelFt.notesVisible()).toBe(true);

      workbench.chromeFt.runStatusAction('problems');

      expect(workbench.bottomPanelFt.problemsVisible()).toBe(true);
      expect(workbench.bottomPanelFt.transfersVisible()).toBe(false);

      workbench.chromeFt.runStatusAction('transfers');

      expect(workbench.bottomPanelFt.transfersVisible()).toBe(true);
    });

    it('ignores an item that does nothing', () => {
      workbench.chromeFt.runStatusAction('sort');

      expect(workbench.showHidden()).toBe(false);
      expect(workbench.bottomPanelFt.notesVisible()).toBe(true);
    });
  });

  /** PRD 001, §8.2.2 — a sun / moon at the left of the title bar's buttons, swapping light and dark. */
  it('toggles light and dark from the leftmost title bar button', () => {
    try {
      const theme = () => workbench.preferencesFt.effectiveTheme();
      const button = () => workbench.chromeFt.titleBarActions()[0];
      expect(theme()).toBe('dark');
      expect(button()).toMatchObject({ id: 'toggle-theme', icon: 'sun', label: 'Switch to Light Theme' });

      workbench.chromeFt.runTitleBarAction('toggle-theme');
      expect(theme()).toBe('light');
      expect(workbench.preferencesFt.choice('workbench.colorTheme')).toBe('light');
      expect(button()).toMatchObject({ icon: 'moon', label: 'Switch to Dark Theme' });
      TestBed.tick();
      expect(document.documentElement.dataset['theme']).toBe('light');

      // Following the system, a press picks the other of what is shown outright.
      workbench.preferencesFt.choose('workbench.colorTheme', 'system');
      const shown = theme();
      workbench.commandsFt.run('view.toggleTheme');
      expect(workbench.preferencesFt.choice('workbench.colorTheme')).toBe(shown === 'dark' ? 'light' : 'dark');
    } finally {
      workbench.preferencesFt.choose('workbench.colorTheme', 'dark');
      TestBed.tick();
    }
  });

  it('passes the static chrome through from the seed data', () => {
    expect(workbench.chromeFt.titleBarActions().map((action) => action.id)).toEqual(workbench.mockWorkbench.titleBarActions.map((action) => action.id));
    expect(workbench.chromeFt.commandLabel).toBe(workbench.mockWorkbench.commandLabel);
    expect(workbench.chromeFt.activityItems().map((item) => item.id)).toEqual([
      'file-manager',
      'search',
      'disk-usage',
      'transfers',
      'bookmarks',
    ]);
  });
});
