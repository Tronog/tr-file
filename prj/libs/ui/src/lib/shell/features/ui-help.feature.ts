import { computed, signal } from '@angular/core';
import { chordParts, displayKey, type UiKeyContext } from '../../keyboard/keymap';
import type { UiCheatsheetRow, UiCheatsheetSection, UiHelpTab } from '../../models/help.model';
import { UiHelpModal } from '../ui-help-modal';
import type { UiWorkbenchService } from '../ui-workbench.service';

const TABS: readonly UiHelpTab[] = [{ id: 'cheatsheet', label: 'Cheatsheet' }];

/** Where a key applies, when it is narrower than its card says, unless the configuration says otherwise. */
const WHERE: Partial<Record<UiKeyContext, string>> = {
  list: 'on a row',
  image: 'in the viewer',
};

/** The keys of a chord as keycaps: `Ctrl+Shift+Plus` → `Ctrl`, `Shift`, `+`. */
function keycaps(key: string): readonly string[] {
  return chordParts(key).map(displayKey);
}

/**
 * The Help window (PRD 001, §16). It opens on the *Cheatsheet* (§16.1) —
 * every key the workbench answers, in coloured cards the way vim's and
 * tmux's cheatsheets are printed. The configurable cards are the
 * configuration's subjects (`UiHelpConfig.subjects`), their keys read from
 * the table in force, so a key the user changed in the settings is the key
 * shown here; a bound command no subject names goes under *Other*, and the
 * fixed cards follow.
 *
 * `UiHelpModal` puts `UiHelp` and `UiCheatsheet` in a large modal window;
 * this feature is their model. The search box narrows the cards to the rows
 * whose words or keys match, a card whose title matches kept whole.
 */
export class UiHelpFeature {
  readonly tabs: readonly UiHelpTab[];
  private readonly tab = signal('cheatsheet');
  private readonly search = signal('');
  private readonly opened = signal(false);

  constructor(protected readonly parent: UiWorkbenchService) {
    this.tabs = parent.config.help?.tabs ?? TABS;
    this.tab.set(this.tabs[0]?.id ?? 'cheatsheet');
  }

  readonly activeTab = this.tab.asReadonly();
  readonly query = this.search.asReadonly();
  readonly isOpen = this.opened.asReadonly();

  /** Opens the window at `tab` — or, when it is open, turns to it. */
  open(tab: string = this.tabs[0]?.id ?? 'cheatsheet'): void {
    this.selectTab(tab);
    if (this.opened()) {
      return;
    }
    this.opened.set(true);
    void this.parent.modal.open(UiHelpModal, { label: 'Help', size: 'large', inputs: { help: this } }).then(() => {
      this.opened.set(false);
      this.search.set('');
    });
  }

  selectTab(tab: string): void {
    if (this.tabs.some((candidate) => candidate.id === tab)) {
      this.tab.set(tab);
    }
  }

  setQuery(text: string): void {
    this.search.set(text);
  }

  /** Every card, from the key table in force (§16.1). */
  readonly sections = computed<readonly UiCheatsheetSection[]>(() => {
    const help = this.parent.config.help;
    const keys = this.parent.keybindingsFt;
    const bindings = keys.bindings();
    const where = help?.where ?? WHERE;
    const onCard = new Set(help?.keyCard?.keys ?? []);
    const isCardKey = (key: string, when: UiKeyContext): boolean => when === 'window' && onCard.has(key);

    const rowsOf = (command: string): UiCheatsheetRow[] => {
      const byContext = new Map<UiKeyContext, string[]>();
      for (const binding of bindings) {
        if (binding.command === command && !isCardKey(binding.key, binding.when)) {
          byContext.set(binding.when, [...(byContext.get(binding.when) ?? []), binding.key]);
        }
      }
      const { label } = keys.describe(command);
      return [...byContext].map(([when, chords]) => ({
        id: `${command}|${when}`,
        keys: chords.map(keycaps),
        label,
        ...(where[when] ? { where: where[when] } : {}),
      }));
    };

    const card = help?.keyCard;
    const keyCard: readonly UiCheatsheetSection[] =
      card === undefined
        ? []
        : [
            {
              id: card.id,
              title: card.title,
              hue: card.hue,
              ...(card.note === undefined ? {} : { note: card.note }),
              rows: card.keys.flatMap((key): UiCheatsheetRow[] => {
                const command = keys.windowCommandOf(key);
                return command === null ? [] : [{ id: key, keys: [[key]], label: keys.describe(command).label }];
              }),
            },
          ];

    const subjects = help?.subjects ?? [];
    const named = new Set(subjects.flatMap((subject) => subject.commands));
    const configurable = subjects.map((subject): UiCheatsheetSection => ({ id: subject.id, title: subject.title, hue: subject.hue, rows: subject.commands.flatMap(rowsOf) }));
    const others = [...new Set(bindings.map((binding) => binding.command))].filter((command) => !named.has(command)).flatMap(rowsOf);
    const other: UiCheatsheetSection = { id: 'other', title: 'Other', hue: 'yellow', rows: others };

    const fixed = (help?.fixed ?? []).map(
      (section): UiCheatsheetSection => ({
        id: section.id,
        title: section.title,
        hue: section.hue,
        note: 'Fixed — not configurable.',
        rows: section.rows.map(([chords, label], index) => ({ id: `${section.id}-${index}`, keys: chords, label })),
      }),
    );

    // The first subject's card, then the key card, then the rest.
    const [first, ...rest] = configurable;
    return [...(first ? [first] : []), ...keyCard, ...rest, other, ...fixed].filter((section) => section.rows.length > 0);
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
      const rows = section.rows.filter((row) => matches(`${row.label} ${row.where ?? ''} ${row.keys.map((chord) => chord.join('+')).join(' ')}`.toLowerCase()));
      return rows.length === 0 ? [] : [{ ...section, rows }];
    });
  });
}
