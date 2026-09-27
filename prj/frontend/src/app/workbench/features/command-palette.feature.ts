import { computed, signal } from '@angular/core';
import type { UiQuickInputMessage, UiQuickPickButtonEvent, UiQuickPickItem } from '@tr-file/ui';
import { isFolder } from '../../file-system/fs-entry-kind';
import { FsError } from '../../file-system/fs-error';
import { fuzzyMatch } from '../command-palette/fuzzy-match';
import { describeRemoteTarget, parseRemoteTarget, type RemoteTarget } from '../command-palette/remote-target';
import type { SavedServer } from './saved-servers.feature';
import type { WorkbenchService } from '../workbench.service';

/** One command the palette offers. */
export interface PaletteCommand {
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
export interface InputStep {
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
export interface PickStep {
  readonly kind: 'pick';
  readonly label: string;
  readonly placeholder: string;
  readonly items: () => readonly UiQuickPickItem[];
  /** May work asynchronously — connecting — and answer why it could not. */
  readonly accept: (itemId: string) => void | Promise<string | null>;
  readonly button: (event: UiQuickPickButtonEvent) => void;
}

export type Step = InputStep | PickStep;

/** The pick list's row for a new server; saved servers are listed above it. */
const ADD_SERVER = 'remote.add';

/**
 * The command palette (PRD 009, §1), VS Code's: `Ctrl`+`Shift`+`P`, `F1` or
 * the command centre in the title bar opens it; typing filters the commands,
 * `Enter` runs one. A command that needs something typed — a path, a server —
 * turns the same box into an input box, and it closes once the answer has
 * been acted on.
 *
 * Besides its own two, the commands are the workbench's table
 * (`CommandsFeature`), which the menus, the context menus and the keys read
 * too (PRD 003, §4); only those that apply to the active panel are listed.
 */
export class CommandPaletteFeature {
  private readonly opened = signal(false);
  private readonly text = signal('');
  private readonly active = signal<string | null>(null);
  private readonly asking = signal<Step | null>(null);
  private readonly problem = signal<string | null>(null);
  private readonly working = signal(false);

  readonly isOpen = this.opened.asReadonly();
  readonly query = this.text.asReadonly();
  readonly activeId = this.active.asReadonly();
  readonly busy = this.working.asReadonly();

