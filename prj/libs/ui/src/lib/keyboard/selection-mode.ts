import type { UiSelectMode } from './list-selection';

/**
 * How a listing selects (PRD 004, §2.2): `normal` — the selection follows the
 * cursor, a plain click picks one entry — or `additive` — Midnight Commander's
 * marking, where moving never changes what is selected and a click flips one
 * entry in or out. `Insert` switches a panel to additive, `Escape` back.
 */
export type UiSelectionModeId = 'normal' | 'additive';

/** The modifier keys a gesture was made with. */
export interface UiSelectionKeys {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * One selection mode: what each gesture of `UiFileList` and `UiIconView`
 * means to the selection. The views ask the mode in force rather than
 * deciding themselves; `UiListSelection` carries the gesture out.
 */
export abstract class UiSelectionModeFeature {
  abstract readonly id: UiSelectionModeId;

  /** What a click on an entry means, by the keys held. */
  abstract click(keys: UiSelectionKeys): UiSelectMode;

  /** What a movement key (arrows, `Home`/`End`, page keys) means, by the keys held. */
  abstract move(keys: UiSelectionKeys): UiSelectMode;

  /** What the cursor landing on an entry by type-to-find or a tree step means. */
  abstract find(): UiSelectMode;

  /**
   * Whether `Insert` on the entry that is selected only because the cursor
   * stands on it keeps it marked — so in normal mode, where the selection
   * follows the cursor; in additive mode a lone entry was picked, and flips.
   */
  abstract readonly keepsLone: boolean;

  /**
   * Whether a plain press on the blank space of the icon view clears the
   * selection, and a box drawn there starts afresh.
   */
  abstract readonly blankPressClears: boolean;
}
