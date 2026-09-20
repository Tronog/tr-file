import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiPanelGroup, UiTabBar } from '@tr-file/ui';
import type { UiFileRow, UiPanelGroupModel, UiTab } from '@tr-file/ui';

/**
 * PRD 001, Section 6.3 — choosing a tab puts the keyboard in that tab's
 * content, once the content is there to be put in.
 */

const TABS: readonly UiTab[] = [
  { id: 'tab-prj', label: 'prj', icon: 'folder', tint: 'folder', active: true },
  { id: 'tab-docs', label: 'docs', icon: 'folder', tint: 'folder' },
];

const ROWS: readonly UiFileRow[] = [
  { id: 'a.ts', name: 'a.ts', icon: 'file', cells: {} },
  { id: 'b.md', name: 'b.md', icon: 'file', cells: {}, selected: true, focused: true },
];

const GROUP: UiPanelGroupModel = {
  id: 'group-root',
  tabs: TABS,
  actions: [],
  breadcrumbs: [],
  view: 'list',
  toolbarActions: [],
  columns: [{ key: 'name', label: 'Name' }],
  rows: ROWS,
  items: [],
};

describe('UiTabBar activation', () => {
  let fixture: ComponentFixture<UiTabBar>;
  let selected: string[];
  let activated: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTabBar] }).compileComponents();
    fixture = TestBed.createComponent(UiTabBar);
    fixture.componentRef.setInput('tabs', TABS);
    fixture.componentRef.setInput('groupId', 'group-root');
    fixture.detectChanges();

    selected = [];
    activated = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));
  });

  const tabs = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.tab-main'));

  it('reports a click as both a selection and a choice', () => {
    tabs()[1].click();

    expect(selected).toEqual(['tab-docs']);
    expect(activated).toEqual(['tab-docs']);
  });

  /**
   * The difference that matters: if roving also counted as choosing, focus
   * would leave the bar on the first arrow and the next tab would be
   * unreachable.
   */
  it('reports roving with the arrows as a selection only', () => {
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    expect(selected).toEqual(['tab-docs']);
    expect(activated).toEqual([]);
    expect(document.activeElement).toBe(tabs()[1]);
  });
});

describe('UiPanelGroup body focus', () => {
  let fixture: ComponentFixture<UiPanelGroup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiPanelGroup] }).compileComponents();
    fixture = TestBed.createComponent(UiPanelGroup);
    fixture.componentRef.setInput('group', GROUP);
    // Attached to the document, or nothing in it can hold focus.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const focusedRow = (): HTMLElement =>
    fixture.nativeElement.querySelector('tbody tr[tabindex="0"]');

  /** Bumps the token the way `PanelFocusFeature` does, then lets it render. */
  const ask = (token: number): void => {
    fixture.componentRef.setInput('focusBody', token);
    fixture.detectChanges();
  };

  it('leaves focus alone until it is asked', () => {
    expect(document.activeElement).not.toBe(focusedRow());
  });

  it('puts focus on the body tab stop when the token changes', () => {
    ask(1);

    expect(document.activeElement).toBe(focusedRow());
  });

  it('answers a second ask for the same group', () => {
    ask(1);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).not.toBe(focusedRow());

    ask(2);

    expect(document.activeElement).toBe(focusedRow());
  });

  it('focuses the document when the body is a file preview', () => {
    fixture.componentRef.setInput('group', {
      ...GROUP,
      rows: [],
      document: { path: 'docs/README.md', kind: 'text', text: 'hello' },
    } satisfies UiPanelGroupModel);
    ask(1);

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('article.doc'));
  });

  /**
   * A tab clicked before its folder has arrived still gets focus — the request
   * survives a render with nothing in the body, as long as it is still loading.
   */
  it('waits for a loading body and focuses it once the rows arrive', () => {
    fixture.componentRef.setInput('group', { ...GROUP, rows: [], loading: true });
    ask(1);
    expect(focusedRow()).toBeNull();

    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();

    expect(document.activeElement).toBe(focusedRow());
  });

  /**
   * But a request that found a settled body with nothing to focus is spent: it
   * must not come back and steal focus from wherever the user has gone since.
   */
  it('gives up on a settled body that offers nothing to focus', () => {
    fixture.componentRef.setInput('group', { ...GROUP, rows: [] });
    ask(1);

    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();

    expect(document.activeElement).not.toBe(focusedRow());
  });
});
