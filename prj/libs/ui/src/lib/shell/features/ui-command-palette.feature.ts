import { computed, signal } from '@angular/core';
import { chordParts, displayKey } from '../../keyboard/keymap';
import type { UiQuickInputMessage, UiQuickPickButtonEvent, UiQuickPickItem } from '../../models/quick-input.model';
import { fuzzyMatch } from '../../palette/fuzzy-match';
import type { UiWorkbenchService } from '../ui-workbench.service';

/** One command the palette offers. */
export interface UiPaletteCommand {
  readonly id: string;
  /** Shown before the label, as in VS Code: `Go: Jump to Folder…`. */
  readonly category: string;
  readonly label: string;
  readonly keys?: readonly string[];
  readonly run: () => void;
}

/**
 * A question a command asks in the palette's box — VS Code's input box.
 * `validate` answers as the value changes; `accept` does the work, and
 * answers with why it could not, or `null` when it is done.
 */
export interface UiInputStep {
  readonly kind: 'input';
  readonly label: string;
  readonly placeholder: string;
  /** What to type, shown under the field until there is something wrong with it. */
  readonly prompt: string;
  readonly value?: string;
  readonly validate: (value: string) => string | null;
  readonly accept: (value: string) => Promise<string | null>;
}

/**
 * A choice a command asks for — VS Code's quick pick: a list of its own,
 * filtered as the commands are, whose rows may carry buttons (edit, remove).
 * Either may move the palette on to another step, or close it.
 */
export interface UiPickStep {
  readonly kind: 'pick';
  readonly label: string;
  readonly placeholder: string;
  readonly items: () => readonly UiQuickPickItem[];
  /** May work asynchronously — connecting — and answer why it could not. */
  readonly accept: (itemId: string) => void | Promise<string | null>;
  readonly button: (event: UiQuickPickButtonEvent) => void;
}

export type UiPaletteStep = UiInputStep | UiPickStep;

/**
 * The command palette (PRD 009, §1), VS Code's: the window bindings of
 * `view.commandPalette` (PRD 010, §2) or the command centre in the title bar
 * open it; typing filters the commands, `Enter` runs one. A command that
 * needs something typed — a path, a name — turns the same box into an input
 * box (`UiInputStep`), or a list of its own (`UiPickStep`), and it closes once
 * the answer has been acted on.
 *
 * The commands are the workbench's table (`UiCommandsFeature`), which the
 * menus, the context menus and the keys read too (PRD 003, §4) — only those
 * that apply to the active panel are listed — and whatever rows of its own
 * the application adds before and after them (`leadingCommands`,
 * `trailingCommands`).
 */
export class UiCommandPaletteFeature {
  private readonly opened = signal(false);
  private readonly text = signal('');
  protected readonly active = signal<string | null>(null);
  private readonly asking = signal<UiPaletteStep | null>(null);
  private readonly problem = signal<string | null>(null);
  private readonly working = signal(false);

  readonly isOpen = this.opened.asReadonly();
  readonly query = this.text.asReadonly();
  readonly activeId = this.active.asReadonly();
  readonly busy = this.working.asReadonly();

  /**
   * What the palette lists: every command of the workbench's table
   * (PRD 003, §4–5) that applies — run on the active panel, the box closed
   * first so a command that asks in a modal window has the screen — between
   * the application's own rows.
   */
  get commands(): readonly UiPaletteCommand[] {
    const table = this.parent.commandsFt;
    const target = table.activeTarget();
    return [
      ...this.leadingCommands(),
      ...table
        .paletteCommands()
        .filter((command) => command.enabled(target))
        .map((command) => ({
          id: command.id,
          category: command.category,
          label: command.label(target),
          ...this.keysOf(command.id),
          run: () => this.closeAnd(async () => table.run(command.id, target)),
        })),
      ...this.trailingCommands(),
    ];
  }

  /** The application's rows before the table's. */
  protected leadingCommands(): readonly UiPaletteCommand[] {
    return [];
  }

  /** The application's rows after the table's. */
  protected trailingCommands(): readonly UiPaletteCommand[] {
    return [];
  }

  /** Whether the box shows a list — the commands, or a command's choices — rather than asking for a value. */
  readonly showList = computed(() => this.asking()?.kind !== 'input');

  readonly label = computed(() => this.asking()?.label ?? 'Command palette');

  readonly placeholder = computed(() => this.asking()?.placeholder ?? 'Type the name of a command to run');

