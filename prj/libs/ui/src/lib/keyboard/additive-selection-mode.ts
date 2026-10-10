import type { UiSelectMode } from './list-selection';
import { UiSelectionModeFeature, type UiSelectionKeys } from './selection-mode';

/**
 * Additive selection (PRD 004, §2.2), Midnight Commander's marking: moving the
 * cursor never changes what is selected, a click flips one entry in or out,
 * and `Shift` adds a range to what is selected rather than replacing it.
 * Nothing but `Escape` (back to normal) clears the selection.
 */
export class UiAdditiveSelectionMode extends UiSelectionModeFeature {
  readonly id = 'additive';
  readonly keepsLone = false;
  readonly blankPressClears = false;

  click(keys: UiSelectionKeys): UiSelectMode {
    return keys.shiftKey ? 'range-add' : 'toggle';
  }

  move(keys: UiSelectionKeys): UiSelectMode {
    return keys.shiftKey ? 'range-add' : 'focus';
  }

  find(): UiSelectMode {
    return 'focus';
  }
}
