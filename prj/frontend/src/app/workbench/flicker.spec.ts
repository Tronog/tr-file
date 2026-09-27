import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  UI_LOADING_RAIL_DELAY_MS,
  UiPanelGrid,
  UiPanelGroup,
  type UiGridNode,
  type UiPanelGroupModel,
} from '@tr-file/ui';
import { ImageSourceService } from '../file-system/image-source.service';
import {
  detailsUrl,
  downloadUrl,
  fsDetails,
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsListing,
  listUrl,
  settled,
} from './testing/fs-fixtures';
import { WorkbenchService } from './workbench.service';

/**
 * No blank frame between an action and its result: what is on screen stays
 * there while it is being refreshed, and a loading cue appears only when there
 * is nothing to show yet — or the wait is long enough to be worth one.
 */

describe('Reloads keep what is on screen', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const flush = async (path: string, entries = [fsEntry(`${path ? `${path}/` : ''}a.txt`)]) => {
    http.expectOne(listUrl(path)).flush(fsEnvelope(fsListing(path, entries)));
    await settled();
  };

  it('keeps a listing’s entries while it reloads', async () => {
    workbench.fsDataFt.ensureListing('docs');
    await flush('docs');

    workbench.fsDataFt.reloadListing('docs');

    expect(workbench.fsDataFt.listingState('docs')?.status).toBe('loading');
    expect(workbench.fsDataFt.entries('docs').map((entry) => entry.path)).toEqual(['docs/a.txt']);
    await flush('docs', [fsEntry('docs/a.txt'), fsEntry('docs/b.txt')]);
    expect(workbench.fsDataFt.entries('docs')).toHaveLength(2);
  });

  it('reads a folder once more when asked to reload while a read was in flight', async () => {
    workbench.fsDataFt.ensureListing('docs');
    workbench.fsDataFt.reloadListing('docs');
    workbench.fsDataFt.reloadListing('docs');

    await flush('docs');
    // The answer may predate the change: one more read, not two.
    await flush('docs', [fsEntry('docs/a.txt'), fsEntry('docs/new.txt')]);

    expect(workbench.fsDataFt.entries('docs')).toHaveLength(2);
  });

  it('keeps an entry’s details while they reload', async () => {
    workbench.fsDataFt.ensureDetails('a.txt');
    http.expectOne(detailsUrl('a.txt')).flush(fsEnvelope(fsDetails('a.txt')));
    await settled();

    workbench.fsDataFt.reloadDetails('a.txt');

    expect(workbench.fsDataFt.detailsState('a.txt')?.details?.path).toBe('a.txt');
    http.expectOne(detailsUrl('a.txt')).flush(fsEnvelope(fsDetails('a.txt')));
    await settled();
  });

  it('keeps the explorer tree up while the root reloads', async () => {
    workbench.explorerFt.start();
    await flush('', [fsDirectory('docs'), fsEntry('a.txt')]);
    const nodes = workbench.explorerFt.nodes().length;

    workbench.explorerFt.refresh();

    expect(workbench.explorerFt.loading()).toBe(false);
    expect(workbench.explorerFt.nodes().length).toBe(nodes);
    await flush('', [fsDirectory('docs'), fsEntry('a.txt')]);
  });

  it('keeps a panel’s rows and count while it refreshes', async () => {
    workbench.editorGroupsFt.start();
    await flush('', [fsEntry('a.txt'), fsEntry('b.txt')]);
    const group = workbench.activeGroupId();

    workbench.fileBrowserFt.runToolbarAction(group, 'refresh');

    const browser = workbench.fileBrowserFt.browser(group);
    expect(browser?.rows.map((row) => row.id)).toEqual(['a.txt', 'b.txt']);
    expect(browser?.summary).toBe('2 items');
    expect(browser?.empty).toBeUndefined();
    await flush('', [fsEntry('a.txt'), fsEntry('b.txt')]);
  });

  it('keeps an empty folder’s notice up while it refreshes', async () => {
    workbench.editorGroupsFt.start();
    await flush('', []);
    const group = workbench.activeGroupId();

    workbench.fileBrowserFt.runToolbarAction(group, 'refresh');

    expect(workbench.fileBrowserFt.browser(group)?.empty?.title).toBe('This folder is empty');
    await flush('', []);
  });

  it('shows an empty body — not an empty file table — while a file tab reads', async () => {
    workbench.editorGroupsFt.start();
    await flush('', [fsEntry('notes.txt')]);
    const group = workbench.activeGroupId();

    workbench.fileBrowserFt.openFile(group, 'notes.txt', 'notes.txt');
    workbench.filePreviewFt.load('notes.txt');

    expect(workbench.fileBrowserFt.browser(group)?.pending).toBe(true);
    http.expectOne(downloadUrl('notes.txt')).flush(new Blob(['hello']));
    await settled();
    await settled();
    expect(workbench.fileBrowserFt.browser(group)?.pending).toBeUndefined();
    expect(workbench.fileBrowserFt.browser(group)?.document).toBeDefined();
  });

  describe('the details sidebar', () => {
    const answer = async (path: string) => {
      http.expectOne(detailsUrl(path)).flush(fsEnvelope(fsDetails(path)));
      await settled();
    };

    it('keeps the previous entry up, marked stale, while the next one loads', async () => {
      workbench.select('a.txt');
      await answer('a.txt');
      // What the sidebar renders; it is what the next frame is kept from.
      expect(workbench.detailsFt.preview()?.title).toBe('a.txt');

      workbench.select('b.txt');

      expect(workbench.detailsFt.hasDetails()).toBe(true);
      expect(workbench.detailsFt.stale()).toBe(true);
      expect(workbench.detailsFt.preview()?.title).toBe('a.txt');

      await answer('b.txt');
      expect(workbench.detailsFt.stale()).toBe(false);
      expect(workbench.detailsFt.preview()?.title).toBe('b.txt');
    });

    it('never acts on the stale entry', async () => {
      workbench.select('a.txt');
      await answer('a.txt');
      workbench.detailsFt.preview();
      workbench.select('b.txt');
      expect(workbench.detailsFt.stale()).toBe(true);
      const download = vi.spyOn(workbench.transfersFt, 'download').mockImplementation(() => undefined);

      workbench.detailsFt.runAction('download');

      expect(download).not.toHaveBeenCalled();
      await answer('b.txt');
    });
  });
});

