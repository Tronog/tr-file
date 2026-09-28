import { Service, signal } from '@angular/core';

/**
 * Where a key binding applies (PRD 010, §2) — VS Code's `when`, reduced to
 * the three places this workbench has keys:
 *
 * - `list` — on a row or a tile of a listing (`UiFileList`, `UiIconView`);
 * - `panel` — anywhere in a panel but a text field (`UiFileBrowser`,
 *   `UiPanelGroup`, and the application's `Tab` between panels);
 * - `window` — anywhere in the window; the application binds these.
 * - `image` — in the image viewer (PRD 012, §1.2): zoom and fit.
 *
 * A key pressed on a row is offered to the row first, then to the panel,
 * then to the window, and the first binding that takes it wins — so one key
 * can mean one thing on a row and another elsewhere.
 */
export type UiKeyContext = 'list' | 'panel' | 'window' | 'image';

/** One key bound to one command, in one context. */
export interface UiKeybinding {
  /** The command's id — the application's command table's, or one of the library's own. */
  readonly command: string;
  /** A chord as `chordOf` writes it: `Ctrl+Shift+P`, `F5`, `Alt+Left`, `Plus`. */
  readonly key: string;
  readonly when: UiKeyContext;
}

/** Modifiers, in the order a chord writes them. */
const MODIFIERS = ['Ctrl', 'Shift', 'Alt'] as const;

/** `KeyboardEvent.key` names that a chord spells differently. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  '+': 'Plus',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Esc: 'Escape',
  Del: 'Delete',
  Apps: 'ContextMenu',
};

/** Keys that are only ever part of a chord, never a chord of their own. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Hyper', 'Super', 'Fn']);

/**
 * The chord `event` is, or `null` for a modifier pressed on its own.
 *
 * `Ctrl` stands for `Cmd` on macOS too, as it does everywhere else in the
 * workbench. A letter is written in capitals whatever `Shift` did to it. A
 * symbol — `*`, `+`, `-` — is written as the character it typed, without the
 * `Shift` it may have taken to type it, so `*` means `*` on every layout.
 */
