import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FsDetails, FsDownload, FsOperationJob, FsUpload } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { fsDetails, fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 003, §6 — files shared with the system: its clipboard, drops from it,
 * dragging out to it, whole folders uploaded, and pictures in the icon view.
 */

const done: FsOperationJob = {
  id: 'job',
  kind: 'copy',
  state: 'done',
  title: 'copy',
  startedAt: '2026-09-27T10:00:00.000Z',
  finishedAt: '2026-09-27T10:00:01.000Z',
  totalBytes: 0,
  doneBytes: 0,
  totalItems: 1,
  doneItems: 1,
  current: null,
  skipped: 0,
  error: null,
  affected: [],
};

describe('Files shared with the system', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let group: string;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http
      .expectOne(listUrl(''))
      .flush(fsEnvelope(fsListing('', [fsDirectory('docs'), fsEntry('a.txt'), fsEntry('photo.png', { size: 5000 })])));
    await settled();
    group = workbench.activeGroupId();
    vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The desktop, on its own computer: the system's clipboard and drags are this window's too. */
  function onTheDesktop() {
    const system = workbench.fileSystem.systemFt;
    vi.spyOn(system, 'sharesFiles').mockReturnValue(true);
    return {
      write: vi.spyOn(system, 'writeClipboard').mockResolvedValue(),
      read: vi.spyOn(system, 'readClipboard'),
      drag: vi.spyOn(system, 'startDrag').mockReturnValue(true),
      local: vi.spyOn(system, 'localPaths'),
    };
  }

  describe('the system clipboard', () => {
    it('is left alone in a browser', async () => {
      const write = vi.spyOn(workbench.fileSystem.systemFt, 'writeClipboard');
      workbench.fileClipboardFt.putPaths('copy', ['a.txt']);
      expect(write).not.toHaveBeenCalled();
      expect(workbench.fileClipboardFt.canPaste()).toBe(true);
      workbench.fileClipboardFt.clear();
      expect(workbench.fileClipboardFt.canPaste()).toBe(false);
    });

    it('gets what is copied or cut here, for the system’s file manager', () => {
      const desktop = onTheDesktop();
      workbench.fileClipboardFt.putPaths('cut', ['a.txt', 'docs']);
      expect(desktop.write).toHaveBeenCalledWith(['a.txt', 'docs'], true);
      // Whether the system has files is only known by asking: a paste is always offered.
      workbench.fileClipboardFt.clear();
      expect(workbench.fileClipboardFt.canPaste()).toBe(true);
    });

    it('pastes what was copied in another file manager since', async () => {
      const desktop = onTheDesktop();
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done);
      workbench.fileClipboardFt.putPaths('copy', ['a.txt']);
      desktop.read.mockResolvedValue({ paths: ['home/me/x.txt', 'home/me/y.txt'], cut: true, outside: 0 });

      await workbench.fileClipboardFt.pasteInto('docs');

      expect(start).toHaveBeenCalledWith({ kind: 'move', sources: ['home/me/x.txt', 'home/me/y.txt'], destination: 'docs', conflict: 'fail', errors: 'ask' });
      // This window's own clipboard is still there for later.
      expect(workbench.fileClipboardFt.clipboard()).toEqual({ mode: 'copy', paths: ['a.txt'] });
    });

    it('pastes its own when the system still holds what it put there', async () => {
      const desktop = onTheDesktop();
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done);
      workbench.fileClipboardFt.putPaths('cut', ['a.txt']);
      desktop.read.mockResolvedValue({ paths: ['a.txt'], cut: true, outside: 0 });

      await workbench.fileClipboardFt.pasteInto('docs');

      expect(start).toHaveBeenCalledWith({ kind: 'move', sources: ['a.txt'], destination: 'docs', conflict: 'fail', errors: 'ask' });
      expect(workbench.fileClipboardFt.clipboard()).toBeNull();
    });

    it('says so when the system’s files are out of this window’s reach', async () => {
      const desktop = onTheDesktop();
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start');
      desktop.read.mockResolvedValue({ paths: [], cut: false, outside: 2 });

      await workbench.fileClipboardFt.pasteInto('docs');

      expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: 'The files on the clipboard cannot be pasted here.' }));
      expect(start).not.toHaveBeenCalled();
    });
  });

  describe('drops and drags', () => {
    const drop = (files: readonly File[], target: string | null = null, copy = false) =>
      workbench.fileBrowserFt.dropFiles(group, { files, entries: [], target, copy });

    it('moves files of this computer dropped on a folder — a copy with Ctrl', async () => {
      const desktop = onTheDesktop();
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done);
      desktop.local.mockResolvedValue(['home/me/x.txt']);

      await drop([new File(['x'], 'x.txt')], 'docs');
      await drop([new File(['x'], 'x.txt')], null, true);
      await settled();

      expect(start.mock.calls.map(([request]) => request)).toEqual([
        { kind: 'move', sources: ['home/me/x.txt'], destination: 'docs', conflict: 'fail', errors: 'ask' },
        { kind: 'copy', sources: ['home/me/x.txt'], destination: '', conflict: 'fail', errors: 'ask' },
      ]);
    });

    it('uploads what the root does not hold — and everything, in a browser', async () => {
      const upload = vi.spyOn(workbench.transfersFt, 'uploadDropped').mockImplementation(() => undefined);
      const desktop = onTheDesktop();
      desktop.local.mockResolvedValue(['home/me/x.txt', null]);
      const files = [new File(['x'], 'x.txt'), new File(['y'], 'y.txt')];

      await drop(files, 'docs');
      desktop.local.mockRestore();
      vi.mocked(workbench.fileSystem.systemFt.sharesFiles).mockReturnValue(false);
      await drop(files);

      expect(upload.mock.calls).toEqual([
        ['docs', files, []],
        ['', files, []],
      ]);
    });

    it('hands a drag to the system on the desktop only', () => {
      expect(workbench.fileBrowserFt.nativeDrag()).toBe(false);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
      workbench = TestBed.inject(WorkbenchService);
      const desktop = onTheDesktop();

      expect(workbench.fileBrowserFt.nativeDrag()).toBe(true);
      workbench.fileBrowserFt.startNativeDrag(['a.txt']);
      expect(desktop.drag).toHaveBeenCalledWith(['a.txt']);
    });
  });

  describe('folders uploaded whole', () => {
    function stubTransfers() {
      const made: string[] = [];
      const sent: string[] = [];
      vi.spyOn(workbench.fileSystem.editFt, 'createFolder').mockImplementation(async (parent: string, name: string) => {
        const path = parent === '' ? name : `${parent}/${name}`;
        if (path === 'docs') {
          throw new FsError('taken', 409, 'CONFLICT');
        }
        if (path === 'docs/blocked') {
          throw new FsError('taken', 409, 'CONFLICT');
        }
        made.push(path);
        return fsDetails(path, { type: 'directory' });
      });
      vi.spyOn(workbench.fileSystem.readFt, 'details').mockImplementation(async (path: string): Promise<FsDetails> =>
        path === 'docs' ? fsDetails(path, { type: 'directory' }) : fsDetails(path),
      );
      vi.spyOn(workbench.fileSystem.transferFt, 'upload').mockImplementation((directory: string, file: File): FsUpload => {
        sent.push(`${directory}/${file.name}`);
        return {
          progress: signal({ loaded: file.size, total: file.size, percent: 100 }),
          result: Promise.resolve(fsDetails(`${directory}/${file.name}`)),
          cancel: () => undefined,
        };
      });
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
      return { made, sent, message };
    }

    /** A dropped folder, as the browser hands it over: entries that read their children in batches. */
    function folder(name: string, children: readonly FileSystemEntry[]): FileSystemEntry {
      return {
        name,
        isFile: false,
        isDirectory: true,
        createReader: () => {
          const batches = [children.slice(0, 1), children.slice(1), []];
          return { readEntries: (resolve: (entries: FileSystemEntry[]) => void) => resolve([...(batches.shift() ?? [])]) };
        },
      } as unknown as FileSystemEntry;
    }

    function file(name: string): FileSystemEntry {
      return {
        name,
        isFile: true,
        isDirectory: false,
        file: (resolve: (file: File) => void) => resolve(new File([name], name)),
      } as unknown as FileSystemEntry;
    }

    it('makes a dropped folder’s folders, merging into one that is there, then sends its files', async () => {
      const { made, sent } = stubTransfers();

      workbench.transfersFt.uploadDropped('', [], [folder('docs', [file('a.md'), folder('img', [file('b.png')])]), file('top.txt')]);
      await settled();
      await settled();

      expect(made).toEqual(['docs/img']);
      expect(sent.sort()).toEqual(['/top.txt', 'docs/a.md', 'docs/img/b.png']);
    });

    it('uploads a folder chosen in the picker, and leaves out what could not get a folder', async () => {
      const { made, sent, message } = stubTransfers();
      const picked = (path: string) => {
        const chosen = new File(['x'], path.split('/').at(-1) as string);
        Object.defineProperty(chosen, 'webkitRelativePath', { value: path });
        return chosen;
      };

      workbench.transfersFt.uploadFolder('docs', [picked('shots/one.png'), picked('shots/blocked/two.png')]);
      await settled();
      await settled();

      expect(made).toEqual(['docs/shots', 'docs/shots/blocked']);
      expect(sent).toEqual(['docs/shots/one.png', 'docs/shots/blocked/two.png']);
      expect(message).not.toHaveBeenCalled();

      workbench.transfersFt.uploadFolder('', [picked('docs/blocked/x.txt'), picked('docs/fine.txt')]);
      await settled();
      await settled();
      expect(sent.slice(2)).toEqual(['docs/fine.txt']);
      expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: "Could not make the folder 'docs/blocked', so what goes in it was not uploaded." }));
    });

    it('downloads a zip as a row that counts what has gone so far', () => {
      const progress = signal({ loaded: 0, total: null as number | null, percent: null as number | null });
      const download: FsDownload = { progress, result: new Promise(() => undefined), cancel: () => undefined };
      vi.spyOn(workbench.fileSystem.transferFt, 'saveZip').mockReturnValue(download);

      workbench.transfersFt.downloadZip(['docs'], 'docs.zip');
      expect(workbench.transfersFt.rows()[0]).toMatchObject({ name: 'docs.zip ← docs', statusLabel: 'starting…' });
      progress.set({ loaded: 3 * 1024 * 1024, total: null, percent: null });
      expect(workbench.transfersFt.rows()[0]?.statusLabel).toBe('3.0 MB so far');
    });
  });

  describe('thumbnails', () => {
    it('are made of the images the icon view shows, once each, and drawn in place of the icon', async () => {
      vi.stubGlobal('createImageBitmap', async () => ({ width: 400, height: 200, close: () => undefined }));
      vi.stubGlobal(
        'OffscreenCanvas',
        class {
          constructor(
            readonly width: number,
            readonly height: number,
          ) {}
          getContext() {
            return { drawImage: () => undefined };
          }
          async convertToBlob() {
            return new Blob([`${this.width}x${this.height}`]);
          }
        },
      );
      const created = vi.fn(() => 'blob:thumb');
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => undefined }));
      const read = vi.spyOn(workbench.fileSystem.transferFt, 'download').mockResolvedValue(new Blob(['png']));

      workbench.fileBrowserFt.setView(group, 'grid');
      workbench.fileBrowserFt.showItems(['docs', 'a.txt', 'photo.png']);
      workbench.fileBrowserFt.showItems(['photo.png']);
      await settled();

      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith('photo.png', 16 * 1024 * 1024);
      const item = workbench.fileBrowserFt.browser(group)?.items.find((candidate) => candidate.id === 'photo.png');
      expect(item?.thumbnail).toBe('blob:thumb');
      expect(workbench.fileBrowserFt.browser(group)?.items.find((candidate) => candidate.id === 'a.txt')?.thumbnail).toBeUndefined();
    });

    it('are not made where the browser cannot draw them', () => {
      const read = vi.spyOn(workbench.fileSystem.transferFt, 'download');
      workbench.fileBrowserFt.showItems(['photo.png']);
      expect(read).not.toHaveBeenCalled();
    });
  });
});