describe('ImageSourceService reload', () => {
  it('keeps the old picture until the new one replaces it, then frees it', async () => {
    const revoked: string[] = [];
    let made = 0;
    URL.createObjectURL = () => `blob:image/${(made += 1)}`;
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const images = TestBed.inject(ImageSourceService);
    const http = TestBed.inject(HttpTestingController);

    const first = images.load('photo.png');
    http.expectOne(downloadUrl('photo.png')).flush(new Blob(['PNG']));
    await first;

    const again = images.reload('photo.png');
    expect(images.urlFor('photo.png')).toBe('blob:image/1');
    expect(revoked).toEqual([]);

    http.expectOne(downloadUrl('photo.png')).flush(new Blob(['PNG2']));
    await again;
    expect(images.urlFor('photo.png')).toBe('blob:image/2');
    expect(revoked).toEqual(['blob:image/1']);
    http.verify();
  });
});

describe('UiPanelGroup loading rail', () => {
  const GROUP: UiPanelGroupModel = { id: 'g', tabs: [{ id: 't', label: 'tr-file', icon: 'folder', active: true }], actions: [] };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows only once a load has lasted a moment, and goes with it', async () => {
    const fixture = TestBed.createComponent(UiPanelGroup);
    const rail = () => fixture.nativeElement.querySelector('.loading-rail ui-progress');
    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();

    fixture.componentRef.setInput('group', { ...GROUP, loading: true });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(UI_LOADING_RAIL_DELAY_MS - 10);
    fixture.detectChanges();
    expect(rail()).toBeNull();

    // A quick answer: the bar never appeared.
    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(50);
    fixture.detectChanges();
    expect(rail()).toBeNull();

    // A slow one: it appears after the delay, and goes when the load ends.
    fixture.componentRef.setInput('group', { ...GROUP, loading: true });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(UI_LOADING_RAIL_DELAY_MS);
    fixture.detectChanges();
    expect(rail()).not.toBeNull();
    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();
    expect(rail()).toBeNull();
  });
});

/** Stands in for a panel group: remembers which instance rendered which group. */
let created = 0;
@Component({ selector: 'app-probe', template: `{{ groupId() }}` })
class Probe {
  readonly groupId = input.required<string>();
  readonly instance = (created += 1);
}

@Component({
  selector: 'app-grid-host',
  imports: [UiPanelGrid, Probe],
  template: `
    <ui-panel-grid [node]="node()" [maximizedGroupId]="maximized()">
      <ng-template #leaf let-groupId>
        <app-probe [groupId]="groupId" [attr.data-group]="groupId" />
      </ng-template>
    </ui-panel-grid>
  `,
})
class GridHost {
  readonly node = signal<UiGridNode>({
    kind: 'split',
    direction: 'row',
    children: [
      { kind: 'leaf', groupId: 'a' },
      { kind: 'leaf', groupId: 'b' },
      { kind: 'leaf', groupId: 'c' },
    ],
  });
  readonly maximized = signal<string | null>(null);
}

describe('UiPanelGrid keeps groups alive', () => {
  const instances = (element: HTMLElement): Record<string, string> =>
    Object.fromEntries(
      [...element.querySelectorAll('app-probe')].map((probe) => [probe.getAttribute('data-group'), probe.textContent ?? '']),
    );

  it('keeps each survivor’s own component when an earlier group closes', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();
    const probe = (id: string) => fixture.nativeElement.querySelector(`[data-group="${id}"]`);
    const before = { b: probe('b'), c: probe('c') };

    fixture.componentInstance.node.set({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'leaf', groupId: 'b' },
        { kind: 'leaf', groupId: 'c' },
      ],
    });
    fixture.detectChanges();

    expect(probe('b')).toBe(before.b);
    expect(probe('c')).toBe(before.c);
    expect(instances(fixture.nativeElement)).toEqual({ b: 'b', c: 'c' });
  });

  it('maximizes and restores without rebuilding any group', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();
    const probes = () => [...fixture.nativeElement.querySelectorAll('app-probe')];
    const before = probes();

    fixture.componentInstance.maximized.set('b');
    fixture.detectChanges();
    const cells = [...fixture.nativeElement.querySelectorAll('.cell')] as HTMLElement[];
    expect(probes()).toEqual(before);
    expect(cells.map((cell) => cell.classList.contains('is-hidden'))).toEqual([true, false, true]);
    expect(cells.map((cell) => cell.hasAttribute('inert'))).toEqual([true, false, true]);

    fixture.componentInstance.maximized.set(null);
    fixture.detectChanges();
    expect(probes()).toEqual(before);
    expect(fixture.nativeElement.querySelectorAll('.cell.is-hidden')).toHaveLength(0);
  });
});
