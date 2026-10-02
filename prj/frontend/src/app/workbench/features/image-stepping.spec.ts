import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { detailsUrl, downloadUrl, fsDetails, fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { provideOnePanel } from '../testing/one-panel';
import { WorkbenchService } from '../workbench.service';

/** A folder of pictures and other things, listed out of order. */
const PICTURES = [
  fsEntry('pics/c.gif', { size: 30 }),
  fsEntry('pics/notes.txt', { size: 10 }),
  fsEntry('pics/a.png', { size: 10 }),
  fsDirectory('pics/zz.png'),
  fsEntry('pics/b.jpg', { size: 20 }),
];

/**
 * PRD 012, §1.1 — `PgUp` / `PgDown` over an image go to the previous or next
 * image of its folder, in the order the panel lists it, round at either end.
 */
describe('Stepping through the images of a folder', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let groupId: string;

  beforeEach(async () => {
    let made = 0;
    URL.createObjectURL = () => `blob:image/${made++}`;
    URL.revokeObjectURL = () => undefined;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.start();
    answer();
    await settled();
    groupId = workbench.activeGroupId();
  });

  afterEach(() => http.verify());

  /** Answers every request but the pictures in `holding`, which are returned unanswered. */
  function answer(holding: readonly string[] = []): TestRequest[] {
    const held: TestRequest[] = [];
    for (const request of http.match(() => true)) {
      const url = request.request.urlWithParams;
      const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
      if (url === listUrl('')) {
        request.flush(fsEnvelope(fsListing('', [fsDirectory('pics')])));
      } else if (url === listUrl('pics')) {
        request.flush(fsEnvelope(fsListing('pics', PICTURES)));
      } else if (url === downloadUrl(path)) {
        if (holding.includes(path)) {
          held.push(request);
        } else {
          request.flush(new Blob(['PIC'], { type: 'image/png' }));
        }
      } else if (url === detailsUrl(path)) {
        request.flush(fsEnvelope(fsDetails(path)));
      }
    }
    return held;
  }

  const shown = () => {
    const group = workbench.editorGroupsFt.stateOf(groupId);
    return group?.tabs.map((tab) => `${tab.path}${tab.active ? '*' : ''}`);
  };

  /** Presses `PgUp` / `PgDown` and answers what it asks for — reading the folder, then the picture — until it is done. */
  const step = async (direction: -1 | 1): Promise<void> => {
    let finished = false;
    void workbench.filePreviewFt.stepImage(groupId, direction).then(() => (finished = true));
    for (let round = 0; round < 10 && !finished; round++) {
      await settled();
      answer();
    }
    await settled();
    answer();
  };

  /** Opens the folder and a picture in it, as a double click on its row would. */
  async function openPicture(path: string): Promise<void> {
    workbench.fileBrowserFt.navigateTo(groupId, 'pics', 'pics');
    answer();
    await settled();
    workbench.fileBrowserFt.openEntry(groupId, path);
    await settled();
    answer();
    await settled();
  }

  it('goes to the next and the previous image by name, passing everything else, round at the ends', async () => {
    await openPicture('pics/a.png');
    expect(shown()).toEqual(['pics', 'pics/a.png*']);

    await step(1);
    expect(shown()).toEqual(['pics', 'pics/b.jpg*']);
    expect(workbench.selectedEntryId()).toBe('pics/b.jpg');
    await step(1);
    expect(shown()).toEqual(['pics', 'pics/c.gif*']);
    await step(1);
    expect(shown()).toEqual(['pics', 'pics/a.png*']);
    await step(-1);
    expect(shown()).toEqual(['pics', 'pics/c.gif*']);
  });

  it('follows the order the folder is sorted in', async () => {
    workbench.fileBrowserFt.navigateTo(groupId, 'pics', 'pics');
    answer();
    await settled();
    workbench.fileBrowserFt.setSort(groupId, { key: 'size', direction: 'desc' });
    workbench.fileBrowserFt.openEntry(groupId, 'pics/c.gif');
    await settled();
    answer();
    await settled();

    await step(1);
    expect(shown()?.at(-1)).toBe('pics/b.jpg*');
    await step(1);
    expect(shown()?.at(-1)).toBe('pics/a.png*');
  });

  it('keeps the picture on screen until the next has loaded, counting on from it when pressed again', async () => {
    await openPicture('pics/a.png');

    const first = workbench.filePreviewFt.stepImage(groupId, 1);
    await settled();
    const [held] = answer(['pics/b.jpg']);
    // Nothing blank meanwhile: the tab still shows a.png, and has a picture.
    expect(shown()).toEqual(['pics', 'pics/a.png*']);
    expect(workbench.fileBrowserFt.browser(groupId)?.document?.kind).toBe('image');

    // Pressed again before b.jpg arrives: on to c.gif, and b.jpg is never shown.
    const second = workbench.filePreviewFt.stepImage(groupId, 1);
    await settled();
    answer();
    await second;
    held?.flush(new Blob(['PIC'], { type: 'image/png' }));
    await first;
    await settled();
    answer();

    expect(shown()).toEqual(['pics', 'pics/c.gif*']);
  });

  it('reads the folder first when the picture was opened from elsewhere', async () => {
    workbench.filePreviewFt.open('pics/b.jpg');
    await settled();
    answer();
    await settled();

    await step(-1);
    expect(shown()?.at(-1)).toBe('pics/a.png*');
  });

  it('does nothing over anything but an image', async () => {
    workbench.fileBrowserFt.navigateTo(groupId, 'pics', 'pics');
    answer();
    await settled();

    await step(1);
    expect(shown()).toEqual(['pics*']);
  });

  /** PRD 012, §1.1.1 — the listing the picture was opened from follows it. */
  describe('the listing it was opened from', () => {
    const selectionOf = (id: string) => {
      const group = workbench.editorGroupsFt.stateOf(id);
      return { selection: group?.selection, focused: group?.focusedEntryId };
    };

    it('has its cursor on the last picture seen when the viewer is closed', async () => {
      await openPicture('pics/a.png');
      await step(1);
      await step(1);

      const viewer = workbench.editorGroupsFt.stateOf(groupId)?.tabs.find((tab) => tab.active)?.id as string;
      workbench.editorGroupsFt.closeTab(groupId, viewer);
      answer();
      await settled();

      expect(shown()).toEqual(['pics*']);
      expect(selectionOf(groupId)).toEqual({ selection: ['pics/c.gif'], focused: 'pics/c.gif' });
      expect(workbench.fileBrowserFt.browser(groupId)?.rows.find((row) => row.selected)?.id).toBe('pics/c.gif');
    });

    it('moves along in the other panel, which stays where it is, when Ctrl+Enter opened it there', async () => {
      workbench.fileBrowserFt.navigateTo(groupId, 'pics', 'pics');
      answer();
      await settled();
      workbench.fileBrowserFt.openEntryAside(groupId, 'pics/a.png');
      await settled();
      answer();
      await settled();
      const viewerGroup = workbench.activeGroupId();
      expect(viewerGroup).not.toBe(groupId);

      let finished = false;
      void workbench.filePreviewFt.stepImage(viewerGroup, 1).then(() => (finished = true));
      for (let round = 0; round < 10 && !finished; round++) {
        await settled();
        answer();
      }

      expect(selectionOf(groupId)).toEqual({ selection: ['pics/b.jpg'], focused: 'pics/b.jpg' });
      expect(workbench.activeGroupId()).toBe(viewerGroup);
    });

    it('is left alone once it shows another folder', async () => {
      await openPicture('pics/a.png');
      const listing = workbench.editorGroupsFt.stateOf(groupId)?.tabs.find((tab) => !tab.active)?.id as string;
      workbench.editorGroupsFt.selectTab(groupId, listing);
      workbench.fileBrowserFt.navigateTo(groupId, '', 'root');
      answer();
      await settled();
      const viewer = workbench.editorGroupsFt.stateOf(groupId)?.tabs.find((tab) => !tab.active)?.id as string;
      workbench.editorGroupsFt.selectTab(groupId, viewer);
      answer();
      await settled();

      await step(1);
      workbench.editorGroupsFt.closeTab(groupId, viewer);
      answer();
      await settled();

      expect(workbench.editorGroupsFt.pathOf(groupId)).toBe('');
      expect(selectionOf(groupId).selection).toEqual([]);
    });
  });
});
