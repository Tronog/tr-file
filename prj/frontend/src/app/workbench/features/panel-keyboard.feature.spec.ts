import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  detailsUrl,
  downloadUrl,
  fsDetails,
  fsDirectory,
  fsDirectoryDetails,
  fsEntry,
  fsEnvelope,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

const ROOT_ENTRIES = [fsDirectory('docs'), fsEntry('README.md', { size: 27 })];
const DOCS_ENTRIES = [fsDirectory('docs/prd'), fsEntry('docs/NOTES.md', { size: 2048 })];

describe('PanelKeyboardFeature', () => {
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

  const start = async (): Promise<void> => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDirectoryDetails('', { entryCount: 2 })));
    await settled();
  };

  const groupId = (): string => workbench.activeGroupId();
  const activeGroup = () => workbench.editorGroupsFt.group(groupId());
  const crumbs = (): string =>
    (activeGroup()?.breadcrumbs ?? []).map((crumb) => crumb.label).join('/');

  /** Opens `docs` in the active panel, so there is somewhere to come back up from. */
  const openDocs = async (): Promise<void> => {
    workbench.editorGroupsFt.navigateTo(groupId(), 'docs', 'docs');
    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
    await settled();
  };

  it('opens a directory on Enter, the same as a double click', async () => {
    await start();

    workbench.panelKeyboardFt.run(groupId(), { command: 'open', entryId: 'docs' });
    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
    await settled();

    expect(crumbs()).toBe('tr-file/docs');
  });

  it('opens a file on Enter as a read-only tab', async () => {
    await start();

    workbench.panelKeyboardFt.run(groupId(), { command: 'open', entryId: 'README.md' });
    http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
    http.expectOne(downloadUrl('README.md')).flush(new Blob(['# hello'], { type: 'text/markdown' }));
    await settled();

    expect(activeGroup()?.tabs.map((tab) => tab.label)).toContain('README.md');
    expect(activeGroup()?.document).toBeDefined();
  });

  it('selects on Space, which is what the details sidebar follows', async () => {
    await start();

    workbench.panelKeyboardFt.run(groupId(), { command: 'select', entryId: 'README.md' });
    http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
    await settled();

    expect(workbench.selectedEntryId()).toBe('README.md');
    expect(activeGroup()?.rows.find((row) => row.id === 'README.md')).toMatchObject({
      selected: true,
      focused: true,
    });
  });

  it('leaves the folder on Backspace, wherever focus happens to be', async () => {
    await start();
    await openDocs();

    workbench.panelKeyboardFt.run(groupId(), { command: 'up', entryId: 'docs/NOTES.md' });
    await settled();

    expect(crumbs()).toBe('tr-file');
  });

  it('re-reads the listing on F5', async () => {
    await start();
    await openDocs();

    workbench.panelKeyboardFt.run(groupId(), { command: 'refresh', entryId: 'docs/prd' });
    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsDirectory('docs/prd')])));
    await settled();

    expect(activeGroup()?.rows.map((row) => row.id)).toEqual(['docs/prd']);
  });

  /** An empty listing still has a folder to leave; it just has nothing to open. */
  it('ignores an entry-less open or select, but still acts on up', async () => {
    await start();
    await openDocs();

    workbench.panelKeyboardFt.run(groupId(), { command: 'open', entryId: null });
    workbench.panelKeyboardFt.run(groupId(), { command: 'select', entryId: null });
    await settled();
    expect(crumbs()).toBe('tr-file/docs');

    workbench.panelKeyboardFt.run(groupId(), { command: 'up', entryId: null });
    await settled();
    expect(crumbs()).toBe('tr-file');
  });

  /**
   * A panel that lands somewhere new renders different rows, so the element
   * that had focus is gone and the browser drops focus to `<body>` — outside
   * the panel, where the next key reaches nothing (PRD 001, §6.2.1).
   */
  describe('keeping the keyboard in the panel', () => {
    const token = (): number => workbench.panelFocusFt.token(groupId());

    /** Double click and `Enter` are the same gesture; both keep the keyboard. */
    it('asks for focus when an entry is opened by pointer too', async () => {
      await start();
      const before = token();

      workbench.editorGroupsFt.openEntry(groupId(), 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(token()).toBeGreaterThan(before);
    });

    it('asks the body to take focus again after a key changed the folder', async () => {
      await start();
      const before = token();

      workbench.panelKeyboardFt.run(groupId(), { command: 'open', entryId: 'docs' });
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(token()).toBeGreaterThan(before);
    });

    /** Every folder here is already cached, so no request is expected. */
    it('does so for up, back and forward as well', async () => {
      await start();
      await openDocs();

      workbench.panelKeyboardFt.run(groupId(), { command: 'up', entryId: null });
      await settled();
      const afterUp = token();
      expect(afterUp).toBeGreaterThan(0);
      expect(crumbs()).toBe('tr-file');

      // Up is a navigation like any other, so the trail is now ['', 'docs', '']
      // and Back returns to the folder Up was pressed in.
      workbench.panelKeyboardFt.run(groupId(), { command: 'back', entryId: null });
      await settled();
      const afterBack = token();
      expect(afterBack).toBeGreaterThan(afterUp);
      expect(crumbs()).toBe('tr-file/docs');

      workbench.panelKeyboardFt.run(groupId(), { command: 'forward', entryId: null });
      await settled();
      expect(token()).toBeGreaterThan(afterBack);
      expect(crumbs()).toBe('tr-file');
    });

    /** Neither changes the folder, so the rows keep their identity. */
    it('leaves focus alone for select and refresh', async () => {
      await start();
      const before = token();

      workbench.panelKeyboardFt.run(groupId(), { command: 'select', entryId: 'README.md' });
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      workbench.panelKeyboardFt.run(groupId(), { command: 'refresh', entryId: null });
      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
      await settled();

      expect(token()).toBe(before);
    });
  });

  it('runs against the group the key was pressed in, not the active one', async () => {
    await start();
    const first = groupId();
    workbench.editorGroupsFt.runAction(first, 'split-right');
    const second = groupId();
    expect(second).not.toBe(first);

    workbench.panelKeyboardFt.run(first, { command: 'open', entryId: 'docs' });
    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
    await settled();

    expect(workbench.editorGroupsFt.pathOf(first)).toBe('docs');
    expect(workbench.editorGroupsFt.pathOf(second)).toBe('');
  });
});
