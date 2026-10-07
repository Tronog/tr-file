import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, contentChildren, inject, input, output } from '@angular/core';
import { UiActivityBar } from '../activity-bar/ui-activity-bar';
import { UiBottomPanel } from '../bottom-panel/ui-bottom-panel';
import { UiContextMenu } from '../context-menu/ui-context-menu';
import type { UiFunctionKey, UiTitleBarUpgrade, UiTitleBarZoom, UiWindowControl, UiZoomRequest } from '../models/chrome.model';
import type { UiFilesDrop } from '../models/interaction.model';
import { UiPane } from '../pane/ui-pane';
import { UiPanelGrid } from '../panel-grid/ui-panel-grid';
import { UiPanelGroup } from '../panel-group/ui-panel-group';
import { UiQuickInput } from '../quick-input/ui-quick-input';
import { UiSash } from '../sash/ui-sash';
import { UiSidebar } from '../sidebar/ui-sidebar';
import { UiStatusBar } from '../status-bar/ui-status-bar';
import { UiTitleBar } from '../title-bar/ui-title-bar';
import { UiWorkbench } from '../workbench/ui-workbench';
import type { UiFocusRegionId } from './features/ui-focus-cycle.feature';
import {
  UiBottomTabTemplate,
  UiNodeInjector,
  UiPaneTemplate,
  UiPanelContentTemplate,
  UiSidebarTemplate,
  UiSubAppTemplate,
} from './ui-shell-templates';
import { UiWorkbenchService } from './ui-workbench.service';

/** What `Ctrl`+`Tab` can land on inside a sidebar or the bottom panel. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Files dropped from the system on a panel group: which, and what. */
export interface UiPanelFilesDrop {
  readonly groupId: string;
  readonly drop: UiFilesDrop;
}

/**
 * The window (PRD 001, §17.1): the VS Code style workbench of
 * `UiWorkbenchService` — the title bar with its menus and buttons, the
 * activity bar, the two sidebars, the panels above the bottom panel, the
 * status bar, and over them the context menus, the Settings gear's menu and
 * the command palette. The sub-application shown fills the centre (PRD 001,
 * §1.1); the main one is the panels.
 *
 * What is the application's is its own templates, given as content:
 *
 * - `<ng-template uiPanelContent="…" let-groupId>` — a kind of panel content;
 * - `<ng-template uiBottomTab="…">` — a tab of the bottom panel;
 * - `<ng-template uiPane="…">` — a sidebar pane's content, or
 *   `<ng-template uiSidebar="…">` — a whole sidebar of its own;
 * - `<ng-template uiSubApp="…">` — another sub-application's centre.
 *
 * It also answers the window's keys (PRD 010, §2): the key table's window
 * bindings, `Ctrl`+`Tab` between the parts of the window and `Tab` between
 * panels (PRD 002, §2.6) — the DOM half of `UiFocusCycleFeature`: which part
 * focus is in, and what to focus in the next one. Before the window goes, the
 * session is written (PRD 003, §6).
 *
 * The workbench starts — `UiWorkbenchService.start`: its panels load, the
 * keyboard goes into the active one — when the shell is made.
 */
@Component({
  selector: 'ui-workbench-shell',
  imports: [
    NgTemplateOutlet,
    UiActivityBar,
    UiBottomPanel,
    UiContextMenu,
    UiNodeInjector,
    UiPane,
    UiPanelGrid,
    UiPanelGroup,
    UiQuickInput,
    UiSash,
    UiSidebar,
    UiStatusBar,
    UiTitleBar,
    UiWorkbench,
  ],
  templateUrl: './ui-workbench-shell.html',
  styleUrl: './ui-workbench-shell.scss',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
    '(focusin)': 'onFocusIn($event)',
    '(window:pagehide)': 'workbench.sessionFt.flush()',
  },
})
export class UiWorkbenchShell {
  protected readonly workbench = inject(UiWorkbenchService);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /* -- what a desktop window adds to the bars (PRD 001, §8.2) --------------- */

  readonly zoom = input<UiTitleBarZoom | null>(null);
  readonly upgrade = input<UiTitleBarUpgrade | null>(null);
  readonly windowControls = input<readonly UiWindowControl[]>([]);
  readonly draggable = input(false);
  readonly leadingInset = input(0);
  /** A strip of function keys in the middle of the status bar (PRD 004, §2). */
  readonly functionKeys = input<readonly UiFunctionKey[]>([]);

