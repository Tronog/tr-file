import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { SELECTION_MODE_PREFERENCE } from './selection-mode.feature';

const ROOT_ENTRIES = [fsDirectory('docs'), fsEntry('README.md', { size: 3482 }), fsEntry('main.ts', { size: 612 })];

/** PRD 004, §2.2: normal and additive selection, per panel. */
describe('SelectionModeFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The details a selection asks for are not what these specs are about.
    http.match(() => true);
    http.verify();
  });

  const start = async (): Promise<void> => {
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    await settled();
  };

  const modeButton = () => workbench.fileBrowserFt.browser('group-root')?.toolbarActions.find((action) => action.id === 'selection-mode');

  it('starts every panel in normal mode, and hands the mode to the listing', async () => {
    await start();

    expect(workbench.selectionModeFt.modeOf('group-root')).toBe('normal');
    expect(workbench.fileBrowserFt.browser('group-root')?.selectionMode).toBe('normal');
    expect(modeButton()?.active).toBeUndefined();
  });

  it('starts a panel in the mode the setting names', () => {
    workbench.preferencesFt.choose(SELECTION_MODE_PREFERENCE, 'additive');

    expect(workbench.selectionModeFt.modeOf('group-any')).toBe('additive');
    workbench.preferencesFt.choose(SELECTION_MODE_PREFERENCE, 'normal');
  });

  it('Insert switches only its own panel to additive, and the toolbar button shows it', async () => {
    await start();
    workbench.panelKeyboardFt.run('group-root', { command: 'additive-selection', entryId: 'docs' });

    expect(workbench.selectionModeFt.modeOf('group-root')).toBe('additive');
    expect(workbench.selectionModeFt.modeOf('group-other')).toBe('normal');
    expect(workbench.fileBrowserFt.browser('group-root')?.selectionMode).toBe('additive');
    expect(modeButton()?.active).toBe(true);
  });

  it('the toolbar button switches either way and leaves the selection', async () => {
    await start();
    workbench.fileBrowserFt.setSelection('group-root', { selected: ['docs', 'main.ts'], focused: 'main.ts' });
    workbench.fileBrowserFt.runToolbarAction('group-root', 'selection-mode');
    expect(workbench.selectionModeFt.isAdditive('group-root')).toBe(true);
    workbench.fileBrowserFt.runToolbarAction('group-root', 'selection-mode');

    expect(workbench.selectionModeFt.isAdditive('group-root')).toBe(false);
    expect(workbench.editorGroupsFt.stateOf('group-root')?.selection).toEqual(['docs', 'main.ts']);
  });

  it('Escape goes back to normal with nothing selected, the cursor kept and the folder described', async () => {
    await start();
    workbench.selectionModeFt.enterAdditive('group-root');
    workbench.fileBrowserFt.setSelection('group-root', { selected: ['docs', 'main.ts'], focused: 'main.ts' });
    workbench.panelKeyboardFt.run('group-root', { command: 'normal-selection', entryId: 'main.ts' });

    const group = workbench.editorGroupsFt.stateOf('group-root');
    expect(workbench.selectionModeFt.modeOf('group-root')).toBe('normal');
    expect(group?.selection).toEqual([]);
    expect(group?.focusedEntryId).toBe('main.ts');
    expect(workbench.selectedEntryId()).toBe('');
  });

  it('keeps the mode when the panel goes to another folder', async () => {
    await start();
    workbench.selectionModeFt.enterAdditive('group-root');
    workbench.fileBrowserFt.navigateTo('group-root', 'docs', 'docs');

    expect(workbench.selectionModeFt.isAdditive('group-root')).toBe(true);
  });
});