  /**
   * What the palette lists: *Jump to Folder…* and *Connect to Remote
   * Server…*, which ask in the box itself, and every command of the
   * workbench's table (PRD 003, §4–5) — run on the active panel, the box
   * closed first so a command that asks in a modal window has the screen.
   */
  get commands(): readonly PaletteCommand[] {
    const table = this.parent.commandsFt;
    const target = table.activeTarget();
    return [
      { id: 'go.jumpToFolder', category: 'Go', label: 'Jump to Folder…', run: () => this.ask(this.jumpToFolder()) },
      ...table
        .paletteCommands()
        .filter((command) => command.enabled(target))
        .map((command) => ({
          id: command.id,
          category: command.category,
          label: command.label(target),
          ...(command.keybinding ? { keys: command.keybinding.split('+') } : {}),
          run: () => this.closeAnd(async () => table.run(command.id, target)),
        })),
      {
        id: 'remote.connect',
        category: 'Remote',
        label: 'Connect to Remote Server…',
        run: () => this.ask(this.connectToRemote()),
      },
    ];
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

  constructor(private readonly parent: WorkbenchService) {}

  /** The chords that open the palette, from anywhere in the workbench. */
  handleShortcut(event: KeyboardEvent): void {
    const command = event.ctrlKey || event.metaKey;
    const opens =
      event.key === 'F1' ||
      (command && event.shiftKey && event.key.toLowerCase() === 'p') ||
      (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p');
    if (opens && !this.parent.modal.isOpen()) {
      event.preventDefault();
      this.show();
    }
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
   * Opens the palette straight at one command — the Go menu's Remote
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
   * input box — as *Git: Checkout to…* does (PRD 011, §1).
   */
  prompt(step: Step): void {
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

  /** A row's button — edit or remove a saved server. */
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
  private ask(step: Step): void {
    this.asking.set(step);
    this.problem.set(null);
    this.text.set(step.kind === 'input' ? (step.value ?? '') : '');
    this.active.set(step.kind === 'pick' ? (this.items()[0]?.id ?? null) : null);
  }

  /* -- the commands -------------------------------------------------------- */

  /**
   * Asks for a folder by its absolute path — absolute within the workspace,
   * which is all the file-system API can reach — and shows it in the active
   * panel, checking first that it is one.
   */
  private jumpToFolder(): InputStep {
    const current = this.parent.editorGroupsFt.pathOf(this.parent.activeGroupId());
    return {
      kind: 'input',
      label: 'Jump to folder',
      placeholder: '/path/to/folder',
      prompt: "Enter an absolute path, e.g. /docs/prd. Press 'Enter' to go there or 'Escape' to cancel.",
      value: current === undefined ? '/' : `/${current}`,
      validate: (value) => {
        const path = value.trim().replace(/\\/g, '/');
        if (!path.startsWith('/')) {
          return "An absolute path starts with '/'";
        }
        if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
          return "Leave out '.' and '..'; give the folder's own path";
        }
        return null;
      },
      accept: async (value) => {
        const path = value.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/');
        const shown = `/${path}`;
        try {
          const details = await this.parent.fileSystem.readFt.details(path);
          if (!isFolder(details)) {
            return `'${shown}' is a file, not a folder`;
          }
        } catch (error) {
          const failure = FsError.from(error);
          return failure.code === 'NOT_FOUND' ? `There is no folder at '${shown}'` : failure.message;
        }

        const groupId = this.parent.activeGroupId();
        const label = path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path);
        this.parent.fileBrowserFt.openFolder(groupId, path, label);
        this.parent.panelFocusFt.focusBody(groupId);
        return null;
      },
    };
  }

  /**
   * The servers kept on this machine to pick from, and a row to add one — VS
   * Code's *Connect to Host…*. A saved row carries edit (`F2`) and remove
   * (`Shift`+`Delete`); the list stays open while it is edited.
   */
  private connectToRemote(): PickStep {
    const saved = this.parent.savedServersFt;
    return {
      kind: 'pick',
      label: 'Connect to remote server',
      placeholder: 'Select a saved server, or add a new one',
      items: () => [
        ...saved.servers().map((server) => ({
          id: server.id,
          icon: 'cloud' as const,
          label: describeRemoteTarget(server),
          ...(server.lastUsedAt === null ? {} : { description: 'recently used' }),
          buttons: [
            { id: 'edit', icon: 'pencil' as const, label: 'Edit server', shortcut: 'F2' },
            { id: 'remove', icon: 'trash' as const, label: 'Remove server', shortcut: 'Shift+Delete' },
          ],
        })),
        { id: ADD_SERVER, icon: 'plus' as const, label: 'Add New Remote Server…' },
      ],
      accept: (itemId) => {
        if (itemId === ADD_SERVER) {
          this.ask(this.addServer());
          return;
        }
        const server = saved.find(itemId);
        // No password was kept: a server that wants one shows its sign-in screen.
        return server === undefined ? Promise.resolve(null) : this.connectTo({ ...server, scheme: server.scheme ?? (server.port === 443 ? 'https' : 'http'), password: null }, server.id);
      },
      button: ({ itemId, buttonId }) => {
        const server = saved.find(itemId);
        if (server === undefined) {
          return;
        }
        if (buttonId === 'edit') {
          this.ask(this.editServer(server));
        } else if (buttonId === 'remove') {
          saved.remove(itemId);
          // Stay on the list, on the row that took its place.
          if (this.active() === itemId || !this.items().some((item) => item.id === this.active())) {
            this.active.set(this.items()[0]?.id ?? null);
          }
        }
      },
    };
  }

  /** Asks for a new server as `[user:password@]host:port`, connects, and keeps it once connected. */
  private addServer(): InputStep {
    return {
      kind: 'input',
      label: 'Add remote server',
      placeholder: '[user:password@]host:port',
      prompt: "Enter a server as [user:password@]ip:port or [user:password@]hostname:port. Press 'Enter' to connect or 'Escape' to cancel.",
      validate: CommandPaletteFeature.validateTarget,
      accept: async (value) => {
        const target = parseRemoteTarget(value);
        if (typeof target === 'string') {
          return target;
        }
        return this.connectTo(target, null);
      },
    };
  }

  /** Changes a saved server's address, then goes back to the list. */
  private editServer(server: SavedServer): InputStep {
    return {
      kind: 'input',
      label: 'Edit remote server',
      placeholder: '[user:password@]host:port',
      prompt: "Change the server's address, as [user@]host:port. Its password is asked for when connecting, never kept. Press 'Enter' to save or 'Escape' to cancel.",
      value: describeRemoteTarget(server),
      validate: CommandPaletteFeature.validateTarget,
      accept: async (value) => {
        const target = parseRemoteTarget(value);
        if (typeof target === 'string') {
          return target;
        }
        this.parent.savedServersFt.update(server.id, target);
        this.ask(this.connectToRemote());
        this.active.set(server.id);
        return null;
      },
    };
  }

  /**
   * Connects the window to a server (PRD 006, §1); on success keeps it in the
   * saved list — never with its password — and starts the window over against
   * it. Answers why not, when it could not, and the palette stays open to say so.
   */
  private async connectTo(target: RemoteTarget, savedId: string | null): Promise<string | null> {
    const failed = await this.parent.connection.connect({
      scheme: target.scheme,
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
    });
    if (failed !== null) {
      return failed;
    }
    if (savedId === null) {
      this.parent.savedServersFt.use(target);
    } else {
      this.parent.savedServersFt.touch(savedId);
    }
    this.close();
    this.parent.connection.reload();
    return null;
  }

  private static validateTarget(value: string): string | null {
    const target = parseRemoteTarget(value);
    return typeof target === 'string' ? target : null;
  }
}
