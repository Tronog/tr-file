import { computed, signal } from '@angular/core';
import { chordParts, displayKey, type UiCheatsheetHue, type UiCheatsheetRow, type UiCheatsheetSection, type UiHelpTab, type UiKeyContext } from '@tr-file/ui';
import { HelpModal } from '../help/help-modal';
import type { WorkbenchService } from '../workbench.service';
import { BOOKMARK_KEYS, openBookmarkCommand } from './places.feature';

/** The Help window's pages (PRD 001, §16). */
export type HelpTabId = 'cheatsheet';

const TABS: readonly UiHelpTab[] = [{ id: 'cheatsheet', label: 'Cheatsheet' }];

/** The function keys, in the order the strip shows them. */
const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] as const;

/**
 * The configurable keys, by subject — as `SHORTCUTS.md` groups them. A
 * command's keys are read from the table in force, so a key the user changed
 * shows as they have it; a command bound to nothing is left out, and a bound
 * command no subject names goes under *Other*.
 */
const SUBJECTS: readonly { readonly id: string; readonly title: string; readonly hue: UiCheatsheetHue; readonly commands: readonly string[] }[] = [
  {
    id: 'window',
    title: 'Window',
    hue: 'blue',
    commands: [
      'view.commandPalette',
      'edit.search',
      'view.hidden',
      'workbench.openSettings',
      'view.togglePanel',
      'view.toggleExplorer',
      'view.toggleDetails',
      'view.toggleSidebars',
      'file.checkForUpdates',
      'workbench.focusNextPart',
      'workbench.focusPreviousPart',
    ],
  },
  {
    id: 'panels',
    title: 'Panels and tabs',
    hue: 'purple',
    commands: [
      'workbench.nextPanel',
      'workbench.previousPanel',
      'view.splitRight',
      'tab.new',
      'tab.close',
      'tab.previous',
      'tab.next',
      'view.toggleMaximize',
      'file.openToSide',
      'panel.contextMenu',
    ],
  },
  {
    id: 'files',
    title: 'Folders and files',
    hue: 'green',
    commands: [
      'file.open',
      'go.back',
      'go.forward',
      'go.up',
      'view.refresh',
      'view.stopLoading',
      'go.location',
      'edit.filter',
      'file.newFolder',
      'edit.copy',
      'edit.cut',
      'edit.paste',
      'edit.undo',
      'file.copyPath',
      'file.trash',
      'file.delete',
    ],
  },
  {
    id: 'selection',
    title: 'Selection',
    hue: 'orange',
    commands: ['list.select', 'list.toggleSelection', 'list.mark', 'list.toggleAll', 'selection.all', 'selection.byPattern', 'selection.unselectByPattern'],
  },
  {
    id: 'image',
    title: 'Image viewer',
    hue: 'pink',
    commands: ['image.previous', 'image.next', 'image.zoomIn', 'image.zoomOut', 'image.actualSize', 'image.fit'],
  },
  {
    id: 'bookmarks',
    title: 'Bookmarks',
    hue: 'yellow',
    commands: Array.from({ length: BOOKMARK_KEYS }, (_, index) => openBookmarkCommand(index + 1)),
  },
];

/** Where a key applies, when it is narrower than its card says. */
const WHERE: Partial<Record<UiKeyContext, string>> = {
  list: 'on a row',
  image: 'in the viewer',
};

type FixedRow = readonly [keys: readonly (readonly string[])[], label: string];

/**
 * The keys no one can change (PRD 010, §2): moving through lists, menus and
 * dialogs. Written out here, as `SHORTCUTS.md` writes them.
 */
