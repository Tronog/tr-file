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

const ROOT_ENTRIES = [fsDirectory('docs'), fsEntry('README.md', { size: 27 })];

describe('PanelFocusFeature', () => {
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
    http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDirectoryDetails('', { entryCount: 2 })));
    await settled();
  };

  it('starts every group with no request outstanding', async () => {
    await start();

    expect(workbench.panelFocusFt.token(workbench.activeGroupId())).toBe(0);
  });

  it('bumps the group token on each ask, so asking twice is two asks', async () => {
    await start();
    const groupId = workbench.activeGroupId();

    workbench.panelFocusFt.focusBody(groupId);
    const first = workbench.panelFocusFt.token(groupId);
    workbench.panelFocusFt.focusBody(groupId);

    expect(first).toBeGreaterThan(0);
    expect(workbench.panelFocusFt.token(groupId)).toBeGreaterThan(first);
  });

  it('makes the chosen group the active one', async () => {
    await start();
    const first = workbench.activeGroupId();
    workbench.editorGroupsFt.runAction(first, 'split-right');
    expect(workbench.activeGroupId()).not.toBe(first);

    workbench.panelFocusFt.focusBody(first);

    expect(workbench.activeGroupId()).toBe(first);
  });

  it('asks one group without disturbing the other', async () => {
    await start();
    const first = workbench.activeGroupId();
    workbench.editorGroupsFt.runAction(first, 'split-right');
    const second = workbench.activeGroupId();

    workbench.panelFocusFt.focusBody(second);

    expect(workbench.panelFocusFt.token(second)).toBeGreaterThan(0);
    expect(workbench.panelFocusFt.token(first)).toBe(0);
  });
});
