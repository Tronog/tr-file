import { computed } from '@angular/core';
import type { UiActivityItem, UiIconAction, UiMenuBarItem, UiStatusItem } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The window chrome: title bar, activity bar and status bar.
 *
 * Mostly static configuration, except the status bar's selection summary, which
 * is derived from the active group so the bar always reports what the workbench
 * actually has selected.
 */
export class ChromeFeature {
  readonly menuItems: readonly UiMenuBarItem[];
  readonly commandLabel: string;
  readonly commandKeys: readonly string[];
  readonly titleBarActions: readonly UiIconAction[];
  readonly activityItems: readonly UiActivityItem[];
  readonly activityBottomItems: readonly UiActivityItem[];
  readonly statusLeadingItems: readonly UiStatusItem[];
  readonly sidebarMoreActions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    const mock = parent.mockWorkbench;
    this.menuItems = mock.menuItems;
    this.commandLabel = mock.commandLabel;
    this.commandKeys = mock.commandKeys;
    this.titleBarActions = mock.titleBarActions;
    this.activityItems = mock.activityItems;
    this.activityBottomItems = mock.activityBottomItems;
    this.statusLeadingItems = mock.statusLeadingItems;
    this.sidebarMoreActions = mock.sidebarMoreActions;
  }

  readonly statusTrailingItems = computed<readonly UiStatusItem[]>(() => [
    { id: 'selection', label: this.selectionSummary() },
    ...this.parent.mockWorkbench.statusTrailingItems,
  ]);

  /** e.g. `'2 of 10 selected · 6.4 MB'`. */
  private readonly selectionSummary = computed(() => {
    const group = this.parent.mockWorkbench.layout.groups.find((candidate) => candidate.id === this.parent.activeGroupId());
    if (!group) {
      return 'No selection';
    }
    const entries = this.parent.mockFileSystem.list(group.path);
    const selected = entries.filter((entry) => group.selection.includes(entry.id));
    const bytes = selected.reduce((total, entry) => total + (entry.size ?? 0), 0);
    const size = bytes > 0 ? ` · ${this.parent.fileViewModel.formatBytes(bytes)}` : '';
    return `${selected.length} of ${entries.length} selected${size}`;
  });
}
