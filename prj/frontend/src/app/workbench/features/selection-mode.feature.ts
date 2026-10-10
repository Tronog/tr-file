import { signal } from '@angular/core';
import type { UiSelectionModeId } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** The setting a new panel's selection mode comes from (PRD 004, §2.2). */
export const SELECTION_MODE_PREFERENCE = 'files.selectionMode';

/**
 * Each panel's selection mode (PRD 004, §2.2): `normal` — the selection
 * follows the cursor — or Midnight Commander's `additive` marking, where
 * moving leaves the selection and a click toggles. What each mode makes of a
 * gesture is the library's (`UiNormalSelectionMode`, `UiAdditiveSelectionMode`);
 * which one a panel is in is kept here.
 *
 * A panel starts in the mode *Files: Selection Mode* names, keeps its own
 * through folders and tabs, and the session does not keep it. `Insert` in
 * normal mode switches to additive; `Escape` goes back to normal with nothing
 * selected; the toolbar's button switches either way.
 */
export class SelectionModeFeature {
  /** The mode each panel was switched to; a panel never switched follows the setting. */
  private readonly modes = signal<Readonly<Record<string, UiSelectionModeId>>>({});

  constructor(private readonly parent: WorkbenchService) {}

  /** The mode panel `groupId` is in. */
  modeOf(groupId: string): UiSelectionModeId {
    return this.modes()[groupId] ?? this.defaultMode();
  }

  /** The mode a new panel starts in. */
  defaultMode(): UiSelectionModeId {
    return this.parent.preferencesFt.choice(SELECTION_MODE_PREFERENCE) === 'additive' ? 'additive' : 'normal';
  }

  isAdditive(groupId: string): boolean {
    return this.modeOf(groupId) === 'additive';
  }

  set(groupId: string, mode: UiSelectionModeId): void {
    this.modes.update((all) => ({ ...all, [groupId]: mode }));
  }

  /** The toolbar's button: the other mode, the selection left as it is. */
  toggle(groupId: string): void {
    this.set(groupId, this.isAdditive(groupId) ? 'normal' : 'additive');
  }

  /** `Insert` in normal mode: the entry is already marked by the list, and marking goes on. */
  enterAdditive(groupId: string): void {
    this.set(groupId, 'additive');
  }

  /**
   * `Escape` over a listing: normal mode, nothing selected — the cursor stays,
   * and the details sidebar goes back to describing the folder (PRD 004, §1.3.3).
   */
  reset(groupId: string): void {
    this.set(groupId, 'normal');
    const group = this.parent.editorGroupsFt.stateOf(groupId);
    if (group === undefined) {
      return;
    }
    this.parent.fileBrowserFt.setSelection(groupId, { selected: [], focused: group.focusedEntryId ?? null });
  }

}