  readonly zoomRequest = output<UiZoomRequest>();
  readonly upgradeSelect = output<void>();
  readonly windowControlSelect = output<string>();
  readonly dragAreaDoubleClick = output<void>();
  readonly functionKeySelect = output<string>();
  /** Files dropped from the system on a panel group whose active tab takes them. */
  readonly panelFilesDrop = output<UiPanelFilesDrop>();

  /* -- the application's templates ------------------------------------------ */

  private readonly contents = contentChildren(UiPanelContentTemplate);
  private readonly bottomTabs = contentChildren(UiBottomTabTemplate);
  private readonly subApps = contentChildren(UiSubAppTemplate);
  private readonly sidebars = contentChildren(UiSidebarTemplate);
  private readonly panes = contentChildren(UiPaneTemplate);

  protected readonly contentTemplates = computed(() => new Map(this.contents().map((content) => [content.type(), content.template])));
  protected readonly bottomTemplates = computed(() => new Map(this.bottomTabs().map((tab) => [tab.id(), tab.template])));
  protected readonly subAppTemplates = computed(() => new Map(this.subApps().map((app) => [app.id(), app.template])));
  protected readonly sidebarTemplates = computed(() => new Map(this.sidebars().map((sidebar) => [sidebar.id(), sidebar.template])));
  protected readonly paneTemplates = computed(() => new Map(this.panes().map((pane) => [pane.id(), pane])));

  /** The element that last had focus in each region, to return to it. */
  private readonly lastFocused = new Map<UiFocusRegionId, HTMLElement>();

  constructor() {
    // Rather than in the service, so that making the service in a test fetches nothing.
    this.workbench.start();
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    // The window's keys (PRD 010, §2).
    this.workbench.keybindingsFt.handleShortcut(event);
    if (this.onPanelTab(event)) {
      return;
    }
    const cycle = this.workbench.focusCycleFt;
    const direction = cycle.directionOf(event);
    if (direction === 0 || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    const current = this.regionOf(document.activeElement);
    for (const region of cycle.sequence(current, direction)) {
      if (cycle.enter(region) || this.focusRegion(region)) {
        return;
      }
    }
  }

  /**
   * `Tab` / `Shift`+`Tab` from a panel's body to the next or previous panel
   * (PRD 002, §2.6), entered as choosing its tab enters it. `true` when it was that.
   */
  private onPanelTab(event: KeyboardEvent): boolean {
    const focused = document.activeElement;
    const region = this.regionOf(focused);
    const inBody =
      region?.startsWith('group:') === true &&
      focused instanceof HTMLElement &&
      focused.closest('[data-panel-body]') !== null &&
      !focused.matches('input, textarea, select, [contenteditable="true"]');
    const cycle = this.workbench.focusCycleFt;
    const direction = event.defaultPrevented ? 0 : cycle.panelDirectionOf(event, inBody);
    const next = direction === 0 ? null : cycle.nextPanel((region as string).slice('group:'.length), direction);
    if (next === null) {
      return false;
    }
    event.preventDefault();
    cycle.enter(`group:${next}`);
    return true;
  }

  protected onFocusIn(event: FocusEvent): void {
    const region = this.regionOf(event.target);
    if (region !== null && event.target instanceof HTMLElement) {
      this.lastFocused.set(region, event.target);
    }
  }

  /**
   * Focuses a sidebar or the bottom panel: where focus last was in it, else
   * its first tab stop that takes focus — a roving `tabindex="0"` first, so a
   * tree is entered on its current row; one that is not shown (a collapsed
   * pane's sash) is passed over. `false` when it has nothing to focus, so the
   * next region is tried.
   */
  private focusRegion(region: UiFocusRegionId): boolean {
    const element = this.host.querySelector<HTMLElement>(`[data-focus-region="${region}"]`);
    if (element === null) {
      return false;
    }
    const remembered = this.lastFocused.get(region);
    const candidates = [
      ...(remembered?.isConnected && element.contains(remembered) && remembered.matches(FOCUSABLE) ? [remembered] : []),
      ...element.querySelectorAll<HTMLElement>('[tabindex="0"]'),
      ...element.querySelectorAll<HTMLElement>(FOCUSABLE),
    ];
    for (const candidate of candidates) {
      candidate.focus();
      if (document.activeElement === candidate) {
        return true;
      }
    }
    return false;
  }

  private regionOf(target: EventTarget | null): UiFocusRegionId | null {
    const element = target instanceof Element ? target.closest('[data-focus-region]') : null;
    return element?.getAttribute('data-focus-region') ?? null;
  }
}
