import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { detailsUrl, downloadUrl, fsDetails, fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

const ROOT_ENTRIES = [fsDirectory('docs'), fsEntry('README.md', { size: 27 })];
const DOCS_ENTRIES = [fsEntry('docs/NOTES.md', { size: 2048 })];

/**
 * PRD 002, §2.2 and §2.5, on the layout the workbench starts with — two panels
 * side by side: `Ctrl`+`T` opens a new tab in the panel, and `Ctrl`+`Enter`
 * (or `Ctrl`+double click) opens the entry in a new tab of the *other* panel.
 */
describe('New tabs and the other panel', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let left: string;
  let right: string;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.start();
    answer();
    await settled();
    [left, right] = workbench.panelLayoutFt.groupIds() as [string, string];
  });

  afterEach(() => http.verify());

  /** Answers whatever the workbench asked for: listings, details, a file's bytes. */
  function answer(): void {
    for (const request of http.match(() => true)) {
      const url = request.request.urlWithParams;
      if (url === listUrl('')) {
        request.flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
      } else if (url === listUrl('docs')) {
        request.flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      } else if (url === downloadUrl('README.md')) {
        request.flush(new Blob(['# hi'], { type: 'text/markdown' }));
      } else if (url.startsWith(detailsUrl(''))) {
        request.flush(fsEnvelope(fsDetails(new URL(url, 'http://x').searchParams.get('path') ?? '')));
      } else {
        request.flush(fsEnvelope({}));
      }
    }
  }

  const tabsOf = (groupId: string) => workbench.editorGroupsFt.stateOf(groupId)?.tabs.map((tab) => `${tab.kind}:${tab.path}${tab.active ? '*' : ''}`);

  it('opens a folder in a new tab of the other panel, and the keyboard goes there', async () => {
    workbench.panelKeyboardFt.run(left, { command: 'open-aside', entryId: 'docs' });
    answer();
    await settled();

    expect(tabsOf(left)).toEqual(['folder:*']);
    // The other panel keeps what it had, with the folder beside it.
    expect(tabsOf(right)).toEqual(['folder:', 'folder:docs*']);
    expect(workbench.activeGroupId()).toBe(right);
    expect(workbench.panelFocusFt.token(right)).toBeGreaterThan(0);
    expect(workbench.panelLayoutFt.groupIds()).toEqual([left, right]);
  });

  it('opens a file in the other panel, choosing the tab it is already in', async () => {
    workbench.fileBrowserFt.openEntryAside(left, 'README.md');
    answer();
    await settled();
    expect(tabsOf(right)).toEqual(['folder:', 'file:README.md*']);
    expect(workbench.fileBrowserFt.browser(right)?.document).toBeDefined();

    workbench.editorGroupsFt.focus(left);
    workbench.fileBrowserFt.openEntryAside(left, 'README.md');
    answer();
    await settled();
    expect(tabsOf(right)).toEqual(['folder:', 'file:README.md*']);
  });

  it('with two panels, always goes to the other one — even before either was left', async () => {
    workbench.previousGroupId.set(null);
    workbench.fileBrowserFt.openEntryAside(right, 'docs');
    answer();
    await settled();

    expect(tabsOf(left)).toEqual(['folder:', 'folder:docs*']);
    expect(tabsOf(right)).toEqual(['folder:*']);
  });

  it('with more than two, goes to the panel active before, not the next in the layout', async () => {
    workbench.editorGroupsFt.runAction(right, 'split-right');
    answer();
    const third = workbench.panelLayoutFt.groupIds()[2] as string;
    workbench.editorGroupsFt.focus(third);
    workbench.editorGroupsFt.focus(left);

    workbench.fileBrowserFt.openEntryAside(left, 'docs');
    answer();
    await settled();

    expect(tabsOf(third)?.at(-1)).toBe('folder:docs*');
    expect(tabsOf(right)).toEqual(['folder:*']);
  });

  it('opens a new tab on the folder the panel is on, or the one its file is in', async () => {
    workbench.editorGroupsFt.runAction(left, 'new-tab');
    answer();
    await settled();
    expect(tabsOf(left)).toEqual(['folder:', 'folder:*']);
    expect(workbench.panelFocusFt.token(left)).toBeGreaterThan(0);

    workbench.fileBrowserFt.openEntryAside(left, 'README.md');
    answer();
    await settled();
    workbench.commandsFt.run('tab.new', { groupId: right, paths: [], folder: null });
    answer();
    await settled();
    expect(tabsOf(right)).toEqual(['folder:', 'file:README.md', 'folder:*']);
  });

  /** PRD 002, §2.5.1. */
  describe('closing a tab Ctrl+Enter opened', () => {
    const activeTabOf = (groupId: string) => workbench.editorGroupsFt.stateOf(groupId)?.tabs.find((tab) => tab.active)?.id;

    it('goes back to the tab it was opened from, and gives that panel the keyboard', async () => {
      workbench.editorGroupsFt.runAction(left, 'new-tab');
      answer();
      await settled();
      const [first, from] = workbench.editorGroupsFt.stateOf(left)?.tabs.map((tab) => tab.id) ?? [];
      workbench.fileBrowserFt.openEntryAside(left, 'docs');
      answer();
      await settled();
      // Meanwhile the left panel shows another of its tabs.
      workbench.editorGroupsFt.selectTab(left, first as string);
      workbench.editorGroupsFt.focus(right);
      const before = workbench.panelFocusFt.token(left);

      workbench.editorGroupsFt.closeTab(right, activeTabOf(right) as string);
      answer();
      await settled();

      expect(tabsOf(right)).toEqual(['folder:*']);
      expect(workbench.activeGroupId()).toBe(left);
      expect(activeTabOf(left)).toBe(from);
      expect(workbench.panelFocusFt.token(left)).toBeGreaterThan(before);
    });

    it('stays where it is when the tab it was opened from has gone', async () => {
      workbench.editorGroupsFt.runAction(left, 'new-tab');
      answer();
      await settled();
      const [, from] = workbench.editorGroupsFt.stateOf(left)?.tabs.map((tab) => tab.id) ?? [];
      workbench.fileBrowserFt.openEntryAside(left, 'docs');
      answer();
      await settled();
      workbench.editorGroupsFt.closeTab(left, from as string);
      workbench.editorGroupsFt.focus(right);

      workbench.editorGroupsFt.closeTab(right, activeTabOf(right) as string);
      answer();
      await settled();

      expect(workbench.activeGroupId()).toBe(right);
      expect(tabsOf(right)).toEqual(['folder:*']);
    });
  });
});
