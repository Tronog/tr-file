import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiPanelTab } from '@tr-file/ui';
import { fsDetails, fsEnvelope, fsErrorBody, listUrl, settled, uploadUrl } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

describe('BottomPanelFeature', () => {
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

  const tab = (id: string): UiPanelTab | undefined =>
    workbench.bottomPanelFt.tabs().find((candidate) => candidate.id === id);

  /** Makes one directory fail, which is what the Problems tab reports. */
  const failListing = async (path: string, message: string): Promise<void> => {
    workbench.fsDataFt.ensureListing(path);
    http
      .expectOne(listUrl(path))
      .flush(fsErrorBody('FORBIDDEN', message), { status: 403, statusText: 'Forbidden' });
    await settled();
  };

  it('opens on Transfers with no counts and an empty list', () => {
    expect(workbench.bottomPanelFt.tabs().map((candidate) => candidate.id)).toEqual([
      'transfers',
      'problems',
    ]);
    expect(tab('transfers')).toEqual({ id: 'transfers', label: 'Transfers', active: true });
    expect(tab('problems')).toEqual({ id: 'problems', label: 'Problems' });
    expect(workbench.bottomPanelFt.transfersEmpty()).toBe(true);
    expect(workbench.bottomPanelFt.transfersVisible()).toBe(true);
    expect(workbench.bottomPanelFt.problemsVisible()).toBe(false);
    expect(workbench.bottomPanelFt.problems()).toEqual([]);
  });

  it('counts the transfers it is tracking', () => {
    workbench.transfersFt.uploadFiles('docs', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
    http.match(uploadUrl('docs'));

    expect(tab('transfers')?.count).toBe(2);
    expect(workbench.bottomPanelFt.transfersEmpty()).toBe(false);
    expect(workbench.bottomPanelFt.transfers()).toBe(workbench.transfersFt.rows());
  });

  it('counts and lists the failed listings as problems', async () => {
    await failListing('secret', 'Outside the root');
    await failListing('', 'Root is unreadable');

    expect(tab('problems')?.count).toBe(2);
    expect(workbench.bottomPanelFt.problems()).toEqual([
      { id: 'secret', path: 'secret', message: 'Outside the root' },
      // The root is reported by the slash a reader can recognise.
      { id: '', path: '/', message: 'Root is unreadable' },
    ]);
  });

  it('select() moves the active tab', () => {
    workbench.bottomPanelFt.select('problems');

    expect(tab('problems')?.active).toBe(true);
    expect(tab('transfers')?.active).toBeUndefined();
    expect(workbench.bottomPanelFt.problemsVisible()).toBe(true);
    expect(workbench.bottomPanelFt.transfersVisible()).toBe(false);
  });

  describe('runAction()', () => {
    it('clear drops the finished transfers only', async () => {
      workbench.transfersFt.uploadFiles('docs', [new File(['a'], 'done.txt'), new File(['b'], 'busy.txt')]);
      const requests = http.match(uploadUrl('docs'));
      requests[0].flush(fsEnvelope(fsDetails('docs/done.txt')));
      await settled();

      workbench.bottomPanelFt.runAction('clear');

      expect(tab('transfers')?.count).toBe(1);
      expect(workbench.bottomPanelFt.transfers().map((row) => row.name)).toEqual(['busy.txt → docs']);
      requests[1].flush(fsEnvelope(fsDetails('docs/busy.txt')));
      await settled();
    });

    it('ignores an action with nothing behind it', () => {
      expect(() => workbench.bottomPanelFt.runAction('close')).not.toThrow();
      expect(workbench.bottomPanelFt.actions.map((action) => action.id)).toEqual(['clear', 'close']);
    });
  });
});
