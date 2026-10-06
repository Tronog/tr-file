import { computed, inject, signal } from '@angular/core';
import { FILE_UI_DEFAULT_KEYBINDINGS } from '@tr-file/file-ui';
import { UI_DEFAULT_KEYBINDINGS, UiKeymap, chordOf, displayChord, type UiKeyContext, type UiKeybinding } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';
import type { CommandTarget } from './commands.feature';
import { BOOKMARK_KEYS, openBookmarkCommand } from './places.feature';

/** Where the user's changes to the key bindings are kept (PRD 010, §2) — for every backend alike. */
export const KEYBINDINGS_KEY = 'tr-file.keybindings.v1';

/**
 * The window's own keys (`when: 'window'`), and the application's keys in a
 * panel (`Tab` between panels). The library's are `UI_DEFAULT_KEYBINDINGS`.
 */
export const WORKBENCH_DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [
  { command: 'view.commandPalette', key: 'Ctrl+Shift+P', when: 'window' },
  { command: 'view.commandPalette', key: 'Ctrl+P', when: 'window' },
  { command: 'edit.search', key: 'Ctrl+Shift+F', when: 'window' },
  { command: 'view.hidden', key: 'Ctrl+H', when: 'window' },
  { command: 'workbench.openSettings', key: 'Ctrl+,', when: 'window' },
  { command: 'view.togglePanel', key: 'Ctrl+Shift+`', when: 'window' },
  // PRD 001, §9.2.1.
  { command: 'view.toggleExplorer', key: 'Ctrl+E', when: 'window' },
  { command: 'view.toggleDetails', key: 'Ctrl+D', when: 'window' },
  { command: 'view.toggleSidebars', key: 'Ctrl+/', when: 'window' },
  // PRD 001, §8.6.1 — the desktop's; in a browser the command is disabled and the key does nothing.
  { command: 'file.checkForUpdates', key: 'Ctrl+U', when: 'window' },
  // The bookmarks, in their order, from any panel (PRD 002, §6.1).
  ...Array.from({ length: BOOKMARK_KEYS }, (_, index): UiKeybinding => ({
    command: openBookmarkCommand(index + 1),
    key: `Ctrl+${index + 1}`,
    when: 'window',
  })),
  { command: 'workbench.focusNextPart', key: 'Ctrl+Tab', when: 'window' },
  { command: 'workbench.focusPreviousPart', key: 'Ctrl+Shift+Tab', when: 'window' },
  { command: 'workbench.nextPanel', key: 'Tab', when: 'panel' },
  { command: 'workbench.previousPanel', key: 'Shift+Tab', when: 'panel' },
  // Midnight Commander's function keys (PRD 004, §2).
  // Help, as Midnight Commander's `F1` is (PRD 001, §16).
  { command: 'help.show', key: 'F1', when: 'window' },
  { command: 'file.rename', key: 'F2', when: 'window' },
  { command: 'file.open', key: 'F3', when: 'window' },
  { command: 'file.openExternal', key: 'F4', when: 'window' },
  { command: 'file.copyTo', key: 'F5', when: 'window' },
  { command: 'file.moveTo', key: 'F6', when: 'window' },
  { command: 'file.newFolder', key: 'F7', when: 'window' },
  // Midnight Commander's Delete: for good, after asking — the trash is `Delete` (PRD 004, §2.1).
  { command: 'file.delete', key: 'F8', when: 'window' },
  { command: 'view.mainMenu', key: 'F9', when: 'window' },
  { command: 'file.quit', key: 'F10', when: 'window' },
];

/**
 * Every binding as it is before the user changes anything: the file manager's
 * components' (`FILE_UI_DEFAULT_KEYBINDINGS`), the generic library's
 * (`UI_DEFAULT_KEYBINDINGS`) and the window's — in `UiKeymap.defaults`' order.
 */
export const DEFAULT_KEYBINDINGS: readonly UiKeybinding[] = [...FILE_UI_DEFAULT_KEYBINDINGS, ...UI_DEFAULT_KEYBINDINGS, ...WORKBENCH_DEFAULT_KEYBINDINGS];

