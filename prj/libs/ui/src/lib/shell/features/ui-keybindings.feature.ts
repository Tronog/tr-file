import { computed, inject, signal } from '@angular/core';
import { UiKeymap, chordOf, displayChord, type UiKeyContext, type UiKeybinding } from '../../keyboard/keymap';
import type { UiCommandTarget } from '../ui-commands.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * Names for the library's commands that are keys only — gestures of a panel,
 * moves of focus — and not rows of the command table, which names its own.
 */
export const UI_KEY_COMMANDS: Readonly<Record<string, { readonly category: string; readonly label: string }>> = {
  'view.splitRight': { category: 'Panel', label: 'Split Panel Right' },
  'tab.previous': { category: 'Tab', label: 'Previous Tab' },
  'tab.next': { category: 'Tab', label: 'Next Tab' },
  'image.zoomIn': { category: 'Image', label: 'Zoom In' },
  'image.zoomOut': { category: 'Image', label: 'Zoom Out' },
  'image.actualSize': { category: 'Image', label: 'Actual Size (100%)' },
  'image.fit': { category: 'Image', label: 'Fit Whole Image' },
  'workbench.focusNextPart': { category: 'View', label: 'Focus Next Part' },
  'workbench.focusPreviousPart': { category: 'View', label: 'Focus Previous Part' },
  'workbench.nextPanel': { category: 'View', label: 'Focus Next Panel' },
  'workbench.previousPanel': { category: 'View', label: 'Focus Previous Panel' },
};

/** Window keys the shell handles itself, because they move DOM focus: see `UiWorkbenchShell`. */
export const UI_FOCUS_COMMANDS = ['workbench.focusNextPart', 'workbench.focusPreviousPart'] as const;

/** Where keys may apply. */
const CONTEXTS: readonly UiKeyContext[] = ['list', 'panel', 'window', 'image'];

/** What the user changed: bindings taken away from the defaults, and bindings added. */
interface UiKeybindingChanges {
  readonly removed: readonly UiKeybinding[];
  readonly added: readonly UiKeybinding[];
}

/** One binding, or a command with none, as the Keyboard Shortcuts page lists it. */
export interface UiKeybindingEntry {
  /** Unique among the entries: the command, the key, where. */
  readonly id: string;
  readonly command: string;
  readonly category: string;
  readonly label: string;
  /** `null` for a command bound to nothing. */
  readonly binding: UiKeybinding | null;
  /** `User` when the user added it; `Default` otherwise. */
  readonly source: 'Default' | 'User';
  /** Whether the user changed anything about the command's keys. */
  readonly modified: boolean;
}

const same = (a: UiKeybinding, b: UiKeybinding): boolean => a.command === b.command && a.key === b.key && a.when === b.when;

/** The store key of the user's changes to the keys. */
export function uiKeybindingsKey(prefix: string): string {
  return `${prefix}.keybindings.v1`;
}

/**
 * Every key the workbench answers, in one table the user can change
 * (PRD 010, §2) — VS Code's keybindings: a key, a command, and `when` it
 * applies (`UiKeyContext`).
 *
 * The defaults are the components' (`UiKeymap.defaults`) and the
 * application's (`UiWorkbenchConfig.keybindings`); the user's changes are
 * kept as what was taken away and what was added, so a default added later
 * still arrives. The table in force is handed to `UiKeymap`, which every
 * component asks before acting on a key — and the menus, the palette and the
 * cheatsheet read the keys they show from here, so what is shown is always
 * what works.
 *
 * The window's keys are run here (`handleShortcut`): each a command of the
 * table, on the active panel.
 */
export class UiKeybindingsFeature {
  private readonly keymap = inject(UiKeymap);

  /** Every binding as it is before the user changes anything. */
  readonly defaults: readonly UiKeybinding[];

  private readonly changes = signal<UiKeybindingChanges>({ removed: [], added: [] });

  private readonly key: string;