export function chordOf(event: KeyboardEvent): string | null {
  const raw = event.key;
  if (raw === undefined || raw === '' || MODIFIER_KEYS.has(raw) || raw === 'Unidentified' || raw === 'Dead') {
    return null;
  }
  let key = KEY_NAMES[raw] ?? raw;
  const symbol = raw.length === 1 && !/[\p{L}\p{N} ]/u.test(raw);
  if (key.length === 1) {
    key = key.toUpperCase();
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push('Ctrl');
  }
  if (event.shiftKey && !symbol) {
    parts.push('Shift');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  parts.push(key);
  return parts.join('+');
}

/** A chord's parts, modifiers first: `['Ctrl', 'Shift', 'P']`. */
export function chordParts(chord: string): readonly string[] {
  return chord.split('+').filter((part) => part !== '');
}

/** How a key of a chord is shown: `Plus` as `+`, the arrows as arrows. */
export function displayKey(part: string): string {
  switch (part) {
    case 'Plus':
      return '+';
    case 'Left':
      return '←';
    case 'Right':
      return '→';
    case 'Up':
      return '↑';
    case 'Down':
      return '↓';
    default:
      return part;
  }
}

/** A chord as a menu shows it, beside a command: `Ctrl+Shift+P`, `Alt+Left`, `+`. */
export function displayChord(chord: string): string {
  return chord === 'Plus' ? '+' : chord;
}

/** Whether `chord` is well formed: modifiers in order, each once, then one key. */
export function isChord(chord: string): boolean {
  const parts = chordParts(chord);
  const key = parts.at(-1);
  if (key === undefined || (MODIFIERS as readonly string[]).includes(key)) {
    return false;
  }
  const modifiers = parts.slice(0, -1);
  const order = modifiers.map((modifier) => (MODIFIERS as readonly string[]).indexOf(modifier));
  return order.every((at, index) => at !== -1 && (index === 0 || at > (order[index - 1] as number)));
}

/**
 * The library's own keys, as they are until the application says otherwise.
 *
 * Where a key does what a command of the application's table does, it is
 * bound to that command's id — `file.open`, `edit.copy` — so one binding
 * governs the key in the list and the key the menu shows beside the command.
 * The rest are the library's own gestures: `list.select`, `list.mark`, …
 */
export const UI_DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [
  // On a row or a tile.
  { command: 'file.open', key: 'Enter', when: 'list' },
  { command: 'list.select', key: 'Space', when: 'list' },
  { command: 'go.up', key: 'Backspace', when: 'list' },
  { command: 'file.trash', key: 'Delete', when: 'list' },
  { command: 'file.delete', key: 'Shift+Delete', when: 'list' },
  { command: 'selection.all', key: 'Ctrl+A', when: 'list' },
  { command: 'list.toggleSelection', key: 'Ctrl+Space', when: 'list' },
  // Midnight Commander's (PRD 004, §2).
  { command: 'list.mark', key: 'Insert', when: 'list' },
  { command: 'list.toggleAll', key: '*', when: 'list' },
  { command: 'selection.byPattern', key: 'Plus', when: 'list' },
  { command: 'selection.unselectByPattern', key: '-', when: 'list' },
  // Anywhere in a panel.
  { command: 'go.back', key: 'Alt+Left', when: 'panel' },
  { command: 'go.forward', key: 'Alt+Right', when: 'panel' },
  { command: 'go.up', key: 'Alt+Up', when: 'panel' },
  { command: 'file.openToSide', key: 'Ctrl+Enter', when: 'panel' },
  { command: 'edit.copy', key: 'Ctrl+C', when: 'panel' },
  { command: 'edit.cut', key: 'Ctrl+X', when: 'panel' },
  { command: 'edit.paste', key: 'Ctrl+V', when: 'panel' },
  { command: 'edit.undo', key: 'Ctrl+Z', when: 'panel' },
  { command: 'edit.filter', key: 'Ctrl+F', when: 'panel' },
  { command: 'go.location', key: 'Ctrl+L', when: 'panel' },
  { command: 'file.newFolder', key: 'Ctrl+Shift+N', when: 'panel' },
  { command: 'view.refresh', key: 'Ctrl+R', when: 'panel' },
  { command: 'file.copyPath', key: 'Ctrl+Shift+C', when: 'panel' },
  { command: 'panel.contextMenu', key: 'Shift+F10', when: 'panel' },
  { command: 'panel.contextMenu', key: 'ContextMenu', when: 'panel' },
  { command: 'view.splitRight', key: '/', when: 'panel' },
  { command: 'tab.new', key: 'Ctrl+T', when: 'panel' },
  { command: 'tab.close', key: 'Ctrl+W', when: 'panel' },
  { command: 'tab.previous', key: 'Ctrl+PageUp', when: 'panel' },
  { command: 'tab.next', key: 'Ctrl+PageDown', when: 'panel' },
  { command: 'image.previous', key: 'PageUp', when: 'panel' },
  { command: 'image.next', key: 'PageDown', when: 'panel' },
  { command: 'image.zoomIn', key: 'Plus', when: 'image' },
  { command: 'image.zoomOut', key: '-', when: 'image' },
  { command: 'image.actualSize', key: '1', when: 'image' },
  { command: 'image.fit', key: '0', when: 'image' },
];

/**
 * The key bindings in force (PRD 010, §2): what every component of the
 * library asks before it acts on a key, instead of testing the key itself.
 *
 * It starts with `UI_DEFAULT_KEYBINDINGS`, so the library works as it is; the
 * application hands it the whole table — its own bindings and the user's
 * changes included — with `set`. Navigation — the arrows, `Home` / `End`, the
 * page keys, type-to-find, `Escape` — is not bound here: it is what a list or
 * a menu *is*, not a command.
 */
@Service()
export class UiKeymap {
  private readonly current = signal<readonly UiKeybinding[]>(UI_DEFAULT_KEYBINDINGS);

  readonly bindings = this.current.asReadonly();

  set(bindings: readonly UiKeybinding[]): void {
    this.current.set(bindings);
  }

  /**
   * The command `event` is bound to in `when`, among `commands` — the ones
   * the asker handles — or `null`. The first binding in table order wins.
   */
  commandFor(event: KeyboardEvent, when: UiKeyContext, commands: readonly string[]): string | null {
    const chord = chordOf(event);
    if (chord === null) {
      return null;
    }
    return this.current().find((binding) => binding.when === when && binding.key === chord && commands.includes(binding.command))?.command ?? null;
  }

  /** The keys `command` is bound to, in table order — in `when` only, if given. */
  keysFor(command: string, when?: UiKeyContext): readonly string[] {
    return this.current()
      .filter((binding) => binding.command === command && (when === undefined || binding.when === when))
      .map((binding) => binding.key);
  }
}
