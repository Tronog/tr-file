import { UiAdditiveSelectionMode } from './additive-selection-mode';
import { UiNormalSelectionMode } from './normal-selection-mode';
import type { UiSelectionModeFeature, UiSelectionModeId } from './selection-mode';

const MODES: Readonly<Record<UiSelectionModeId, UiSelectionModeFeature>> = {
  normal: new UiNormalSelectionMode(),
  additive: new UiAdditiveSelectionMode(),
};

/** The selection mode by its id (PRD 004, §2.2); the modes hold no state, so one of each serves every listing. */
export function uiSelectionMode(id: UiSelectionModeId): UiSelectionModeFeature {
  return MODES[id];
}
