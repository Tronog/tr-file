import { UiEditorGroupsFeature, type UiIconName, type UiIconTint, type UiNewTab } from '@tr-file/ui';
import type { PanelGroupState, PanelTabMemory, PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

/**
 * The panels' groups and their tabs — the library's `UiEditorGroupsFeature`
 * — as the file manager has them: a group lists the folder of its active
 * tab, with a view, a sort and a selection of its own.
 *
 * What a tab shows is drawn by the content its kind maps to
 * (`trFileWorkbenchConfig`'s `editor.contents`), each with its feature —
 * `FileBrowserFeature` for folders and files — registered as its driver by
 * `WorkbenchService`.
 */
export class EditorGroupsFeature extends UiEditorGroupsFeature<PanelTabState, PanelGroupState> {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /** Path of a group's active tab — the directory its uploads land in. */
  pathOf(id: string): string | undefined {
    return this.stateOf(id)?.path;
  }

  /**
   * `Ctrl`+`T` (PRD 002, §2.2): as a file manager's new tab opens on the
   * folder you are in. A folder, a zip or the trash is opened again; from a
   * file or a diff, the folder it is in.
   */
  protected override newTabFrom(group: PanelGroupState, active: PanelTabState | undefined): UiNewTab<PanelTabState> {
    if (active !== undefined && active.kind !== 'file' && active.kind !== 'diff') {
      const { id: _id, active: _active, remembered: _remembered, openedFrom: _openedFrom, ...rest } = active;
      return rest;
    }
    const path = active === undefined ? group.path : active.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/')) : '';
    return { label: path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path), path, kind: 'folder' };
  }

  /**
   * Choosing another tab is not leaving for good (PRD 001, Fix 4): the tab
   * being left keeps what was selected in it and where the cursor was…
   */
  protected override remember(group: PanelGroupState): PanelTabMemory {
    return {
      path: group.path,
      selection: group.selection,
      ...(group.focusedEntryId === undefined ? {} : { focusedEntryId: group.focusedEntryId }),
    };
  }

  /** … and the tab being chosen gets back what it had — as long as it still shows the folder it had it in. */
  protected override recall(group: PanelGroupState, tabs: readonly PanelTabState[], active: PanelTabState, memory: unknown): PanelGroupState | null {
    const restored = memory as PanelTabMemory;
    if (restored.path !== active.path) {
      return null;
    }
    const { focusedEntryId: _focused, ...rest } = group;
    return {
      ...rest,
      tabs,
      path: active.path,
      selection: restored.selection,
      ...(restored.focusedEntryId === undefined ? {} : { focusedEntryId: restored.focusedEntryId }),
    };
  }

  /**
   * The group follows its active tab to its folder. A group that changed
   * folder — or tab — drops its selection, because those paths belong to the
   * listing it showed.
   */
  protected override follow(group: PanelGroupState, tabs: readonly PanelTabState[], active: PanelTabState | undefined, switching: boolean): PanelGroupState {
    const path = active?.path ?? group.path;
    const keep = path === group.path && !switching;
    const { focusedEntryId, ...rest } = group;
    return {
      ...rest,
      tabs,
      path,
      selection: keep ? group.selection : [],
      ...(keep && focusedEntryId !== undefined ? { focusedEntryId } : {}),
    };
  }

  /** A new group inherits its neighbour's view, but not its selection. */
  protected override blankGroup(source: PanelGroupState, id: string): PanelGroupState {
    return { ...source, id, selection: [], tabs: [] };
  }

  /**
   * The folder a panel opens on is the first stop on its trail (§6.2.1), or
   * its very first Back would have nowhere to return to. A panel born from a
   * split starts its own trail where it was born, not with its neighbour's —
   * they are two places to work from now on; only a *folder* is a stop on that
   * trail, as Back into a file would ask the panel to list one.
   */
  protected override groupAdded(group: PanelGroupState, reason: 'start' | 'split' | 'empty'): void {
    if (reason === 'split' && (group.tabs.find((tab) => tab.active) ?? group.tabs[0])?.kind === 'file') {
      return;
    }
    this.parent.panelHistoryFt.record(group.id, group.path);
  }

  protected override groupRemoved(groupId: string): void {
    this.parent.panelHistoryFt.forget(groupId);
  }

  /** A tab given back its cursor (PRD 001, Fix 4): the details sidebar follows it, as it would a click. */
  protected override tabChosen(group: PanelGroupState): void {
    if (group.focusedEntryId !== undefined) {
      this.parent.select(group.focusedEntryId);
    }
  }

  /**
   * The keyboard walked into a panel — `Tab` / `Ctrl`+`Tab` (PRD 002, §2.6):
   * the details sidebar describes what its cursor is on — else the first
   * entry selected there, else the folder (or the file) it shows — as
   * choosing in it would. A trash, a zip, a diff describe themselves.
   */
  protected override groupEntered(group: PanelGroupState): void {
    const tab = this.activeTabOf(group);
    if (tab === undefined || (tab.kind !== 'folder' && tab.kind !== 'file')) {
      return;
    }
    const described = group.selection.length === 0 ? group.path : (group.focusedEntryId ?? group.selection[0] ?? group.path);
    if (described !== this.parent.selectedEntryId()) {
      this.parent.select(described);
    }
  }

  protected override tabIcon(tab: PanelTabState): { readonly icon: UiIconName; readonly tint?: UiIconTint } {
    if (tab.kind === 'trash') {
      // The trash is not a folder of the root (PRD 001, §14.1): its own icon, untinted.
      return { icon: 'trash' };
    }
    const isFile = tab.kind === 'file' || tab.kind === 'diff';
    return isFile ? { icon: 'file', tint: this.parent.fileViewModel.tint({ type: 'file', name: tab.label }) } : { icon: 'folder', tint: 'folder' };
  }
}
