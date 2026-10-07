import { InjectionToken, Service, inject, signal } from '@angular/core';

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
 *
 * But for the key left of `1` in a chord with `Ctrl` or `Alt`: it is `` ` ``
 * by where it is, not by what it types — `~` with `Shift` on a US layout, a
 * dead key on many others — so `Ctrl`+`Shift`+`` ` `` (PRD 001, §12.3) is the
 * same chord on every keyboard, `Shift` and all, as the desktop's `Ctrl`+`` ` ``
 * is (PRD 001, §8.5).
 */
export function chordOf(event: KeyboardEvent): string | null {
  if (event.code === 'Backquote' && (event.ctrlKey || event.metaKey || event.altKey)) {
    return [...(event.ctrlKey || event.metaKey ? ['Ctrl'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.altKey ? ['Alt'] : []), '`'].join('+');
  }
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
 * The library's own keys, as they are until the application says otherwise:
 * a panel group's (`UiPanelGroup` — split, new tab, maximize, close, the next
 * and previous tab) and the image viewer's (`UiImageView` — zoom and fit).
 *
 * A library built on this one adds its components' keys with
 * `UI_KEYBINDING_DEFAULTS` — `@tr-file/file-ui` its listings' — and the
 * application its own window keys on top, in its key table.
 */
export const UI_DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [
  // Anywhere in a panel (PRD 002, §2.2, §2.8).
  { command: 'view.splitRight', key: '/', when: 'panel' },
  { command: 'tab.new', key: 'Ctrl+T', when: 'panel' },
  { command: 'view.toggleMaximize', key: 'Ctrl+Up', when: 'panel' },
  { command: 'tab.close', key: 'Ctrl+W', when: 'panel' },
  { command: 'tab.previous', key: 'Ctrl+PageUp', when: 'panel' },
  { command: 'tab.next', key: 'Ctrl+PageDown', when: 'panel' },
  // In the image viewer (PRD 012, §1.2).
  { command: 'image.zoomIn', key: 'Plus', when: 'image' },
  { command: 'image.zoomOut', key: '-', when: 'image' },
  { command: 'image.actualSize', key: '1', when: 'image' },
  { command: 'image.fit', key: '0', when: 'image' },
];

/**
 * Default keys of components built on this library, each provider one table
 * (`multi: true`). They come before the library's own in `UiKeymap`'s
 * defaults, so a component's binding of a key wins over a generic one.
 */
export const UI_KEYBINDING_DEFAULTS = new InjectionToken<readonly (readonly UiKeybinding[])[]>('UI_KEYBINDING_DEFAULTS');

/**
 * The key bindings in force (PRD 010, §2): what every component of the
 * library asks before it acts on a key, instead of testing the key itself.
 *
 * It starts with its `defaults` — every table provided as
 * `UI_KEYBINDING_DEFAULTS`, then `UI_DEFAULT_KEYBINDINGS` — so the components
 * work as they are; the application hands it the whole table — its own bindings and the user's
 * changes included — with `set`. Navigation — the arrows, `Home` / `End`, the
 * page keys, type-to-find, `Escape` — is not bound here: it is what a list or
 * a menu *is*, not a command.
 */
@Service()
export class UiKeymap {
  /** Every key of the components, before the application's table and the user's changes. */
  readonly defaults: readonly UiKeybinding[] = [...(inject(UI_KEYBINDING_DEFAULTS, { optional: true }) ?? []).flat(), ...UI_DEFAULT_KEYBINDINGS];

  private readonly current = signal<readonly UiKeybinding[]>(this.defaults);

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
