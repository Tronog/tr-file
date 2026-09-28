import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 002, §2.7 — the active panel and the one active before it: a file
 * action's source is the panel the user is in, its destination the one they
 * were in before, however many panels are on screen.
 */
describe('The previous panel', () => {
  let workbench: WorkbenchService;
  let panels: readonly [string, string, string];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    vi.spyOn(workbench.fsDataFt, 'ensureListing').mockImplementation(() => undefined);
    // Three panels side by side, each on a folder of its own: A | B | C.
    const groups = workbench.editorGroupsFt;
    groups.runAction('group-root', 'split-right');
    groups.runAction(workbench.panelLayoutFt.groupIds()[1] as string, 'split-right');
    const ids = workbench.panelLayoutFt.groupIds();
    panels = [ids[0] as string, ids[1] as string, ids[2] as string];
    ['a', 'b', 'c'].forEach((folder, index) => {
      groups.update(panels[index] as string, (group) => ({
        ...group,
        path: folder,
        tabs: group.tabs.map((tab) => ({ ...tab, path: folder, label: folder, kind: 'folder' as const })),
      }));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const focus = (id: string) => workbench.editorGroupsFt.focus(id);

  /** Where *Copy To…* offers to copy the active panel's selection. */
  const offered = async (): Promise<string> => {
    const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValue(null);
    await workbench.operationsFt.transferPaths('copy', ['x.txt'], workbench.activeGroupId());
    return prompt.mock.calls.at(-1)?.[0].value ?? '';
  };

  it('remembers the panel active before this one — one level deep', () => {
    const [a, b, c] = panels;
    focus(a);
    focus(c);
    expect(workbench.activeGroupId()).toBe(c);
    expect(workbench.previousGroupId()).toBe(a);

    focus(b);
    expect(workbench.previousGroupId()).toBe(c);

    // Choosing the active panel again changes nothing.
    focus(b);
    expect(workbench.previousGroupId()).toBe(c);
  });

  it('offers the previous panel’s folder as the destination, not the next one in the layout', async () => {
    const [a, b, c] = panels;
    // From C into A: A's neighbour in the layout is B, but the user came from C.
    focus(c);
    focus(a);
    expect(await offered()).toBe('/c');

    // From A into C: C's neighbour, round the layout, is A anyway — so from B into C instead.
    focus(b);
    focus(c);
    expect(await offered()).toBe('/b');
  });

  it('goes back and forth between two panels, each the other’s destination', async () => {
    const [a, b] = panels;
    focus(a);
    focus(b);
    expect(await offered()).toBe('/a');
    focus(a);
    expect(await offered()).toBe('/b');
  });

  it('falls back to the next folder panel when the previous one shows no folder', async () => {
    const [, b, c] = panels;
    focus(c);
    focus(b);
    workbench.editorGroupsFt.update(c, (group) => ({ ...group, tabs: group.tabs.map((tab) => ({ ...tab, kind: 'file' as const })) }));

    // C shows a file: after B in the layout, C is passed over for A.
    expect(await offered()).toBe('/a');
  });

  it('forgets a previous panel that has been closed, and falls back to the next one', async () => {
    const [a, , c] = panels;
    focus(a);
    focus(c);
    const only = workbench.editorGroupsFt.stateOf(a)?.tabs[0]?.id as string;

    workbench.editorGroupsFt.closeTab(a, only);

    expect(workbench.previousGroupId()).toBeNull();
    focus(c);
    // After C, round the layout: B.
    expect(await offered()).toBe('/b');
  });

  /** §2.7.1 — the details sidebar shows the two, under its actions. */
  const shown = (): Record<string, string> =>
    Object.fromEntries(workbench.detailsFt.transferPaths().map((property) => [property.label, property.value]));

  it('shows the source and destination in the details sidebar, as the prompt offers them', async () => {
    const [a, b, c] = panels;
    focus(c);
    focus(a);
    expect(shown()).toEqual({ Source: '/a', Destination: '/c' });

    focus(b);
    expect(shown()).toEqual({ Source: '/b', Destination: '/a' });
    expect(await offered()).toBe(shown()['Destination']);
  });

  it('shows no source while the active panel shows no folder', () => {
    const [a, b] = panels;
    focus(a);
    focus(b);
    workbench.editorGroupsFt.update(b, (group) => ({ ...group, tabs: group.tabs.map((tab) => ({ ...tab, kind: 'file' as const })) }));

    expect(shown()).toEqual({ Source: '—', Destination: '/a' });
  });
});
