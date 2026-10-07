import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { contentTag } from '../../file-system/content-tag';
import { detailsUrl, downloadUrl, fsDetails, fsDirectory, fsEntry, fsEnvelope, fsErrorBody, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { provideOnePanel } from '../testing/one-panel';
import { WorkbenchService } from '../workbench.service';

/** What is on "disk", by path: what a download answers. */
const FILES: Record<string, string> = {
  'docs/notes.md': '# Notes\r\nfirst\r\n',
  'docs/data.json': '{"a": [1, 2], "b": {"c": true}}',
  'docs/broken.json': '{"a": ',
  'docs/prices.csv': 'name;price\r\n"Smith; J";2\r\n',
};

/** PRD 005, §4–5 — editing a file in its tab, and JSON's own viewer. */
describe('The file editor', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let groupId: string;
  let writes: { path: string; expected: string | null; body: string }[];
  let refuseNextWrite: boolean;

  beforeEach(async () => {
    writes = [];
    refuseNextWrite = false;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.start();
    await answer();
    groupId = workbench.activeGroupId();
    workbench.fileBrowserFt.navigateTo(groupId, 'docs', 'docs');
    await answer();
  });

  afterEach(() => http.verify());

  /** Answers every request until none is left: listings, details, downloads and writes. */
  async function answer(): Promise<void> {
    for (let round = 0; round < 6; round++) {
      await settled();
      for (const request of http.match(() => true)) {
        await respond(request);
      }
    }
    await settled();
  }

  async function respond(request: TestRequest): Promise<void> {
    const url = request.request.urlWithParams;
    const params = new URL(url, 'http://x').searchParams;
    const path = params.get('path') ?? '';
    if (url === listUrl('')) {
      request.flush(fsEnvelope(fsListing('', [fsDirectory('docs')])));
    } else if (url === listUrl('docs')) {
      request.flush(fsEnvelope(fsListing('docs', Object.keys(FILES).map((file) => fsEntry(file, { size: (FILES[file] as string).length })))));
    } else if (url === downloadUrl(path)) {
      request.flush(new Blob([FILES[path] ?? '']));
    } else if (url === detailsUrl(path)) {
      request.flush(fsEnvelope(fsDetails(path)));
    } else if (url.startsWith('/api/fs/write')) {
      const body = await (request.request.body as Blob).text();
      writes.push({ path, expected: params.get('expected'), body });
      if (refuseNextWrite) {
        refuseNextWrite = false;
        request.flush(fsErrorBody('CHANGED', 'changed on disk'), { status: 409, statusText: 'Conflict' });
      } else {
        request.flush(fsEnvelope(fsDetails(path)));
      }
    }
  }

  const tab = () => {
    const group = workbench.editorGroupsFt.stateOf(groupId);
    return group === undefined ? undefined : workbench.editorGroupsFt.activeTabOf(group);
  };
  const document = () => workbench.fileBrowserFt.browser(groupId)?.document;
  const toolbar = () => workbench.fileBrowserFt.browser(groupId)?.toolbarActions.map((action) => action.id) ?? [];

  async function edit(path: string): Promise<void> {
    workbench.fileBrowserFt.openEntry(groupId, path);
    await answer();
    const toggling = workbench.fileEditorFt.toggle(groupId);
    await answer();
    await toggling;
  }

  it('turns the tab into the editor, with the file read afresh, its line ends as \\n and its language', async () => {
    await edit('docs/notes.md');

    expect(tab()?.path).toBe('docs/notes.md');
    expect(document()?.edit).toEqual({ text: '# Notes\nfirst\n', language: 'markdown', languageLabel: 'Markdown' });
    expect(toolbar()).toEqual(expect.arrayContaining(['edit', 'save']));
  });

  it('saves the draft as the file was — CRLF — with the tag of what was read, and is clean again', async () => {
    await edit('docs/notes.md');
    workbench.fileBrowserFt.setDocumentText(groupId, '# Notes\nsecond\n');
    expect(workbench.fileEditorFt.isDirty('docs/notes.md')).toBe(true);
    expect(workbench.editorGroupsFt.group(groupId)?.tabs.find((candidate) => candidate.active)?.dirty).toBe(true);
    expect(document()?.edit?.state).toBe('Modified');

    const saving = workbench.fileEditorFt.save('docs/notes.md');
    await answer();
    expect(await saving).toBe(true);

    expect(writes).toEqual([
      { path: 'docs/notes.md', expected: contentTag(new TextEncoder().encode('# Notes\r\nfirst\r\n')), body: '# Notes\r\nsecond\r\n' },
    ]);
    expect(workbench.fileEditorFt.isDirty('docs/notes.md')).toBe(false);
  });

  it('asks before writing over a file changed on disk, and overwrites when told to', async () => {
    await edit('docs/notes.md');
    workbench.fileBrowserFt.setDocumentText(groupId, 'mine\n');
    const ask = vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'overwrite', checked: false, value: '' });
    refuseNextWrite = true;

    const saving = workbench.fileEditorFt.save('docs/notes.md');
    await answer();
    expect(await saving).toBe(true);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(writes.map((write) => write.expected === null)).toEqual([false, true]);
  });

  it('asks before closing the tab of unsaved changes, and keeps it open on Cancel', async () => {
    await edit('docs/notes.md');
    workbench.fileBrowserFt.setDocumentText(groupId, 'changed\n');
    const ask = vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'cancel', checked: false, value: '' });

    workbench.editorGroupsFt.closeTab(groupId, tab()?.id as string);
    await answer();
    expect(ask).toHaveBeenCalled();
    expect(tab()?.path).toBe('docs/notes.md');

    ask.mockResolvedValue({ buttonId: 'discard', checked: false, value: '' });
    workbench.editorGroupsFt.closeTab(groupId, tab()?.id as string);
    await answer();
    expect(tab()?.path).toBe('docs');
    expect(workbench.fileEditorFt.isEditing('docs/notes.md')).toBe(false);
    expect(writes).toEqual([]);
  });

  it('goes back to viewing on Edit again, asking nothing when nothing changed', async () => {
    await edit('docs/notes.md');
    const ask = vi.spyOn(workbench.modal, 'show');

    await workbench.fileEditorFt.toggle(groupId);
    await answer();

    expect(ask).not.toHaveBeenCalled();
    expect(document()?.edit).toBeUndefined();
    expect(document()?.kind).toBe('markdown');
  });

  /** PRD 015, §1. */
  describe('CSV', () => {
    it('is shown as a spreadsheet of its cells, its delimiter found, or as its text', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/prices.csv');
      await answer();
      expect(document()?.kind).toBe('table');
      expect(document()?.table).toEqual({ rows: [['name', 'price'], ['Smith; J', '2']], delimiter: ';', trailingNewline: true });
      expect(document()?.edit).toBeUndefined();

      workbench.fileBrowserFt.runToolbarAction(groupId, 'text-view');
      expect(document()?.kind).toBe('text');
      workbench.fileBrowserFt.runToolbarAction(groupId, 'text-view');
      expect(document()?.kind).toBe('table');
    });

    it('is edited as a spreadsheet, and saved as the file was written — its delimiter, its CRLF', async () => {
      await edit('docs/prices.csv');
      expect(document()?.kind).toBe('table');
      expect(document()?.edit?.languageLabel).toBe('CSV');

      // What the sheet reports after a change: the cells, as the file's text.
      workbench.fileBrowserFt.setDocumentText(groupId, 'name;price\n"Smith; J";3\n');
      expect(document()?.table?.rows[1]).toEqual(['Smith; J', '3']);
      expect(workbench.fileEditorFt.isDirty('docs/prices.csv')).toBe(true);

      const saving = workbench.fileEditorFt.save('docs/prices.csv');
      await answer();
      expect(await saving).toBe(true);
      expect(writes.at(-1)?.body).toBe('name;price\r\n"Smith; J";3\r\n');
    });

    it('is edited as text in the code editor while it is shown as text', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/prices.csv');
      await answer();
      workbench.fileBrowserFt.runToolbarAction(groupId, 'text-view');
      const toggling = workbench.fileEditorFt.toggle(groupId);
      await answer();
      await toggling;

      expect(document()?.kind).toBe('text');
      expect(document()?.edit?.text).toBe('name;price\n"Smith; J";2\n');
    });
  });

  /** PRD 005, §5. */
  describe('JSON', () => {
    it('is shown as a tree of its values, or as its text', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/data.json');
      await answer();
      expect(document()?.kind).toBe('json');
      expect(document()?.json).toEqual({ a: [1, 2], b: { c: true } });

      workbench.fileBrowserFt.runToolbarAction(groupId, 'text-view');
      expect(document()?.kind).toBe('text');
      expect(document()?.text).toBe(FILES['docs/data.json']);
    });

    it('is shown as text, saying so, when it does not parse', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/broken.json');
      await answer();
      expect(document()?.kind).toBe('text');
      expect(document()?.meta).toContain('Not valid JSON');
    });

    it('marks the line of an error as it is typed, and formats what parses', async () => {
      await edit('docs/data.json');
      expect(document()?.edit?.language).toBe('json');
      expect(toolbar()).toContain('format');

      workbench.fileBrowserFt.setDocumentText(groupId, '{\n  "a": 1,\n}');
      expect(document()?.edit?.problem?.line).toBe(3);

      workbench.fileBrowserFt.setDocumentText(groupId, '{"a":1,"b":[true]}');
      workbench.fileBrowserFt.runToolbarAction(groupId, 'format');
      expect(document()?.edit?.text).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}\n');
    });

    /** PRD 005, §5.2. */
    it('is edited in its tree: the change written where it stands, the rest of the file as it was', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/data.json');
      await answer();
      expect(document()?.editable).toBe(true);
      expect(document()?.edit).toBeUndefined();

      workbench.fileBrowserFt.editJson(groupId, { pointer: '/a/1', value: 20 });
      await answer();
      expect(document()?.kind).toBe('json');
      expect(document()?.json).toEqual({ a: [1, 20], b: { c: true } });
      expect(workbench.fileEditorFt.modeOf('docs/data.json')).toBe('tree');
      expect(workbench.fileEditorFt.isDirty('docs/data.json')).toBe(true);

      workbench.fileBrowserFt.editJson(groupId, { pointer: '/b', key: 'bee' });
      await answer();
      const saving = workbench.fileEditorFt.save('docs/data.json');
      await answer();
      expect(await saving).toBe(true);
      expect(writes.at(-1)?.body).toBe('{"a": [1, 20], "bee": {"c": true}}');
    });

    it('goes on from the tree to the code editor on Edit, its changes and all', async () => {
      workbench.fileBrowserFt.openEntry(groupId, 'docs/data.json');
      await answer();
      workbench.fileBrowserFt.editJson(groupId, { pointer: '/b/c', value: false });
      await answer();
      expect(toolbar()).toEqual(expect.arrayContaining(['edit', 'save']));

      await workbench.fileEditorFt.toggle(groupId);
      expect(document()?.kind).toBe('text');
      expect(document()?.edit?.text).toBe('{"a": [1, 2], "b": {"c": false}}');
      expect(workbench.fileEditorFt.isDirty('docs/data.json')).toBe(true);
    });

    it('asks before saving what is not JSON', async () => {
      await edit('docs/data.json');
      workbench.fileBrowserFt.setDocumentText(groupId, '{"a": ');
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);

      expect(await workbench.fileEditorFt.save('docs/data.json')).toBe(false);
      expect(confirm).toHaveBeenCalled();
      expect(writes).toEqual([]);
    });
  });
});
