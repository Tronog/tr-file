import { Component, computed, input, output } from '@angular/core';
import { UiBreadcrumbs } from '../breadcrumbs/ui-breadcrumbs';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import { UiSegmented, type UiSegmentedOption } from '../controls/ui-segmented';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UiTabBar } from '../tabs/ui-tab-bar';
import type { UiPanelGroupModel, UiPanelView } from '../models';

/**
 * One editor group: tab bar, optional breadcrumbs, optional toolbar and a body.
 *
 * Every chrome row is conditional on the data — breadcrumbs appear only when
 * the group has any, the toolbar only when it has something to show — and a
 * group carrying an `empty` state renders that instead of a body, which is how
 * "no folder opened" is expressed. The view switch is stateless: it renders
 * `group().view` and re-emits changes through `viewChange`.
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
    return (
      group.toolbarActions.length > 0 || !!group.showViewSwitch || !!group.searchPlaceholder
    );
  });

  protected onViewChange(value: string): void {
    this.viewChange.emit(value === 'grid' ? 'grid' : 'list');
  }
}
