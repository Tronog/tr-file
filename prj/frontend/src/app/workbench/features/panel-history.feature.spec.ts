import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  detailsUrl,
  fsDirectory,
  fsDirectoryDetails,
  fsEntry,
  fsEnvelope,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 001, §6.2.1 — each panel's own trail of folders, walked with
 * `Alt`+`←`/`→`.
 */

const ROOT_ENTRIES = [
  fsDirectory('docs'),
  fsDirectory('mockup'),
  fsDirectory('prj'),
  fsEntry('README.md', { size: 27 }),
];

describe('PanelHistoryFeature', () => {
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
    http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDirectoryDetails('', { entryCount: 4 })));
    await settled();
  };

  const groupId = (): string => workbench.activeGroupId();
  const history = () => workbench.panelHistoryFt;
  const pathOf = (id = groupId()): string | undefined => workbench.editorGroupsFt.pathOf(id);

  /** Navigates the active panel and answers the listing it asks for. */
  const goTo = async (path: string, entries = ROOT_ENTRIES): Promise<void> => {
    workbench.fileBrowserFt.navigateTo(groupId(), path, path || 'tr-file');
    const pending = http.match(listUrl(path));
    for (const request of pending) {
      request.flush(fsEnvelope(fsListing(path, entries)));
    }
    await settled();
  };

  /** Walks back or forward, answering whatever listing that needs. */
  const walk = async (direction: 'back' | 'forward'): Promise<void> => {
    const id = groupId();
    if (direction === 'back') {
      history().back(id);
    } else {
      history().forward(id);
    }
    for (const request of http.match(() => true)) {
      request.flush(fsEnvelope(fsListing('', [])));
    }
    await settled();
  };

  it('starts the panel’s trail at the folder it opens on', async () => {
    await start();

    expect(history().entriesOf(groupId())).toEqual(['']);
    // Nowhere to go in either direction from a single stop.
    expect(history().canGoBack(groupId())).toBe(false);
    expect(history().canGoForward(groupId())).toBe(false);
  });

  it('records each folder the panel visits', async () => {
    await start();
    await goTo('docs');
    await goTo('prj');

    expect(history().entriesOf(groupId())).toEqual(['', 'docs', 'prj']);
    expect(history().canGoBack(groupId())).toBe(true);
  });

  it('goes back and forward along the trail', async () => {
    await start();
    await goTo('docs');
    await goTo('prj');

    await walk('back');
    expect(pathOf()).toBe('docs');
    await walk('back');
    expect(pathOf()).toBe('');

    await walk('forward');
    expect(pathOf()).toBe('docs');
    await walk('forward');
    expect(pathOf()).toBe('prj');
  });

  /** Walking the trail must not extend the trail it is walking. */
  it('does not record the moves it makes itself', async () => {
    await start();
    await goTo('docs');
    await goTo('prj');

    await walk('back');
    await walk('back');
    await walk('forward');

    expect(history().entriesOf(groupId())).toEqual(['', 'docs', 'prj']);
  });

  it('stops at either end rather than wrapping', async () => {
    await start();
    await goTo('docs');

    await walk('back');
    expect(pathOf()).toBe('');
    await walk('back');
    expect(pathOf()).toBe('');

    await walk('forward');
    await walk('forward');
    expect(pathOf()).toBe('docs');
  });

  /** A browser abandons the forward trail on a new visit; so does a panel. */
  it('drops what lay ahead once the panel goes somewhere new', async () => {
    await start();
    await goTo('docs');
    await goTo('prj');
    await walk('back');
    await walk('back');
    expect(history().canGoForward(groupId())).toBe(true);

    await goTo('mockup');

    expect(history().entriesOf(groupId())).toEqual(['', 'mockup']);
    expect(history().canGoForward(groupId())).toBe(false);
  });

  it('treats opening the same folder twice as one stop', async () => {
    await start();
    await goTo('docs');
    await goTo('docs');

    expect(history().entriesOf(groupId())).toEqual(['', 'docs']);
  });

  it('is reached by Alt+Left and Alt+Right through the panel keyboard', async () => {
    await start();
    await goTo('docs');

    workbench.panelKeyboardFt.run(groupId(), { command: 'back', entryId: null });
    for (const request of http.match(() => true)) {
      request.flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    }
    await settled();
    expect(pathOf()).toBe('');

    workbench.panelKeyboardFt.run(groupId(), { command: 'forward', entryId: null });
    for (const request of http.match(() => true)) {
      request.flush(fsEnvelope(fsListing('docs', [])));
    }
    await settled();
    expect(pathOf()).toBe('docs');
  });

  /**
   * The failure this section really had: an empty folder has nothing to focus,
   * so the keyboard fell out of the panel and the *next* `Alt`+`←` reached
   * nothing. The body keeps focus now, but the trail has to be right too.
   */
  it('walks in and out of an empty folder', async () => {
    await start();
    await goTo('docs');
    // An empty listing is still a stop on the trail.
    await goTo('docs/empty', []);

    expect(history().entriesOf(groupId())).toEqual(['', 'docs', 'docs/empty']);

    await walk('back');
    expect(pathOf()).toBe('docs');
    await walk('forward');
    expect(pathOf()).toBe('docs/empty');
    await walk('back');
    expect(pathOf()).toBe('docs');
  });

  /** PRD 002, §2.1 — Back and Forward put back what was selected, and the cursor. */
  describe('remembering the selection', () => {
    const DOCS = [fsDirectory('docs/prd'), fsEntry('docs/a.md'), fsEntry('docs/b.md'), fsEntry('docs/c.md')];
    const group = () => workbench.editorGroupsFt.stateOf(groupId());

    /** Selects in the active panel, answering the details the sidebar asks for. */
    const select = (selected: readonly string[], focused: string): void => {
      workbench.fileBrowserFt.setSelection(groupId(), { selected, focused });
      for (const request of http.match(() => true)) {
        request.flush(fsEnvelope(fsDirectoryDetails(request.request.params.get('path') ?? '')));
      }
    };

    /** Walks, answering each listing with what that folder holds. */
    const walkTo = async (direction: 'back' | 'forward'): Promise<void> => {
      const id = groupId();
      if (direction === 'back') {
        history().back(id);
      } else {
        history().forward(id);
      }
      for (const request of http.match(() => true)) {
        const path = request.request.params.get('path') ?? '';
        if (request.request.url.endsWith('/list')) {
          request.flush(fsEnvelope(fsListing(path, path === 'docs' ? DOCS : path === '' ? ROOT_ENTRIES : [])));
        } else {
          request.flush(fsEnvelope(fsDirectoryDetails(path)));
        }
      }
      await settled();
    };

    it('puts back the selection and the cursor of each folder, going back and forward', async () => {
      await start();
      await goTo('docs', DOCS);
      select(['docs/a.md', 'docs/c.md'], 'docs/c.md');

      await goTo('docs/prd', [fsEntry('docs/prd/001.md'), fsEntry('docs/prd/002.md')]);
      expect(group()?.selection).toEqual([]);
      select(['docs/prd/002.md'], 'docs/prd/002.md');

      await walkTo('back');
      expect(pathOf()).toBe('docs');
      expect(group()?.selection).toEqual(['docs/a.md', 'docs/c.md']);
      expect(group()?.focusedEntryId).toBe('docs/c.md');
      // The details sidebar follows the cursor back too.
      expect(workbench.selectedEntryId()).toBe('docs/c.md');

      await walkTo('forward');
      expect(pathOf()).toBe('docs/prd');
      expect(group()?.selection).toEqual(['docs/prd/002.md']);
      expect(group()?.focusedEntryId).toBe('docs/prd/002.md');
    });

    it('keeps a selection changed after coming back', async () => {
      await start();
      await goTo('docs', DOCS);
      select(['docs/a.md'], 'docs/a.md');
      await goTo('docs/prd', []);
      await walkTo('back');
      select(['docs/b.md'], 'docs/b.md');
      await walkTo('forward');
      await walkTo('back');

      expect(group()?.selection).toEqual(['docs/b.md']);
      expect(group()?.focusedEntryId).toBe('docs/b.md');
    });

    it('restores nothing into an empty folder, and leaves one without trouble', async () => {
      await start();
      await goTo('docs', DOCS);
      select(['docs/b.md'], 'docs/b.md');
      await goTo('docs/empty', []);
      await walkTo('back');
      await walkTo('forward');

      expect(pathOf()).toBe('docs/empty');
      expect(group()?.selection).toEqual([]);

      await walkTo('back');
      expect(group()?.selection).toEqual(['docs/b.md']);
    });

    it('does not carry a selection into a folder visited anew', async () => {
      await start();
      await goTo('docs', DOCS);
      select(['docs/a.md'], 'docs/a.md');
      await goTo('');
      await goTo('docs', DOCS);

      expect(group()?.selection).toEqual([]);
    });
  });

  describe('with two panels', () => {
    /**
     * The point of keeping a trail per panel: two panels are two places
     * someone is working, and going back in one must not move the other.
     */
    it('keeps a separate trail for each, and moves only the one asked', async () => {
      await start();
      const first = groupId();
      await goTo('docs');

      workbench.editorGroupsFt.runAction(first, 'split-right');
      const second = groupId();
      expect(second).not.toBe(first);
      await goTo('prj');

      expect(history().entriesOf(first)).toEqual(['', 'docs']);
      // The split starts its own trail where it was born, not its neighbour's.
      expect(history().entriesOf(second)).toEqual(['docs', 'prj']);

      history().back(second);
      for (const request of http.match(() => true)) {
        request.flush(fsEnvelope(fsListing('docs', [])));
      }
      await settled();

      expect(pathOf(second)).toBe('docs');
      expect(pathOf(first)).toBe('docs');
      expect(history().entriesOf(first)).toEqual(['', 'docs']);
    });

    it('forgets a panel’s trail when the panel closes', async () => {
      await start();
      const first = groupId();
      workbench.editorGroupsFt.runAction(first, 'split-right');
      const second = groupId();
      expect(history().entriesOf(second)).not.toEqual([]);

      const tabId = workbench.editorGroupsFt.group(second)?.tabs[0]?.id ?? '';
      workbench.editorGroupsFt.closeTab(second, tabId);
      await settled();

      expect(history().entriesOf(second)).toEqual([]);
    });
  });
});