/**
 * Names for the commands that are keys only — gestures of a list, moves of
 * focus — and not rows of the command table, which names its own.
 */
const KEY_ONLY_COMMANDS: Readonly<Record<string, { readonly category: string; readonly label: string }>> = {
  'list.select': { category: 'List', label: 'Select Entry' },
  'list.toggleSelection': { category: 'List', label: 'Toggle Selection' },
  'list.mark': { category: 'List', label: 'Mark Entry and Move Down' },
  'list.toggleAll': { category: 'List', label: 'Select All or None' },
  'panel.contextMenu': { category: 'Panel', label: 'Show Context Menu' },
  'view.splitRight': { category: 'Panel', label: 'Split Panel Right' },
  'tab.previous': { category: 'Tab', label: 'Previous Tab' },
  'tab.next': { category: 'Tab', label: 'Next Tab' },
  'view.stopLoading': { category: 'View', label: 'Stop Reading the Folder' },
  'image.previous': { category: 'Image', label: 'Previous Image in Folder' },
  'image.next': { category: 'Image', label: 'Next Image in Folder' },
  'image.zoomIn': { category: 'Image', label: 'Zoom In' },
  'image.zoomOut': { category: 'Image', label: 'Zoom Out' },
  'image.actualSize': { category: 'Image', label: 'Actual Size (100%)' },
  'image.fit': { category: 'Image', label: 'Fit Whole Image' },
  'workbench.focusNextPart': { category: 'View', label: 'Focus Next Part' },
  'workbench.focusPreviousPart': { category: 'View', label: 'Focus Previous Part' },
  'workbench.nextPanel': { category: 'View', label: 'Focus Next Panel' },
  'workbench.previousPanel': { category: 'View', label: 'Focus Previous Panel' },
};

/**
 * Window keys that act on the entry the cursor is on rather than on the
 * selection — as Midnight Commander's `F2`–`F4` do (PRD 004, §2).
 */
const CURSOR_COMMANDS = new Set(['file.rename', 'file.open', 'file.openExternal']);

/** Window keys the component handles, because they move DOM focus: see `Workbench.onDocumentKeydown`. */
export const FOCUS_COMMANDS = ['workbench.focusNextPart', 'workbench.focusPreviousPart'] as const;

/** What the user changed: bindings taken away from the defaults, and bindings added. */
interface KeybindingChanges {
  readonly removed: readonly UiKeybinding[];
  readonly added: readonly UiKeybinding[];
}

/** One binding, or a command with none, as the Keyboard Shortcuts page lists it. */
export interface KeybindingEntry {
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

/**
 * Every key the workbench answers, in one table the user can change
 * (PRD 010, §2) — VS Code's keybindings: a key, a command, and `when` it
 * applies (`UiKeyContext`).
 *
 * The defaults are the libraries' (`FILE_UI_DEFAULT_KEYBINDINGS`,
 * `UI_DEFAULT_KEYBINDINGS`) and the window's
 * (`WORKBENCH_DEFAULT_KEYBINDINGS`); the user's changes are kept as what was
 * taken away and what was added (`KEYBINDINGS_KEY`), so a default the app
 * adds later still arrives. The table in force is handed to the library's
 * `UiKeymap`, which every component asks before acting on a key — and the
 * menus, the palette and the function-key strip read the keys they show from
 * here, so what is shown is always what works.
 *
 * The window's keys are run here (`handleShortcut`): each a command of
 * `CommandsFeature`, on the active panel.
 */
export class KeybindingsFeature {
  private readonly keymap = inject(UiKeymap);

  private readonly changes = signal<KeybindingChanges>({ removed: [], added: [] });

  constructor(private readonly parent: WorkbenchService) {
    const stored = parent.settings.get<Partial<KeybindingChanges>>(KEYBINDINGS_KEY);
    this.changes.set({
      removed: KeybindingsFeature.valid(stored?.removed),
      added: KeybindingsFeature.valid(stored?.added),
    });
    this.keymap.set(this.bindings());
  }

