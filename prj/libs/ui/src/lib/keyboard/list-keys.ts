import type { UiPanelCommand } from '../models';
import { chordOf, type UiKeymap } from './keymap';

/** The commands a row or a tile answers (`when: 'list'`); see `UI_DEFAULT_KEYBINDINGS`. */
export const LIST_COMMANDS = [
  'file.open',
  'list.select',
  'go.up',
  'file.trash',
  'file.delete',
  'selection.all',
  'list.toggleSelection',
  'list.mark',
  'list.toggleAll',
  'selection.byPattern',
  'selection.unselectByPattern',
] as const;

export type UiListCommand = (typeof LIST_COMMANDS)[number];

/**
 * The list commands that are the application's to carry out, as the
 * `UiPanelKey` a list reports for them. The rest — selecting all, toggling,
 * marking — are selection gestures the list makes itself.
 */
export const LIST_PANEL_KEYS: Readonly<Partial<Record<UiListCommand, UiPanelCommand>>> = {
  'file.open': 'open',
  'list.select': 'select',
  'go.up': 'up',
  'file.trash': 'delete',
  'file.delete': 'delete-permanently',
  'selection.byPattern': 'select-pattern',
  'selection.unselectByPattern': 'unselect-pattern',
};

/**
 * The list command `event` is bound to, or `null`.
 *
 * A chord that is a character on its own — `*`, `+`, `-`, or a letter someone
 * bound — is taken as part of a name while one is being typed (`typing`), so
 * type-to-find still finds `a-b.txt`.
 */
export function listCommandFor(keymap: UiKeymap, event: KeyboardEvent, typing: boolean): UiListCommand | null {
  const chord = chordOf(event);
  if (chord === null || (typing && (chord.length === 1 || chord === 'Plus'))) {
    return null;
  }
  return keymap.commandFor(event, 'list', LIST_COMMANDS) as UiListCommand | null;
}

/**
 * The `aria-keyshortcuts` of a row or a tile: the keys bound to it, as ARIA
 * spells them (`Control+Shift+P`).
 */
export function listKeyShortcuts(keymap: UiKeymap): string {
  return keymap
    .bindings()
    .filter((binding) => binding.when === 'list')
    .map((binding) =>
      binding.key
        .replace(/^Plus$/, '+')
        .replace(/\bCtrl\b/, 'Control')
        .replace(/\b(Left|Right|Up|Down)\b/, 'Arrow$1'),
    )
    .join(' ');
}