  constructor(protected readonly parent: UiWorkbenchService) {
    this.defaults = [...this.keymap.defaults, ...(parent.config.keybindings ?? [])];
    this.key = uiKeybindingsKey(parent.storagePrefix);
    const stored = parent.settings.get<Partial<UiKeybindingChanges>>(this.key);
    this.changes.set({
      removed: UiKeybindingsFeature.valid(stored?.removed),
      added: UiKeybindingsFeature.valid(stored?.added),
    });
    this.keymap.set(this.bindings());
  }

  /** The bindings in force: the defaults, less what was removed, and what was added. */
  readonly bindings = computed<readonly UiKeybinding[]>(() => {
    const { removed, added } = this.changes();
    return [...this.defaults.filter((binding) => !removed.some((gone) => same(gone, binding))), ...added];
  });

  /** The keys of `command`, the ones a panel answers first, then a row, then the window. */
  keysFor(command: string): readonly string[] {
    const order: readonly UiKeyContext[] = ['panel', 'list', 'image', 'window'];
    return order.flatMap((when) => this.bindings().filter((binding) => binding.command === command && binding.when === when).map((binding) => binding.key));
  }

  /** The key a menu or the palette shows beside `command`, or `undefined` when it has none. */
  label(command: string): string | undefined {
    const key = this.keysFor(command)[0];
    return key === undefined ? undefined : displayChord(key);
  }

  /** The window key bound to `key`. */
  windowCommandOf(key: string): string | null {
    return this.bindings().find((binding) => binding.when === 'window' && binding.key === key)?.command ?? null;
  }

  /** The commands that are keys only, by id: the library's and the application's. */
  private get keyCommands(): Readonly<Record<string, { readonly category: string; readonly label: string }>> {
    return { ...UI_KEY_COMMANDS, ...this.parent.config.keyCommands };
  }

  /** A command's category and name, from the command table or the keys-only names. */
  describe(command: string): { readonly category: string; readonly label: string } {
    const known = this.keyCommands[command];
    if (known !== undefined) {
      return known;
    }
    const commands = this.parent.commandsFt;
    const entry = commands.command(command);
    if (entry === undefined) {
      return { category: 'Other', label: command };
    }
    return { category: entry.category, label: entry.label(commands.activeTarget()) };
  }

  /**
   * The Keyboard Shortcuts page's rows: every binding, and every command of
   * the table and of the keys-only names that has none — so a key can be
   * given to anything.
   */
  readonly entries = computed<readonly UiKeybindingEntry[]>(() => {
    const { removed, added } = this.changes();
    const modified = new Set([...removed, ...added].map((binding) => binding.command));
    const bound = this.bindings().map((binding): UiKeybindingEntry => ({
      id: `${binding.command}|${binding.when}|${binding.key}`,
      command: binding.command,
      ...this.describe(binding.command),
      binding,
      source: added.some((candidate) => same(candidate, binding)) ? 'User' : 'Default',
      modified: modified.has(binding.command),
    }));
    const withKeys = new Set(bound.map((entry) => entry.command));
    const commands = [...this.parent.commandsFt.allCommands().map((command) => command.id), ...Object.keys(this.keyCommands)];
    const unbound = [...new Set(commands)]
      .filter((command) => !withKeys.has(command))
      .map((command): UiKeybindingEntry => ({
        id: `${command}||`,
        command,
        ...this.describe(command),
        binding: null,
        source: 'Default',
        modified: modified.has(command),
      }));
    return [...bound, ...unbound];
  });

  /** The other commands `key` already runs in `when` — what the page warns about while recording. */
  conflicts(key: string, when: UiKeyContext, command: string): readonly string[] {
    return this.bindings()
      .filter((binding) => binding.key === key && binding.when === when && binding.command !== command)
      .map((binding) => binding.command);
  }

  /** Where a command's new key applies: where its keys already do, else the window. */
  contextOf(command: string): UiKeyContext {
    return this.defaults.find((binding) => binding.command === command)?.when ?? 'window';
  }

