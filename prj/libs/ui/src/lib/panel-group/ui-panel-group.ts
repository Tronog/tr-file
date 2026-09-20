import { Component, computed, input, output, signal } from '@angular/core';
import { UiBreadcrumbs } from '../breadcrumbs/ui-breadcrumbs';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import { UiSegmented, type UiSegmentedOption } from '../controls/ui-segmented';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UiTabBar } from '../tabs/ui-tab-bar';
import { UI_TAB_MIME } from '../models';
import type {
  UiDropZone,
  UiPanelGroupModel,
  UiPanelView,
  UiTabDragData,
  UiTabDrop,
  UiTabMove,
  UiTabReorder,
} from '../models';

/**
 * Reads a tab drag payload off a `DataTransfer`, tolerating anything that is
 * not one: a foreign drag, an empty payload or malformed JSON all yield `null`
 * so the caller can ignore the drop.
 */
function readTabDragData(transfer: DataTransfer | null): UiTabDragData | null {
  if (!transfer) {
    return null;
  }

  const raw = transfer.getData(UI_TAB_MIME) || transfer.getData('text/plain');
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const { tabId, groupId } = parsed as Partial<UiTabDragData>;
    return typeof tabId === 'string' && typeof groupId === 'string' ? { tabId, groupId } : null;
  } catch {
    return null;
  }
}

/**
 * One editor group: tab bar, optional breadcrumbs, optional toolbar and a body.
 *
 * Every chrome row is conditional on the data — breadcrumbs appear only when
 * the group has any, the toolbar only when it has something to show — and a
 * group carrying an `empty` state renders that instead of a body, which is how
 * "no folder opened" is expressed. The view switch is stateless: it renders
 * `group().view` and re-emits changes through `viewChange`.
 *
 * The body is a drop target for tabs: the pointer's position inside it picks a
 * `UiDropZone` — the outer quarter on a side splits, the middle joins — which
 * is painted as an overlay while the drag lasts and reported as a `UiTabDrop`
 * when it ends. Which zone is lit is transient presentation state; the layout
 * itself is the application's business.
 */
@Component({
  selector: 'ui-panel-group',
  imports: [
    UiTabBar,
    UiBreadcrumbs,
    UiIconButton,
    UiSegmented,
    UiSearchField,
    UiFileList,
    UiIconView,
    UiEmptyState,
  ],
  templateUrl: './ui-panel-group.html',
  styleUrl: './ui-panel-group.scss',
  host: {
    '[class.is-active]': 'active()',
    '(pointerdown)': 'focusRequest.emit()',
  },
})
export class UiPanelGroup {
  readonly group = input.required<UiPanelGroupModel>();

  /** Whether this group owns the workbench focus. */
  readonly active = input<boolean>(false);

  readonly tabSelect = output<string>();
  readonly tabClose = output<string>();
  readonly actionSelect = output<string>();
  readonly breadcrumbSelect = output<string>();
  readonly toolbarAction = output<string>();
  readonly viewChange = output<UiPanelView>();
  readonly rowSelect = output<string>();
  readonly rowActivate = output<string>();
  readonly itemSelect = output<string>();
  readonly itemActivate = output<string>();

  /** A tab was dropped on this group's tab bar. */
  readonly tabDrop = output<UiTabReorder>();

  /** A keyboard reorder of the focused tab. */
  readonly tabMove = output<UiTabMove>();

  /** A tab was dropped over the group's body, in one of its five zones. */
  readonly zoneDrop = output<UiTabDrop>();

  /** Any pointer press inside the group asks the application to focus it. */
  readonly focusRequest = output<void>();

  /** The zone lit while a tab drag hovers the body, or `null`. */
  protected readonly dropZone = signal<UiDropZone | null>(null);

  protected readonly viewOptions: readonly UiSegmentedOption[] = [
    { id: 'list', label: 'List view', icon: 'list' },
    { id: 'grid', label: 'Grid view', icon: 'layout-grid' },
  ];

  /**
   * Each group's path bar is its own landmark, so they need distinct names —
   * duplicated landmark labels are indistinguishable to a screen reader.
   */
  protected readonly breadcrumbLabel = computed(() => {
    const group = this.group();
    const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    return active ? `Path of ${active.label}` : 'Path';
  });

  protected readonly showToolbar = computed(() => {
    const group = this.group();
    return group.toolbarActions.length > 0 || !!group.showViewSwitch || !!group.searchPlaceholder;
  });

  protected onViewChange(value: string): void {
    this.viewChange.emit(value === 'grid' ? 'grid' : 'list');
  }

  protected onBodyDragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types).includes(UI_TAB_MIME)) {
      return;
    }

    event.preventDefault();
    transfer.dropEffect = 'move';
    this.dropZone.set(this.zoneAt(event));
  }

  protected onBodyDragLeave(event: DragEvent): void {
    const related = event.relatedTarget;
    const body = event.currentTarget;
    if (body instanceof Node && related instanceof Node && body.contains(related)) {
      return;
    }

    this.dropZone.set(null);
  }

  protected onBodyDrop(event: DragEvent): void {
    event.preventDefault();

    const zone = this.zoneAt(event);
    this.dropZone.set(null);

    const data = readTabDragData(event.dataTransfer);
    if (!data) {
      return;
    }

    this.zoneDrop.emit({
      tabId: data.tabId,
      groupId: data.groupId,
      targetGroupId: this.group().id,
      zone,
    });
  }

  /**
   * The zone under the pointer: whichever edge it is within the outer quarter
   * of — the nearest one, so corners stay predictable — else `center`.
   */
  private zoneAt(event: DragEvent): UiDropZone {
    const body = event.currentTarget;
    if (!(body instanceof HTMLElement)) {
      return 'center';
    }

    const rect = body.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return 'center';
    }

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const edges: readonly (readonly [UiDropZone, number])[] = [
      ['left', x],
      ['right', 1 - x],
      ['top', y],
      ['bottom', 1 - y],
    ];

    let nearest: readonly [UiDropZone, number] = edges[0];
    for (const edge of edges) {
      if (edge[1] < nearest[1]) {
        nearest = edge;
      }
    }

    return nearest[1] < 0.25 ? nearest[0] : 'center';
  }
}