  /**
   * What the list shows, filtered by what was typed, best first, with the
   * matches highlighted: the commands, or the choices of the command asking.
   */
  readonly items = computed<readonly UiQuickPickItem[]>(() => {
    const step = this.asking();
    if (step?.kind === 'input') {
      return [];
    }
    const rows: readonly UiQuickPickItem[] =
      step?.kind === 'pick'
        ? step.items()
        : this.commands.map((command) => ({
            id: command.id,
            label: `${command.category}: ${command.label}`,
            ...(command.keys ? { keys: command.keys } : {}),
          }));
    const query = this.text();
    return rows
      .map((row, order) => ({ row, order, match: fuzzyMatch(query, row.label) }))
      .filter((entry) => entry.match !== null)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || a.order - b.order)
      .map(({ row, match }) => (match && match.ranges.length > 0 ? { ...row, highlights: match.ranges } : row));
  });

  /** A problem with the value, or — in an input box — what to type. */
  readonly message = computed<UiQuickInputMessage | null>(() => {
    const problem = this.problem();
    if (problem !== null) {
      return { severity: 'error', text: problem };
    }
    const step = this.asking();
    return step?.kind === 'input' ? { severity: 'info', text: step.prompt } : null;
  });

  constructor(protected readonly parent: UiWorkbenchService) {}

  /** The keys a command is bound to now (PRD 010, §2), split for the palette's key caps. */
  private keysOf(id: string): { readonly keys?: readonly string[] } {
    const key = this.parent.keybindingsFt.keysFor(id)[0];
    return key === undefined ? {} : { keys: chordParts(key).map(displayKey) };
  }

  /** Opens the palette on the command list, whatever it was doing. */
  show(): void {
    this.asking.set(null);
    this.problem.set(null);
    this.working.set(false);
    this.text.set('');
    this.opened.set(true);
    this.active.set(this.items()[0]?.id ?? null);
  }

  /**
   * Opens the palette straight at one command — tr-file's Go menu's Remote
   * Computer… opens it at *Connect to Remote Server* (PRD 008, §1.3).
   */
  run(commandId: string): void {
    this.show();
    const command = this.commands.find((candidate) => candidate.id === commandId);
    if (command !== undefined) {
      this.active.set(command.id);
      command.run();
    }
  }

  /**
   * Opens the palette asking another feature's question — a pick list or an
   * input box — as tr-file's *Git: Checkout to…* does (PRD 011, §1).
   */
  prompt(step: UiPaletteStep): void {
    this.show();
    this.ask(step);
  }

  /** A command that asks its questions in a modal window rather than in the box: the box goes first. */
  private closeAnd(action: () => Promise<void>): void {
    this.close();
    void action();
  }

  close(): void {
    this.opened.set(false);
    this.asking.set(null);
    this.problem.set(null);
    this.working.set(false);
    this.text.set('');
  }

  setQuery(value: string): void {
    this.text.set(value);
    const step = this.asking();
    if (step?.kind === 'input') {
      this.problem.set(value === '' ? null : step.validate(value));
    } else {
      this.active.set(this.items()[0]?.id ?? null);
    }
  }

  /** A row's button, of a pick list's row. */
  itemButton(event: UiQuickPickButtonEvent): void {
    const step = this.asking();
    if (step?.kind === 'pick') {
      step.button(event);
    }
  }

  setActive(id: string): void {
    this.active.set(id);
  }

  /** `Enter`: run the active command, or act on the value typed. */
  async accept(): Promise<void> {
    const step = this.asking();
    if (step === null) {
      this.commands.find((command) => command.id === this.active())?.run();
      return;
    }
    if (step.kind === 'pick') {
      const id = this.active();
      if (id === null || this.working()) {
        return;
      }
      this.problem.set(null);
      const answer = step.accept(id);
      if (answer instanceof Promise) {
        this.working.set(true);
        try {
          const failed = await answer;
          if (failed !== null && this.asking() === step) {
            this.problem.set(failed);
          }
        } finally {
          this.working.set(false);
        }
      }
      return;
    }
    if (this.working()) {
      return;
    }

    const value = this.text();
    const invalid = step.validate(value);
    if (invalid !== null) {
      this.problem.set(invalid);
      return;
    }

    this.working.set(true);
    try {
      const failed = await step.accept(value);
      if (this.asking() !== step) {
        return; // closed, or reopened, while it worked
      }
      if (failed === null) {
        this.close();
      } else {
        this.problem.set(failed);
      }
    } finally {
      this.working.set(false);
    }
  }

  /** Turns the box into an input box, or a list of `step`'s own. */
  protected ask(step: UiPaletteStep): void {
    this.asking.set(step);
    this.problem.set(null);
    this.text.set(step.kind === 'input' ? (step.value ?? '') : '');
    this.active.set(step.kind === 'pick' ? (this.items()[0]?.id ?? null) : null);
  }
}