const FIXED: readonly { readonly id: string; readonly title: string; readonly hue: UiCheatsheetHue; readonly rows: readonly FixedRow[] }[] = [
  {
    id: 'listing',
    title: 'Moving in a listing',
    hue: 'teal',
    rows: [
      [[['↑'], ['↓']], 'Move the cursor; the selection follows'],
      [[['Home'], ['End']], 'First / last entry'],
      [[['PageUp'], ['PageDown']], 'A page up / down'],
      [[['Shift', '↑'], ['Shift', '↓']], 'Extend the selection'],
      [[['Ctrl', '↓']], 'Move the cursor, leaving the selection alone'],
      [[['a…z']], 'Type-to-find: jump to the next name starting with it'],
      [[['→'], ['←']], 'Tree view: open a folder in place / close it'],
    ],
  },
  {
    id: 'tree',
    title: 'Explorer tree',
    hue: 'yellow',
    rows: [
      [[['↑'], ['↓']], 'Move through the folders'],
      [[['→'], ['←']], 'Open / close a folder, or step to its child / parent'],
      [[['Shift', 'F10'], ['ContextMenu']], 'Context menu'],
    ],
  },
  {
    id: 'tab-bar',
    title: 'Tab bar',
    hue: 'purple',
    rows: [
      [[['←'], ['→']], 'Move between tabs'],
      [[['Ctrl', '←'], ['Ctrl', '→']], 'Move the tab left / right'],
      [[['Delete'], ['Backspace']], 'Close the tab'],
    ],
  },
  {
    id: 'path-bar',
    title: 'Filter box and path bar',
    hue: 'green',
    rows: [
      [[['Escape']], 'Filter: clear it; again, back to the listing'],
      [[['Enter']], 'Path bar: go to the chosen suggestion, or the path typed'],
      [[['↓'], ['↑']], 'Path bar: choose among the suggestions'],
      [[['Tab']], 'Path bar: complete to the chosen suggestion'],
      [[['Escape']], 'Path bar: close the suggestions; again, cancel'],
    ],
  },
  {
    id: 'image-fixed',
    title: 'Image viewer (zoomed)',
    hue: 'pink',
    rows: [[[['←'], ['↑'], ['→'], ['↓']], 'Pan a zoomed image']],
  },
  {
    id: 'sidebars',
    title: 'Sidebars',
    hue: 'blue',
    rows: [
      [[['Ctrl', '↑'], ['Ctrl', '↓']], 'On a section header: move the section'],
      [[['Ctrl', '↑'], ['Ctrl', '↓']], 'On a bookmark: move it up / down'],
      [[['↑'], ['↓']], 'On a section’s resize handle: resize'],
      [[['←'], ['→']], 'On a sidebar’s edge: resize the sidebar'],
      [[['Ctrl', 'Enter']], 'Git message box: commit'],
    ],
  },
  {
    id: 'zoom',
    title: 'Zoom (desktop)',
    hue: 'teal',
    rows: [
      [[['Ctrl', '='], ['Ctrl', '+']], 'Zoom in'],
      [[['Ctrl', '-']], 'Zoom out'],
      [[['Ctrl', '0']], 'Back to 100 %'],
    ],
  },
  {
    id: 'pickers',
    title: 'Command palette and pickers',
    hue: 'orange',
    rows: [
      [[['↑'], ['↓']], 'Move through the items'],
      [[['Enter']], 'Run / accept'],
      [[['Escape']], 'Close'],
      [[['F2']], 'A saved server: edit it'],
      [[['Shift', 'Delete']], 'A saved server: remove it'],
    ],
  },
  {
    id: 'dialogs',
    title: 'Dialogs',
    hue: 'red',
    rows: [
      [[['Enter']], 'In a text field: the first button'],
      [[['←'], ['→']], 'Move between the buttons'],
      [[['Escape']], 'Close without an answer'],
    ],
  },
];

/** The keys of a chord as keycaps: `Ctrl+Shift+Plus` → `Ctrl`, `Shift`, `+`. */
function keycaps(key: string): readonly string[] {
  return chordParts(key).map(displayKey);
}

/**
 * The Help window (PRD 001, §16): `F1`, or *Help › Show Help*. It opens on
 * the *Cheatsheet* (§16.1) — every key the app answers, in coloured cards the
 * way vim's and tmux's cheatsheets are printed. The configurable cards are
 * built from `KeybindingsFeature`'s table as it is now, so a key the user
 * changed in the settings is the key shown here; the fixed keys follow.
 *
 * `HelpModal` puts the library's `UiHelp` and `UiCheatsheet` in a large modal
 * window; this feature is their model. The search box narrows the cards to
 * the rows whose words or keys match, a card whose title matches kept whole.
 */
