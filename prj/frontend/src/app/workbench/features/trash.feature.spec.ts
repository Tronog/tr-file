import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsTrashListing } from '../../file-system/file-system.model';
import { settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { TRASH_PLACE } from './trash.feature';

/** PRD 001, §14.1 — the trash in Places, in a panel tab, and *Empty Trash* in the details sidebar. */

const LISTING: FsTrashListing = {
  trash: 'server',
  canRestore: true,
  canList: true,
  items: [
    { id: 'notes.txt.k1', name: 'notes.txt', location: 'docs/notes.txt', deletedAt: '2026-09-27T10:00:00.000Z', type: 'file', size: 2048 },
    { id: 'old.k2', name: 'old', location: 'docs/old', deletedAt: '2026-09-20T08:00:00.000Z', type: 'directory', size: 0 },
  ],
};

describe('TrashFeature', () => {
  let workbench: WorkbenchService;
  const group = 'group-root';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  afterEach(() => vi.restoreAllMocks());

  const trash = () => workbench.trashFt;
  const answer = (listing: FsTrashListing = LISTING) => vi.spyOn(workbench.fileSystem.operationsFt, 'trashListing').mockResolvedValue(listing);
  const openFromPlaces = async (): Promise<void> => {
    workbench.placesFt.open(TRASH_PLACE);
    await settled();
  };

  it('is a row of the Places pane that opens the trash in a tab of the active panel', async () => {
    const asked = answer();

    await openFromPlaces();

    const state = workbench.editorGroupsFt.stateOf(group);
    const tab = state === undefined ? undefined : workbench.editorGroupsFt.activeTabOf(state);
    expect(tab).toMatchObject({ kind: 'trash', label: 'Trash' });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(trash().showing()).toBe(true);
    expect(workbench.placesFt.placeNodes().at(-1)).toMatchObject({ id: TRASH_PLACE, icon: 'trash', selected: true });

    workbench.placesFt.open(TRASH_PLACE);
    expect(workbench.editorGroupsFt.stateOf(group)?.tabs.filter((candidate) => candidate.kind === 'trash')).toHaveLength(1);
  });

  it('lists what was thrown away, where it was and when, with Restore and Empty Trash on its toolbar', async () => {
    answer();
    await openFromPlaces();

    const browser = trash().browser(group);
    expect(browser?.rows.map((row) => [row.name, row.cells['location'], row.cells['size'] !== '' ])).toEqual([
      ['notes.txt', '/docs/notes.txt', true],
      ['old', '/docs/old', false],
    ]);
    expect(browser?.summary).toBe('2 items');
    expect(browser?.toolbarActions.map((action) => [action.id, action.disabled ?? false])).toEqual([
      ['refresh', false],
      ['restore', true],
      ['empty', false],
    ]);
  });

  it('says so when the trash is empty, and when it is the system’s and cannot be listed', async () => {
    answer({ ...LISTING, items: [] });
    await openFromPlaces();
    expect(trash().browser(group)?.empty?.title).toBe('The Trash is empty');

    answer({ trash: 'system', canRestore: false, canList: false, items: [] });
    trash().runToolbarAction(group, 'refresh');
    await settled();
    expect(trash().browser(group)?.empty?.title).toBe('The Trash is the system’s');
    expect(trash().browser(group)?.toolbarActions.map((action) => action.id)).toEqual(['refresh', 'empty']);
  });

  it('restores what is selected, and empties the trash, as the jobs that do it', async () => {
    answer();
    await openFromPlaces();
    const restore = vi.spyOn(workbench.operationsFt, 'restore').mockResolvedValue();
    const empty = vi.spyOn(workbench.operationsFt, 'emptyTrash').mockResolvedValue();

    trash().setSelection(group, { selected: ['notes.txt.k1'], focused: 'notes.txt.k1' });
    trash().runToolbarAction(group, 'restore');
    trash().runToolbarAction(group, 'empty');
    await settled();

    expect(restore).toHaveBeenCalledWith(['notes.txt.k1']);
    expect(empty).toHaveBeenCalled();
  });

  it('describes the trash in the details sidebar, with Empty Trash among its actions', async () => {
    answer();
    await openFromPlaces();

    expect(trash().preview()).toMatchObject({ title: 'Trash', subtitle: '2 items', icon: 'trash' });
    expect(trash().properties().map((property) => [property.label, property.value])).toEqual([
      ['Kept by', 'The server'],
      ['Items', '2 items'],
      ['Size of files', workbench.fileViewModel.formatBytes(2048)],
      ['Restore', 'From here'],
    ]);
    expect(trash().actions().map((action) => action.label)).toEqual(['Empty Trash…', 'Refresh']);

    const empty = vi.spyOn(workbench.operationsFt, 'emptyTrash').mockResolvedValue();
    trash().runAction('empty');
    expect(empty).toHaveBeenCalled();
  });

  it('describes the one entry picked in it, and offers to restore it', async () => {
    answer();
    await openFromPlaces();

    trash().setSelection(group, { selected: ['notes.txt.k1'], focused: 'notes.txt.k1' });

    expect(trash().preview().title).toBe('notes.txt');
    expect(trash().properties()[0]).toMatchObject({ label: 'Original location', value: '/docs/notes.txt', mono: true, copy: true });
    // A server trash's location is in the root: copied as its full path (PRD 001, §9.3.1).
    const copy = vi.spyOn(workbench.fileSystem.systemFt, 'copyPaths').mockResolvedValue('');
    trash().runProperty({ id: 'copy-trash-location', shift: true });
    expect(copy).toHaveBeenCalledWith(['docs/notes.txt'], 'unix');
    expect(trash().actions().map((action) => action.id)).toEqual(['restore', 'empty', 'refresh']);
  });

  it('reads the trash again when a job that changes it ends', async () => {
    const asked = answer();
    await openFromPlaces();
    vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
    vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockResolvedValue(undefined);
    vi.spyOn(workbench.fileSystem.operationsFt, 'operationsInfo').mockResolvedValue({ trash: 'server', canRestore: true });
    vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue({
      id: 'job-1',
      kind: 'empty-trash',
      state: 'done',
      title: 'Emptying the trash',
      startedAt: '2026-09-27T10:00:00.000Z',
      finishedAt: '2026-09-27T10:00:01.000Z',
      totalBytes: null,
      doneBytes: 0,
      totalItems: 2,
      doneItems: 2,
      current: null,
      skipped: 0,
      error: null,
      affected: [],
    });

    await workbench.operationsFt.emptyTrash();

    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('lights only the Trash in Places, gives its tab its own icon, and counts it in the status bar', async () => {
    answer();
    await openFromPlaces();

    const lit = workbench.placesFt.placeNodes().filter((node) => node.selected).map((node) => node.id);
    expect(lit).toEqual([TRASH_PLACE]);
    const tab = workbench.editorGroupsFt.group(group)?.tabs.find((candidate) => candidate.active);
    expect(tab?.icon).toBe('trash');
    expect(workbench.chromeFt.statusTrailingItems().find((item) => item.id === 'selection')?.label).toBe('2 items in the Trash');
  });
});

