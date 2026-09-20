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
    workbench.editorGroupsFt.navigateTo(groupId(), path, path || 'tr-file');
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