export class HelpFeature {
  private readonly tab = signal<HelpTabId>('cheatsheet');
  private readonly search = signal('');
  private readonly opened = signal(false);

  constructor(private readonly parent: WorkbenchService) {}

  readonly tabs = TABS;
  readonly activeTab = this.tab.asReadonly();
  readonly query = this.search.asReadonly();
  readonly isOpen = this.opened.asReadonly();

  /** Opens the window at `tab` — or, when it is open, turns to it. */
  open(tab: HelpTabId = 'cheatsheet'): void {
    this.selectTab(tab);
    if (this.opened()) {
      return;
    }
    this.opened.set(true);
    void this.parent.modal.open(HelpModal, { label: 'Help', size: 'large', inputs: { help: this } }).then(() => {
      this.opened.set(false);
      this.search.set('');
    });
  }

  selectTab(tab: string): void {
    if (TABS.some((candidate) => candidate.id === tab)) {
      this.tab.set(tab as HelpTabId);
    }
  }

  setQuery(text: string): void {
    this.search.set(text);
  }

  /** Every card, from the key table in force (§16.1). */
  readonly sections = computed<readonly UiCheatsheetSection[]>(() => {
    const keys = this.parent.keybindingsFt;
    const bindings = keys.bindings();
    const isFunctionKey = (key: string, when: UiKeyContext): boolean => when === 'window' && (FUNCTION_KEYS as readonly string[]).includes(key);

    const rowsOf = (command: string): UiCheatsheetRow[] => {
      const byContext = new Map<UiKeyContext, string[]>();
      for (const binding of bindings) {
        if (binding.command === command && !isFunctionKey(binding.key, binding.when)) {
          byContext.set(binding.when, [...(byContext.get(binding.when) ?? []), binding.key]);
        }
      }
      const { label } = keys.describe(command);
      return [...byContext].map(([when, chords]) => ({
        id: `${command}|${when}`,
        keys: chords.map(keycaps),
        label,
        ...(WHERE[when] ? { where: WHERE[when] } : {}),
      }));
    };

    const functionKeys: UiCheatsheetSection = {
      id: 'function-keys',
      title: 'Function keys',
      hue: 'teal',
      note: 'Midnight Commander’s, shown in the status bar.',
      rows: FUNCTION_KEYS.flatMap((key): UiCheatsheetRow[] => {
        const command = keys.windowCommandOf(key);
        return command === null ? [] : [{ id: key, keys: [[key]], label: keys.describe(command).label }];
      }),
    };

    const named = new Set(SUBJECTS.flatMap((subject) => subject.commands));
    const configurable = SUBJECTS.map(
      (subject): UiCheatsheetSection => ({ id: subject.id, title: subject.title, hue: subject.hue, rows: subject.commands.flatMap(rowsOf) }),
    );
    const others = [...new Set(bindings.map((binding) => binding.command))].filter((command) => !named.has(command)).flatMap(rowsOf);
    const other: UiCheatsheetSection = { id: 'other', title: 'Other', hue: 'yellow', rows: others };

    const fixed = FIXED.map(
      (section): UiCheatsheetSection => ({
        id: section.id,
        title: section.title,
        hue: section.hue,
        note: 'Fixed — not configurable.',
        rows: section.rows.map(([chords, label], index) => ({ id: `${section.id}-${index}`, keys: chords, label })),
      }),
    );

    const [window, ...rest] = configurable;
    return [...(window ? [window] : []), functionKeys, ...rest, other, ...fixed].filter((section) => section.rows.length > 0);
  });

  /** The cards the search box leaves (§16.1). */
  readonly cheatsheet = computed<readonly UiCheatsheetSection[]>(() => {
    const words = this.search().trim().toLowerCase().split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) {
      return this.sections();
    }
    const matches = (text: string): boolean => words.every((word) => text.includes(word));
    return this.sections().flatMap((section): UiCheatsheetSection[] => {
      if (matches(section.title.toLowerCase())) {
        return [section];
      }
      const rows = section.rows.filter((row) =>
        matches(`${row.label} ${row.where ?? ''} ${row.keys.map((chord) => chord.join('+')).join(' ')}`.toLowerCase()),
      );
      return rows.length === 0 ? [] : [{ ...section, rows }];
    });
  });
}
