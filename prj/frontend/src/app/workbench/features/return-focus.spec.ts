import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsOperationJob } from '../../file-system/file-system.model';
import { WorkbenchService } from '../workbench.service';
import { OPERATION_POLL_MS } from './operations.feature';

/** PRD 001, Fix 5 — after a file action, the keyboard is back in the panel it acted on. */

const job = (overrides: Partial<FsOperationJob> = {}): FsOperationJob => ({
  id: 'job-1',
  kind: 'trash',
  state: 'running',
  title: "Moving 'a.txt' to the trash",
  startedAt: '2026-09-27T10:00:00.000Z',
  finishedAt: null,
  totalBytes: null,
  doneBytes: 0,
  totalItems: 1,
  doneItems: 0,
  current: null,
  skipped: 0,
  error: null,
  affected: ['docs'],
  ...overrides,
});

describe('Returning focus after a file action', () => {
  let workbench: WorkbenchService;
  const group = 'group-root';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    vi.spyOn(workbench.fileSystem.operationsFt, 'operationsInfo').mockResolvedValue({ trash: 'server' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const token = () => workbench.panelFocusFt.token(group);

  /** Puts focus on an element inside a region of the given name, or on a bare element with `region` null. */
  const focusIn = (region: string | null, tag = 'button'): HTMLElement => {
    const host = document.createElement('div');
    if (region !== null) {
      host.dataset['focusRegion'] = region;
    }
    const element = document.createElement(tag);
    host.appendChild(element);
    document.body.appendChild(host);
    element.focus();
    return element;
  };

  describe('PanelFocusFeature.returnFocus', () => {
    it('takes the keyboard back from the page itself, from chrome, and from within that panel', () => {
      const before = token();
      workbench.panelFocusFt.returnFocus(group);
      expect(token()).toBeGreaterThan(before);

      focusIn(null); // the title bar, the status bar: outside every region
      const second = token();
      workbench.panelFocusFt.returnFocus(group);
      expect(token()).toBeGreaterThan(second);

      focusIn(`group:${group}`);
      const third = token();
      workbench.panelFocusFt.returnFocus(group);
      expect(token()).toBeGreaterThan(third);
    });

    it('leaves it where the user went: another part of the workbench, a text field, another window', () => {
      const before = token();

      focusIn('explorer');
      workbench.panelFocusFt.returnFocus(group);
      focusIn(null, 'input');
      workbench.panelFocusFt.returnFocus(group);
      (document.activeElement as HTMLElement).blur();
      void workbench.modal.message({ message: 'Something else' });
      workbench.panelFocusFt.returnFocus(group);

      expect(token()).toBe(before);
    });

    it('falls back to the active panel when the one it acted on has gone', () => {
      const before = token();

      workbench.panelFocusFt.returnFocus('group-gone');

      expect(token()).toBeGreaterThan(before);
    });
  });

  describe('a job', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
    });

    it('hands the keyboard back once the folders it changed are read again', async () => {
      let read!: () => void;
      vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockReturnValue(new Promise((resolve) => (read = resolve)));
      vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job({ state: 'done', doneItems: 1 }));
      const back = vi.spyOn(workbench.panelFocusFt, 'returnFocus');

      await workbench.operationsFt.trash(['docs/a.txt']);
      expect(back).not.toHaveBeenCalled();

      read();
      await vi.advanceTimersByTimeAsync(0);
      expect(back).toHaveBeenCalledWith(group);
    });

    it('waits for its progress window to close first', async () => {
      vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockResolvedValue(undefined);
      let close!: (value: null) => void;
      vi.spyOn(workbench.modal, 'open').mockReturnValue(new Promise((resolve) => (close = resolve)));
      vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job());
      const status = vi.spyOn(workbench.fileSystem.operationsFt, 'status').mockResolvedValue(job());
      const back = vi.spyOn(workbench.panelFocusFt, 'returnFocus');

      await workbench.operationsFt.trash(['docs/a.txt']);
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS); // still running: the window opens
      status.mockResolvedValue(job({ state: 'done', doneItems: 1 }));
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS); // ended, window still up
      expect(back).not.toHaveBeenCalled();

      close(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(back).toHaveBeenCalledWith(group);
    });
  });

  describe('a command', () => {
    it('hands the keyboard back when a file action from a menu or the palette is done — cancelled or not', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue(null);
      const back = vi.spyOn(workbench.panelFocusFt, 'returnFocus');
      const target = { groupId: group, paths: ['docs/a.txt'], folder: 'docs' };

      workbench.commandsFt.run('file.copyTo', target);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(back).toHaveBeenCalledWith(group);
    });

    it('leaves focus to a command that sends it somewhere on purpose', async () => {
      const back = vi.spyOn(workbench.panelFocusFt, 'returnFocus');

      workbench.commandsFt.run('edit.search');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(back).not.toHaveBeenCalled();
    });
  });
});
