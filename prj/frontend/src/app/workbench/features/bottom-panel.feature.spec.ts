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

  it('opens on Notes, with no counts and an empty list (PRD 001, §12.2)', () => {
    expect(workbench.bottomPanelFt.tabs().map((candidate) => candidate.id)).toEqual([
      'transfers',
      'progress',
      'problems',
      'notes',
    ]);
    expect(tab('notes')).toEqual({ id: 'notes', label: 'Notes', active: true });
    expect(tab('transfers')).toEqual({ id: 'transfers', label: 'Transfers' });
    expect(tab('progress')).toEqual({ id: 'progress', label: 'Progress' });
    expect(tab('problems')).toEqual({ id: 'problems', label: 'Problems' });
    expect(workbench.bottomPanelFt.notesVisible()).toBe(true);
    expect(workbench.bottomPanelFt.transfersVisible()).toBe(false);
    expect(workbench.bottomPanelFt.transfersEmpty()).toBe(true);
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

      workbench.bottomPanelFt.select('transfers');
      workbench.bottomPanelFt.runAction('clear');

      expect(tab('transfers')?.count).toBe(1);
      expect(workbench.bottomPanelFt.transfers().map((row) => row.name)).toEqual(['busy.txt → docs']);
      requests[1].flush(fsEnvelope(fsDetails('docs/busy.txt')));
      await settled();
    });

    it('ignores an action with nothing behind it', () => {
      workbench.bottomPanelFt.select('transfers');
      expect(() => workbench.bottomPanelFt.runAction('close')).not.toThrow();
      expect(workbench.bottomPanelFt.actions().map((action) => action.id)).toEqual([
        'clear',
        'toggle',
      ]);
    });
  });

  describe('collapsing', () => {
    const toggleIcon = (): string | undefined =>
      workbench.bottomPanelFt.actions().find((action) => action.id === 'toggle')?.icon;

    it('starts collapsed, with a double chevron pointing the way back up', () => {
      expect(workbench.bottomPanelFt.collapsed()).toBe(true);
      expect(toggleIcon()).toBe('chevrons-up');
    });

    it('toggles on the action the close button used to be', () => {
      workbench.bottomPanelFt.runAction('toggle');

      expect(workbench.bottomPanelFt.collapsed()).toBe(false);
      expect(toggleIcon()).toBe('chevrons-down');

      workbench.bottomPanelFt.runAction('toggle');

      expect(workbench.bottomPanelFt.collapsed()).toBe(true);
    });

    /** Asking for a tab is asking to see it — the activity bar relies on this. */
    it('opens when a tab is chosen', () => {
      workbench.bottomPanelFt.select('problems');

      expect(workbench.bottomPanelFt.collapsed()).toBe(false);
      expect(workbench.bottomPanelFt.problemsVisible()).toBe(true);
    });
  });

  it('has a Notes tab with nothing to clear (PRD 001, §12.2)', () => {
    const panel = workbench.bottomPanelFt;
    panel.select('transfers');
    panel.select('notes');
    expect(panel.notesVisible()).toBe(true);
    expect(panel.actions().map((action) => action.id)).toEqual(['toggle']);
  });

  it('restores open or collapsed, never the tab', () => {
    const panel = workbench.bottomPanelFt;
    panel.restore(false);
    expect(panel.collapsed()).toBe(false);
    expect(panel.activeTab()).toBe('notes');
  });

  it('opens Notes with the keyboard in it from its command', () => {
    workbench.bottomPanelFt.select('transfers');
    workbench.bottomPanelFt.restore(true);
    const before = workbench.bottomPanelFt.bodyFocus();
    workbench.commandsFt.run('view.notes');
    expect(workbench.bottomPanelFt.collapsed()).toBe(false);
    expect(workbench.bottomPanelFt.notesVisible()).toBe(true);
    expect(workbench.bottomPanelFt.bodyFocus()).toBe(before + 1);
  });

  describe('toggling (PRD 001, §12.3)', () => {
    it('asks for the tab content to take the keyboard as it opens', () => {
      const focusBody = vi.spyOn(workbench.panelFocusFt, 'focusBody');
      workbench.commandsFt.run('view.togglePanel');
      expect(workbench.bottomPanelFt.collapsed()).toBe(false);
      expect(workbench.bottomPanelFt.bodyFocus()).toBe(1);
      expect(focusBody).not.toHaveBeenCalled();
    });

    it('hands the keyboard to the active panel content as it closes', () => {
      workbench.bottomPanelFt.toggleCollapsed();
      const focusBody = vi.spyOn(workbench.panelFocusFt, 'focusBody');
      workbench.commandsFt.run('view.togglePanel');
      expect(workbench.bottomPanelFt.collapsed()).toBe(true);
      expect(focusBody).toHaveBeenCalledWith(workbench.activeGroupId());
      expect(workbench.bottomPanelFt.bodyFocus()).toBe(1);
    });

    it('leaves the keyboard alone when a tab is chosen for the user', () => {
      workbench.bottomPanelFt.select('progress');
      expect(workbench.bottomPanelFt.collapsed()).toBe(false);
      expect(workbench.bottomPanelFt.bodyFocus()).toBe(0);
    });
  });
});