  /* -- changing ------------------------------------------------------------- */

  /** Gives `command` one more key, in `when` (by default, where its keys already apply). */
  add(command: string, key: string, when: UiKeyContext = this.contextOf(command)): void {
    const binding: UiKeybinding = { command, key, when };
    if (this.bindings().some((candidate) => same(candidate, binding))) {
      return;
    }
    this.update(({ removed, added }) => {
      // A default taken away and given back is just the default again.
      const restored = removed.filter((gone) => !same(gone, binding));
      return restored.length < removed.length ? { removed: restored, added } : { removed, added: [...added, binding] };
    });
  }

  /** Takes a key away. */
  remove(binding: UiKeybinding): void {
    this.update(({ removed, added }) =>
      added.some((candidate) => same(candidate, binding))
        ? { removed, added: added.filter((candidate) => !same(candidate, binding)) }
        : { removed: [...removed, binding], added },
    );
  }

  /** Changes a key for another, where it applies. */
  change(binding: UiKeybinding, key: string): void {
    if (binding.key === key) {
      return;
    }
    this.remove(binding);
    this.add(binding.command, key, binding.when);
  }

  /** Puts a command's keys back as they were. */
  reset(command: string): void {
    this.update(({ removed, added }) => ({
      removed: removed.filter((binding) => binding.command !== command),
      added: added.filter((binding) => binding.command !== command),
    }));
  }

  /** Puts every key back as it was. */
  resetAll(): void {
    this.update(() => ({ removed: [], added: [] }));
  }

  private update(change: (current: UiKeybindingChanges) => UiKeybindingChanges): void {
    this.changes.update(change);
    const { removed, added } = this.changes();
    this.parent.settings.set(this.key, removed.length === 0 && added.length === 0 ? null : { removed, added });
    this.keymap.set(this.bindings());
  }

  /* -- the window's keys ----------------------------------------------------- */

  /**
   * A key pressed anywhere in the window: the window binding it is, run as a
   * command of the table on the active panel.
   *
   * Not while a modal window has the keyboard, nor the command palette — but
   * for the palette's own key, which opens it afresh. Not a key a panel or a
   * row already took. And in a text field only a chord with `Ctrl` or `Alt`,
   * or a function key: a letter bound to the window is still typed into a
   * field. A bound key that has nothing to act on is claimed all the same, so
   * a stray `F5` never reloads the page.
   */
  handleShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.parent.modal.isOpen()) {
      return;
    }
    const chord = chordOf(event);
    if (chord === null) {
      return;
    }
    const command = this.bindings().find(
      (binding) => binding.when === 'window' && binding.key === chord && !(UI_FOCUS_COMMANDS as readonly string[]).includes(binding.command),
    )?.command;
    if (command === undefined) {
      return;
    }
    if (this.parent.commandPaletteFt.isOpen() && command !== 'view.commandPalette') {
      return;
    }
    if (UiKeybindingsFeature.isTextField(event.target) && !/^(Ctrl|Alt)\+|^(Shift\+)?F\d+$/.test(chord)) {
      return;
    }
    event.preventDefault();
    this.run(command);
  }

  /** Runs a window command — a key pressed, or a button standing for one. */
  run(command: string): void {
    this.parent.commandsFt.run(command, this.targetOf(command));
  }

  /** What a window command acts on: the active panel, unless the application says otherwise. */
  targetOf(_command: string): UiCommandTarget {
    return this.parent.commandsFt.activeTarget();
  }

  private static isTextField(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
  }

  /** Stored bindings that are still bindings: anything else is dropped rather than trusted. */
  private static valid(value: unknown): readonly UiKeybinding[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is UiKeybinding =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as UiKeybinding).command === 'string' &&
        typeof (item as UiKeybinding).key === 'string' &&
        CONTEXTS.includes((item as UiKeybinding).when),
    );
  }
}
