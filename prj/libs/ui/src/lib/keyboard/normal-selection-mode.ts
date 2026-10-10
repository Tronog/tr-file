import { clickMode, moveMode, type UiSelectMode } from './list-selection';
import { UiSelectionModeFeature, type UiSelectionKeys } from './selection-mode';

/**
 * Normal selection (PRD 004, §2.2), every file manager's: the selection
 * follows the cursor, a plain click picks one entry, `Ctrl` toggles and
 * `Shift` makes a range (PRD 004, §1.2).
 */
export class UiNormalSelectionMode extends UiSelectionModeFeature {
  readonly id = 'normal';
  readonly keepsLone = true;
  readonly blankPressClears = true;

  click(keys: UiSelectionKeys): UiSelectMode {
    return clickMode(keys);
  }

  move(keys: UiSelectionKeys): UiSelectMode {
    return moveMode(keys);
  }

  find(): UiSelectMode {
    return 'replace';
  }
}
