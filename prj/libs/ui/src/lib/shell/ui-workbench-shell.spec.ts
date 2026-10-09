import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { settled } from '../../testing/settled';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX, UiMemorySettingsStore } from '../settings/ui-settings-store';
import { UiPanelBody } from '../panel-group/ui-panel-body';
import type { UiGroupState, UiTabState } from './ui-editor.model';
import type { UiWorkbenchConfig } from './ui-workbench.config';
import { UiWorkbenchService, provideUiWorkbench } from './ui-workbench.service';
import { UiWorkbenchShell } from './ui-workbench-shell';
import { UiBottomTabTemplate, UiPaneTemplate, UiPanelContentTemplate, UiSubAppTemplate } from './ui-shell-templates';

/** A tab of the toy workbench: a page, by its number. */
interface PageTab extends UiTabState {
  readonly page: number;
}

/**
 * A workbench that is not tr-file (PRD 001, §17.1): two sidebars of panes, one
 * kind of panel content, a bottom panel and a second sub-application — all of
 * it the library's, configured here.
 */
const CONFIG: UiWorkbenchConfig<PageTab, UiGroupState<PageTab>> = {
  title: 'Toy',
  layout: {
    grid: { kind: 'leaf', groupId: 'group-1', size: 1 },
    groups: [{ id: 'group-1', tabs: [{ id: 'tab-1', kind: 'page', label: 'Page 1', page: 1, active: true }] }],
    activeGroupId: 'group-1',
    leftSidebarWidth: 200,
    rightSidebarWidth: 200,
    bottomPanelHeight: 120,
  },
  subApps: [
    { id: 'pages', label: 'Pages', icon: 'file' },
    { id: 'about', label: 'About', icon: 'info' },
  ],
  sidebars: [
    {
      id: 'left',
      label: 'Left',
      side: 'left',
      toggleCommand: 'view.toggleLeft',
      panes: [
        { id: 'one', label: 'One', expanded: true },
        { id: 'two', label: 'Two' },
      ],
    },
    { id: 'right', label: 'Right', side: 'right', toggleCommand: 'view.toggleRight', panes: [{ id: 'three', label: 'Three', expanded: true }] },
  ],
  bottomPanel: { label: 'Panel', tabs: [{ id: 'log', label: 'Log' }], defaultTab: 'log' },
  menus: [{ id: 'view', label: 'View', items: [{ id: 'view.togglePanel', label: 'Toggle Panel' }] }],
  settingsMenu: [],
  editor: {
    contents: [{ type: 'pages', kinds: ['page'], icon: 'file-text' }],
    emptyState: { icon: 'file', title: 'Nothing open' },
    emptyGroup: (id) => ({ id, tabs: [] }),
    readTab: (raw, tab) => (typeof raw['page'] === 'number' ? { ...tab, page: raw['page'] } : null),
  },
  keybindings: [
    { command: 'view.commandPalette', key: 'Ctrl+Shift+P', when: 'window' },
    { command: 'workbench.focusNextPart', key: 'Ctrl+Tab', when: 'window' },
  ],
};

@Component({
  selector: 'ui-test-toy',
  imports: [UiWorkbenchShell, UiPaneTemplate, UiPanelContentTemplate, UiBottomTabTemplate, UiSubAppTemplate, UiPanelBody],
  template: `
    <ui-workbench-shell>
      <ng-template uiPane="one"><button type="button" class="in-one">One's button</button></ng-template>
      <ng-template uiPane="two"><p>Two</p></ng-template>
      <ng-template uiPane="three"><button type="button" class="in-three">Three's button</button></ng-template>
      <ng-template uiPanelContent="pages" let-groupId>
        <div uiPanelBody class="page"><button type="button" class="page-button">{{ pageOf(groupId) }}</button></div>
      </ng-template>
      <ng-template uiBottomTab="log"><p class="log">Logged.</p></ng-template>
      <ng-template uiSubApp="about"><p class="about">About the toy.</p></ng-template>
    </ui-workbench-shell>
  `,
})
class Toy {
  protected readonly workbench = inject(UiWorkbenchService) as UiWorkbenchService<PageTab>;

  protected pageOf(groupId: string): string {
    const groups = this.workbench.editorGroupsFt;
    const group = groups.stateOf(groupId);
    return `Page ${group === undefined ? '' : groups.activeTabOf(group)?.page}`;
  }
}