  /** The bindings in force: the defaults, less what was removed, and what was added. */
  readonly bindings = computed<readonly UiKeybinding[]>(() => {
    const { removed, added } = this.changes();
    return [...DEFAULT_KEYBINDINGS.filter((binding) => !removed.some((gone) => same(gone, binding))), ...added];
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

  /** The window key bound to `key` — the function-key strip's question. */
  windowCommandOf(key: string): string | null {
    return this.bindings().find((binding) => binding.when === 'window' && binding.key === key)?.command ?? null;
  }

  /** A command's category and name, from the command table or `KEY_ONLY_COMMANDS`. */
  describe(command: string): { readonly category: string; readonly label: string } {
    const known = KEY_ONLY_COMMANDS[command];
    if (known !== undefined) {
      return known;
    }
    const entry = this.parent.commandsFt.command(command);
    if (entry === undefined) {
      return { category: 'Other', label: command };
    }
    return { category: entry.category, label: entry.label(this.parent.commandsFt.activeTarget()) };
  }

  /**
   * The Keyboard Shortcuts page's rows: every binding, and every command of
   * the table and of `KEY_ONLY_COMMANDS` that has none — so a key can be given
   * to anything.
   */
  readonly entries = computed<readonly KeybindingEntry[]>(() => {
    const { removed, added } = this.changes();
    const modified = new Set([...removed, ...added].map((binding) => binding.command));
    const bound = this.bindings().map((binding): KeybindingEntry => ({
      id: `${binding.command}|${binding.when}|${binding.key}`,
      command: binding.command,
      ...this.describe(binding.command),
      binding,
      source: added.some((candidate) => same(candidate, binding)) ? 'User' : 'Default',
      modified: modified.has(binding.command),
    }));
    const withKeys = new Set(bound.map((entry) => entry.command));
    const commands = [...this.parent.commandsFt.allCommands().map((command) => command.id), ...Object.keys(KEY_ONLY_COMMANDS)];
    const unbound = [...new Set(commands)]
      .filter((command) => !withKeys.has(command))
      .map((command): KeybindingEntry => ({
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
    return DEFAULT_KEYBINDINGS.find((binding) => binding.command === command)?.when ?? 'window';
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

  private update(change: (current: KeybindingChanges) => KeybindingChanges): void {
    this.changes.update(change);
    const { removed, added } = this.changes();
    this.parent.settings.set(KEYBINDINGS_KEY, removed.length === 0 && added.length === 0 ? null : { removed, added });
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
      (binding) => binding.when === 'window' && binding.key === chord && !(FOCUS_COMMANDS as readonly string[]).includes(binding.command),
    )?.command;
    if (command === undefined) {
      return;
    }
    if (this.parent.commandPaletteFt.isOpen() && command !== 'view.commandPalette') {
      return;
    }
    if (KeybindingsFeature.isTextField(event.target) && !/^(Ctrl|Alt)\+|^(Shift\+)?F\d+$/.test(chord)) {
      return;
    }
    event.preventDefault();
    this.run(command);
  }

  /** Runs a window command — a key pressed, or one clicked in the function-key strip. */
  run(command: string): void {
    this.parent.commandsFt.run(command, this.targetOf(command));
  }

  /** What a window command acts on; see `CURSOR_COMMANDS`. */
  targetOf(command: string): CommandTarget {
    const target = this.parent.commandsFt.activeTarget();
    if (!CURSOR_COMMANDS.has(command)) {
      return target;
    }
    const cursor = this.cursorOf(target);
    return { ...target, paths: cursor === null ? [] : [cursor] };
  }

  /**
   * The entry the active panel's cursor is on — the focused one, else the one
   * selected first — while the panel lists a folder that has it.
   */
  private cursorOf(target: CommandTarget): string | null {
    const group = this.parent.editorGroupsFt.stateOf(target.groupId);
    if (group === undefined || target.folder === null) {
      return null;
    }
    const cursor = group.focusedEntryId ?? group.selection[0];
    return cursor !== undefined && this.parent.fsDataFt.entryAt(cursor) !== undefined ? cursor : null;
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
        ['list', 'panel', 'window', 'image'].includes((item as UiKeybinding).when),
    );
  }
}
