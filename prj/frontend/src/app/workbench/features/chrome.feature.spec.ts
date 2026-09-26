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
      expect(workbench.bottomPanelFt.transfersVisible()).toBe(true);

      workbench.chromeFt.runStatusAction('problems');

      expect(workbench.bottomPanelFt.problemsVisible()).toBe(true);
      expect(workbench.bottomPanelFt.transfersVisible()).toBe(false);

      workbench.chromeFt.runStatusAction('transfers');

      expect(workbench.bottomPanelFt.transfersVisible()).toBe(true);
    });

    it('ignores an item that does nothing', () => {
      workbench.chromeFt.runStatusAction('sort');

      expect(workbench.showHidden()).toBe(false);
      expect(workbench.bottomPanelFt.transfersVisible()).toBe(true);
    });
  });

  it('passes the static chrome through from the seed data', () => {
    expect(workbench.chromeFt.menuItems).toBe(workbench.mockWorkbench.menuItems);
    expect(workbench.chromeFt.titleBarActions).toBe(workbench.mockWorkbench.titleBarActions);
    expect(workbench.chromeFt.commandLabel).toBe(workbench.mockWorkbench.commandLabel);
    expect(workbench.chromeFt.activityItems().map((item) => item.id)).toEqual([
      'explorer',
      'search',
      'transfers',
      'bookmarks',
    ]);
  });
});