describe('UiWorkbenchShell', () => {
  let store: UiMemorySettingsStore;
  let fixture: ComponentFixture<Toy>;
  let workbench: UiWorkbenchService<PageTab>;

  const $ = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const $$ = (selector: string): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll(selector));
  const region = (): string | null => document.activeElement?.closest('[data-focus-region]')?.getAttribute('data-focus-region') ?? null;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await settled();
    fixture.detectChanges();
  }

  async function create(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [provideUiWorkbench(CONFIG), { provide: UI_SETTINGS_STORE, useValue: store }, { provide: UI_STORAGE_PREFIX, useValue: 'toy' }],
    });
    fixture = TestBed.createComponent(Toy);
    document.body.appendChild(fixture.nativeElement);
    workbench = TestBed.inject(UiWorkbenchService) as UiWorkbenchService<PageTab>;
    await render();
  }

  beforeEach(() => {
    store = new UiMemorySettingsStore();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('draws the configured workbench with the application\'s templates', async () => {
    await create();

    expect($('ui-title-bar')).not.toBeNull();
    expect($$('ui-activity-bar .activity-btn').map((button) => button.getAttribute('title'))).toEqual(expect.arrayContaining(['Pages', 'About']));
    expect($$('[data-focus-region="left"] ui-pane').length).toBe(2);
    expect($('[data-focus-region="left"] .in-one')).not.toBeNull();
    expect($('[data-focus-region="right"] .in-three')).not.toBeNull();
    // The content of the panel, drawn by the application, inside the group — which its body found by injection.
    expect($('ui-panel-group .page-button')?.textContent).toBe('Page 1');
    expect($('ui-bottom-panel')).not.toBeNull();
    // The keyboard starts in the active panel's content.
    expect(region()).toBe('group:group-1');
  });

  it('splits, closes and maximizes panels', async () => {
    await create();
    workbench.editorGroupsFt.runAction('group-1', 'split-right');
    await render();
    expect($$('ui-panel-group').length).toBe(2);
    expect($$('ui-panel-group .page-button').map((button) => button.textContent)).toEqual(['Page 1', 'Page 1']);
    expect(workbench.activeGroupId()).toBe('group-2');

    workbench.panelLayoutFt.toggleMaximize('group-2');
    await render();
    expect(workbench.panelLayoutFt.isMaximized('group-2')).toBe(true);

    const tab = workbench.editorGroupsFt.stateOf('group-2')?.tabs[0]?.id as string;
    workbench.editorGroupsFt.closeTab('group-2', tab);
    await render();
    expect($$('ui-panel-group').length).toBe(1);
  });

  it('shows another sub-application in the centre, and the panels again', async () => {
    await create();
    workbench.chromeFt.selectActivity('about');
    await render();
    expect($('.about')?.textContent).toBe('About the toy.');
    expect($('.editor-area')?.classList).toContain('is-inactive');

    workbench.chromeFt.selectActivity('pages');
    await render();
    expect($('.editor-area')?.classList).not.toContain('is-inactive');
  });

  it('runs the command palette over the library\'s commands', async () => {
    await create();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await render();
    const rows = $$('ui-quick-input [role="option"]').map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('View: Toggle Panel'))).toBe(true);
    expect(rows.some((row) => row.includes('View: Toggle Left and Right'))).toBe(true);
  });

  it('walks the parts of the window with Ctrl+Tab: the sidebars, then the panel', async () => {
    await create();
    const step = async (): Promise<string | null> => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }));
      await render();
      return region();
    };
    expect([await step(), await step(), await step()]).toEqual(['right', 'left', 'group:group-1']);
  });

  it('remembers the layout and puts it back on the next start', async () => {
    await create();
    workbench.editorGroupsFt.openTab('group-1', { kind: 'page', label: 'Page 2', page: 2 });
    workbench.chromeFt.toggleSidebar('right');
    await render();
    workbench.sessionFt.flush();
    expect(store.get('toy.session.v1:local')).toMatchObject({ version: 1, hiddenSidebars: ['right'] });

    fixture.nativeElement.remove();
    TestBed.resetTestingModule();
    await create();
    expect(workbench.editorGroupsFt.stateOf('group-1')?.tabs.map((tab) => tab.page)).toEqual([1, 2]);
    expect(workbench.chromeFt.isShown('right')).toBe(false);
    expect($('ui-panel-group .page-button')?.textContent).toBe('Page 2');
  });

  /** PRD 001, §9.2.1 — `Ctrl`+`/` puts the activity bar and the bottom panel away with the sidebars, and the session remembers it. */
  it('hides the activity bar and the bottom panel with both sidebars, and keeps them hidden on the next start', async () => {
    await create();
    const activity = (): HTMLElement => $('ui-workbench .activity-slot') as HTMLElement;
    expect(activity().classList).not.toContain('is-hidden');

    const bottom = (): HTMLElement => $('ui-bottom-panel') as HTMLElement;
    workbench.bottomPanelFt.toggleCollapsed();
    workbench.chromeFt.toggleSidebars();
    await render();
    expect(activity().classList).toContain('is-hidden');
    expect(bottom().classList).toContain('is-hidden');
    expect($('ui-sash[label="Resize bottom panel"]')).toBeNull();
    workbench.sessionFt.flush();
    expect(store.get('toy.session.v1:local')).toMatchObject({
      hiddenSidebars: ['left', 'right'],
      activityBarHidden: true,
      bottomPanel: { collapsed: false, hidden: true },
    });

    fixture.nativeElement.remove();
    TestBed.resetTestingModule();
    await create();
    expect(workbench.chromeFt.activityShown()).toBe(false);
    expect(workbench.bottomPanelFt.hidden()).toBe(true);
    expect(activity().classList).toContain('is-hidden');

    // Back as it was: open.
    workbench.chromeFt.toggleSidebars();
    await render();
    expect(activity().classList).not.toContain('is-hidden');
    expect(bottom().classList).not.toContain('is-hidden');
    expect(workbench.bottomPanelFt.collapsed()).toBe(false);
  });

  it('brings the bottom panel back, open, for a tab chosen or its toggle', async () => {
    await create();
    workbench.chromeFt.toggleSidebars();
    expect(workbench.bottomPanelFt.hidden()).toBe(true);
    expect(workbench.focusCycleFt.ring()).not.toContain('bottom');

    workbench.bottomPanelFt.toggleCollapsed();
    expect([workbench.bottomPanelFt.hidden(), workbench.bottomPanelFt.collapsed()]).toEqual([false, false]);

    // The sidebars are still hidden: one Ctrl+/ brings all back, the next puts all away.
    workbench.chromeFt.toggleSidebars();
    workbench.chromeFt.toggleSidebars();
    expect(workbench.bottomPanelFt.hidden()).toBe(true);
    workbench.bottomPanelFt.select(workbench.bottomPanelFt.activeTab());
    expect(workbench.bottomPanelFt.hidden()).toBe(false);
  });
});
