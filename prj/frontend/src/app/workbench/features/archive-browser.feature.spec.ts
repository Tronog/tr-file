import { HttpParams, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsArchiveListing, FsOperationJob } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/** PRD 003, §6 — archives: looked into in a tab of their own, extracted, compressed, downloaded as zips. */

const archiveUrl = (path: string, inner: string): string =>
  `/api/archive/list?${new HttpParams().set('path', path).set('inner', inner).toString()}`;

const listing = (inner: string, entries: FsArchiveListing['entries'], unsafe = 0): FsArchiveListing => ({
  path: 'docs/bundle.zip',
  inner,
  entries,
  unsafe,
});

const job = (kind: FsOperationJob['kind']): FsOperationJob => ({
  id: `job-${kind}`,
  kind,
  state: 'done',
  title: kind,
  startedAt: '2026-09-27T10:00:00.000Z',
  finishedAt: '2026-09-27T10:00:01.000Z',
  totalBytes: 1,
  doneBytes: 1,
  totalItems: 1,
  doneItems: 1,
  current: null,
  skipped: 0,
  error: null,
  affected: ['docs'],
  outcome: [{ source: 'docs/bundle.zip', target: 'docs/bundle' }],
});

describe('ArchiveBrowserFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let group: string;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsDirectory('docs')])));
    group = workbench.activeGroupId();
    workbench.fileBrowserFt.navigateTo(group, 'docs', 'docs');
    http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsEntry('docs/bundle.zip'), fsEntry('docs/report.docx')])));
    await settled();
    for (const request of http.match(() => true)) {
      request.flush(fsEnvelope(fsListing('', [])));
    }
    vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockResolvedValue(undefined);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const browser = () => workbench.archiveBrowserFt.browser(group);
  const tab = () => {
    const state = workbench.editorGroupsFt.stateOf(group);
    return state ? workbench.editorGroupsFt.activeTabOf(state) : undefined;
  };

  async function openBundle(): Promise<void> {
    workbench.fileBrowserFt.openEntry(group, 'docs/bundle.zip');
    http.expectOne(archiveUrl('docs/bundle.zip', '')).flush(
      fsEnvelope(
        listing(
          '',
          [
            { name: 'src', path: 'src', type: 'directory', size: 0, modifiedAt: null },
            { name: 'README.md', path: 'README.md', type: 'file', size: 2048, modifiedAt: '2026-09-01T10:00:00.000Z' },
          ],
          1,
        ),
      ),
    );
    await settled();
  }

  it('opens a zip in a tab of its own, listing its top', async () => {
    await openBundle();

    expect(tab()).toMatchObject({ kind: 'archive', path: 'docs/bundle.zip', label: 'bundle.zip', inner: '' });
    expect(workbench.editorGroupsFt.activeContent(group)).toBe('archive');
    expect(browser()?.rows.map((row) => [row.name, row.cells['size']])).toEqual([
      ['src', ''],
      ['README.md', '2.0 KB'],
    ]);
    expect(browser()?.summary).toBe('2 items · 1 unsafe left out');
    expect(browser()?.breadcrumbs.map((crumb) => crumb.id)).toEqual(['root', 'folder:docs', 'inner:']);
  });

  it('opens a document that is a zip inside with its app, not as an archive', () => {
    const open = vi.spyOn(workbench.systemOpenFt, 'open').mockResolvedValue();
    workbench.fileBrowserFt.openEntry(group, 'docs/report.docx');
    expect(open).toHaveBeenCalledWith('docs/report.docx');
    expect(workbench.archiveBrowserFt.isArchive('docs/report.docx')).toBe(true);
  });

  it('walks into folders of the archive, and up out of it to the folder it is in', async () => {
    await openBundle();

    workbench.archiveBrowserFt.openEntry(group, 'src');
    http.expectOne(archiveUrl('docs/bundle.zip', 'src')).flush(
      fsEnvelope(listing('src', [{ name: 'main.ts', path: 'src/main.ts', type: 'file', size: 11, modifiedAt: null }])),
    );
    await settled();
    expect(tab()?.inner).toBe('src');
    expect(browser()?.breadcrumbs.map((crumb) => crumb.label)).toEqual(['tr-file', 'docs', 'bundle.zip', 'src']);

    workbench.archiveBrowserFt.up(group);
    expect(tab()?.inner).toBe('');
    workbench.archiveBrowserFt.up(group);
    expect(tab()).toMatchObject({ kind: 'folder', path: 'docs' });
    expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual(['docs/bundle.zip']);
    // The archive, selected again, is described on the right.
    for (const request of http.match((candidate) => candidate.url.startsWith('/api/fs/'))) {
      request.flush(fsEnvelope(request.request.url.includes('details') ? fsEntry('docs/bundle.zip') : fsListing('docs', [])));
    }
  });

  it('says why an archive cannot be opened', async () => {
    workbench.archiveBrowserFt.open(group, 'docs/bundle.zip');
    http
      .expectOne(archiveUrl('docs/bundle.zip', ''))
      .flush({ error: { code: 'BAD_REQUEST', message: "'bundle.zip' is not a zip archive" } }, { status: 400, statusText: 'Bad Request' });
    await settled();

    expect(browser()?.empty).toMatchObject({ title: 'Could not open this archive', hint: "'bundle.zip' is not a zip archive" });
  });

  it('extracts next to the archive from its toolbar, and Undo trashes what it made', async () => {
    await openBundle();
    const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job('extract'));

    workbench.archiveBrowserFt.runToolbarAction(group, 'extract-here');
    await settled();

    expect(start).toHaveBeenCalledWith({ kind: 'extract', path: 'docs/bundle.zip', destination: 'docs', conflict: 'fail' });
    expect(workbench.undoFt.label()).toBe('Undo Extract');
  });

  it('compresses a selection under the name confirmed, keeping both on a taken one', async () => {
    const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('bundle');
    vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'rename', checked: false, value: '' });
    const start = vi
      .spyOn(workbench.fileSystem.operationsFt, 'start')
      .mockRejectedValueOnce(new FsError('taken', 409, 'CONFLICT', { conflicts: ['bundle.zip'] }))
      .mockResolvedValue(job('compress'));

    workbench.commandsFt.run('file.compress', { groupId: group, paths: ['docs/report.docx', 'docs/bundle.zip'], folder: 'docs' });
    await settled();
    await settled();

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ value: 'docs.zip', confirmLabel: 'Compress' }));
    expect(start).toHaveBeenLastCalledWith({
      kind: 'compress',
      sources: ['docs/report.docx', 'docs/bundle.zip'],
      destination: 'docs',
      name: 'bundle.zip',
      conflict: 'rename',
    });
  });

  it('downloads a folder, or several entries, as one zip', () => {
    const zip = vi.spyOn(workbench.transfersFt, 'downloadZip').mockImplementation(() => undefined);
    const commands = workbench.commandsFt;
    const target = { groupId: group, paths: ['docs'], folder: 'docs' };
    workbench.fsDataFt.entryAt = (path: string) => (path === 'docs' ? fsDirectory('docs') : fsEntry(path));

    expect(commands.menuItem('file.download', target).label).toBe('Download as Zip');
    commands.run('file.download', target);
    commands.run('file.download', { ...target, paths: ['docs/a.txt', 'docs/b.txt'] });

    expect(zip.mock.calls).toEqual([
      [['docs'], 'docs.zip'],
      [['docs/a.txt', 'docs/b.txt'], 'docs.zip'],
    ]);
  });
});
