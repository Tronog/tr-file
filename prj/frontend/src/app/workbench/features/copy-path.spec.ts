import { HttpParams, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 003, §5 and PRD 004, §1.3.2 — *Copy Path*, from the menus and the details
 * sidebar: the full path on the server's disk, or why it could not be copied.
 */
describe('Copy Path', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  const clipboard = globalThis.navigator.clipboard;

  /** Replaces the page's Clipboard API — `undefined` is a page it is not open to. */
  function useClipboard(value: Partial<Clipboard> | undefined): void {
    Object.defineProperty(globalThis.navigator, 'clipboard', { value, configurable: true });
  }

  /** jsdom has no `execCommand`; the old way of copying is given one to answer with. */
  function useExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const exec = vi.fn(() => result);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    return exec;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    useClipboard(clipboard);
    vi.restoreAllMocks();
    http.verify();
  });

  const target = (paths: readonly string[], folder: string | null = 'docs') => ({ groupId: 'group-root', paths, folder });

  /** The server says where the entries are on its disk (PRD 004, §1.3.2). */
  async function answerHostPaths(paths: readonly string[], answer: readonly string[] = paths.map((path) => `/srv/files/${path}`)): Promise<void> {
    await Promise.resolve();
    const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/host-paths'));
    expect(request.request.method).toBe('GET');
    expect(request.request.url).toBe(`/api/fs/host-paths?${paths.reduce((params, path) => params.append('path', path), new HttpParams()).toString()}`);
    request.flush({ data: { paths: answer } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('copies the full path of each, one per line', async () => {
    const writeText = vi.fn(async () => undefined);
    useClipboard({ writeText });
    workbench.commandsFt.run('file.copyPath', target(['docs/a.md', 'docs/b c.txt']));
    await answerHostPaths(['docs/a.md', 'docs/b c.txt']);
    expect(writeText).toHaveBeenCalledWith('/srv/files/docs/a.md\n/srv/files/docs/b c.txt');
  });

  /** PRD 004, §1.3.2 — `Ctrl`+`Shift`+`C` twice: a Windows server's paths the UNIX way. */
  it('copies UNIX paths when asked to', async () => {
    const writeText = vi.fn(async () => undefined);
    useClipboard({ writeText });
    const copying = workbench.systemOpenFt.copyPaths(['docs/a.md', 'docs'], 'unix');
    await answerHostPaths(['docs/a.md', 'docs'], ['C:\\files\\docs\\a.md', 'C:\\files\\docs']);
    await copying;
    expect(writeText).toHaveBeenCalledWith('/C/files/docs/a.md\n/C/files/docs');
  });

  it('copies the folder itself when nothing is selected — the root too', async () => {
    const writeText = vi.fn(async () => undefined);
    useClipboard({ writeText });
    workbench.commandsFt.run('file.copyPath', target([], ''));
    await answerHostPaths([''], ['/srv/files']);
    expect(writeText).toHaveBeenCalledWith('/srv/files');
  });

  it("copies the path as the app shows it from a server too old to say where it is", async () => {
    const writeText = vi.fn(async () => undefined);
    useClipboard({ writeText });
    workbench.commandsFt.run('file.copyPath', target(['docs/a.md']));
    await Promise.resolve();
    http
      .expectOne((candidate) => candidate.url.startsWith('/api/fs/host-paths'))
      .flush({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404, statusText: 'Not Found' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith('/docs/a.md');
  });

  it('falls back to selecting the text where the Clipboard API is not open to the page', async () => {
    useClipboard(undefined);
    const exec = useExecCommand(true);
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
    const copying = workbench.systemOpenFt.copyPaths(['docs/a.md']);
    await answerHostPaths(['docs/a.md']);
    await copying;
    expect(exec).toHaveBeenCalledWith('copy');
    expect(message).not.toHaveBeenCalled();
    // The field it copied from is gone again.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back too when the Clipboard API refuses', async () => {
    useClipboard({ writeText: vi.fn(async () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))) });
    const exec = useExecCommand(true);
    const copying = workbench.systemOpenFt.copyPaths(['docs/a.md']);
    await answerHostPaths(['docs/a.md']);
    await copying;
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('says so when nothing could be copied, rather than doing nothing', async () => {
    useClipboard(undefined);
    useExecCommand(false);
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
    const copying = workbench.systemOpenFt.copyPaths(['docs/a.md']);
    await answerHostPaths(['docs/a.md']);
    await copying;
    expect(message).toHaveBeenCalledWith({
      severity: 'error',
      message: 'Could not copy the path.',
      detail: 'This browser did not let the page write to the clipboard.',
    });
  });

  it("copies the details sidebar's entry the same way", async () => {
    const writeText = vi.fn(async () => undefined);
    useClipboard({ writeText });
    workbench.select('docs/a.md');
    http.expectOne((request) => request.url.startsWith('/api/fs/details')).flush({
      data: {
        name: 'a.md',
        path: 'docs/a.md',
        type: 'file',
        size: 1,
        hidden: false,
        modifiedAt: '2026-09-20T13:04:00.000Z',
        createdAt: '2026-09-20T13:04:00.000Z',
        parent: 'docs',
        accessedAt: '2026-09-20T13:04:00.000Z',
        changedAt: '2026-09-20T13:04:00.000Z',
        mode: '0644',
        permissions: {
          owner: { read: true, write: true, execute: false },
          group: { read: true, write: false, execute: false },
          others: { read: true, write: false, execute: false },
        },
        uid: 1000,
        gid: 1000,
        inode: 1,
        sizeOnDisk: 4096,
        mimeType: 'text/markdown',
        symlinkTarget: null,
        entryCount: null,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    workbench.detailsFt.runAction('copy-path');
    await answerHostPaths(['docs/a.md']);
    expect(writeText).toHaveBeenCalledWith('/srv/files/docs/a.md');
  });
});
