import { computed, signal } from '@angular/core';
import type { UiQuickInputMessage, UiQuickPickItem } from '@tr-file/ui';
import { isFolder } from '../../file-system/fs-entry-kind';
import { FsError } from '../../file-system/fs-error';
import { fuzzyMatch } from '../command-palette/fuzzy-match';
import { describeRemoteTarget, parseRemoteTarget } from '../command-palette/remote-target';
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
interface InputStep {
  readonly label: string;
  readonly placeholder: string;
  /** What to type, shown under the field until there is something wrong with it. */
  readonly prompt: string;
  readonly value?: string;
  readonly validate: (value: string) => string | null;
  readonly accept: (value: string) => Promise<string | null>;
}

/**
 * The command palette (PRD 009, §1), VS Code's: `Ctrl`+`Shift`+`P`, `F1` or
 * the command centre in the title bar opens it; typing filters the commands,
 * `Enter` runs one. A command that needs something typed — a path, a server —
 * turns the same box into an input box, and it closes once the answer has
 * been acted on.
 *
 * The commands are a list here for now; PRD 003 §4 asks for one command table
 * the menus, the palette and the shortcuts all read, and this is where it
 * will be read from.
 */
export class CommandPaletteFeature {
  private readonly opened = signal(false);
  private readonly text = signal('');
  private readonly active = signal<string | null>(null);
  private readonly asking = signal<InputStep | null>(null);
  private readonly problem = signal<string | null>(null);
  private readonly working = signal(false);

  readonly isOpen = this.opened.asReadonly();
  readonly query = this.text.asReadonly();
  readonly activeId = this.active.asReadonly();
  readonly busy = this.working.asReadonly();

  readonly commands: readonly PaletteCommand[] = [
    { id: 'go.jumpToFolder', category: 'Go', label: 'Jump to Folder…', run: () => this.ask(this.jumpToFolder()) },
    {
      id: 'remote.connect',
      category: 'Remote',
      label: 'Connect to Remote Server…',
      run: () => this.ask(this.connectToRemote()),
    },
  ];

  /** Whether the box is listing commands, rather than asking for a value. */
  readonly showList = computed(() => this.asking() === null);

  readonly label = computed(() => this.asking()?.label ?? 'Command palette');

  readonly placeholder = computed(() => this.asking()?.placeholder ?? 'Type the name of a command to run');

  /** The commands matching what was typed, best first, with the matches highlighted. */
  readonly items = computed<readonly UiQuickPickItem[]>(() => {
    if (this.asking() !== null) {
      return [];
    }
    const query = this.text();
    return this.commands
      .map((command, order) => {
        const label = `${command.category}: ${command.label}`;
        return { command, label, order, match: fuzzyMatch(query, label) };
      })
      .filter((entry) => entry.match !== null)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || a.order - b.order)
      .map(({ command, label, match }) => ({
        id: command.id,
        label,
        ...(command.keys ? { keys: command.keys } : {}),
        ...(match && match.ranges.length > 0 ? { highlights: match.ranges } : {}),
      }));
  });

  /** A problem with the value, or — in an input box — what to type. */
  readonly message = computed<UiQuickInputMessage | null>(() => {
    const problem = this.problem();
    if (problem !== null) {
      return { severity: 'error', text: problem };
    }
    const step = this.asking();
    return step === null ? null : { severity: 'info', text: step.prompt };
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
    if (step === null) {
      this.active.set(this.items()[0]?.id ?? null);
    } else {
      this.problem.set(value === '' ? null : step.validate(value));
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

  /** Turns the box into an input box for `step`. */
  private ask(step: InputStep): void {
    this.asking.set(step);
    this.problem.set(null);
    this.text.set(step.value ?? '');
    this.active.set(null);
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
        const label = path === '' ? this.parent.mockWorkbench.workspaceName : (path.split('/').at(-1) ?? path);
        this.parent.fileBrowserFt.openFolder(groupId, path, label);
        this.parent.panelFocusFt.focusBody(groupId);
        return null;
      },
    };
  }

  /**
   * Asks for a server as `[user:password@]host:port`. Connecting is PRD 006:
   * for now the address is checked and acknowledged, never kept, and the
   * password is never shown back.
   */
  private connectToRemote(): InputStep {
    return {
      label: 'Connect to remote server',
      placeholder: '[user:password@]host:port',
      prompt: "Enter a server as [user:password@]ip:port or [user:password@]hostname:port. Press 'Enter' to connect or 'Escape' to cancel.",
      validate: (value) => {
        const target = parseRemoteTarget(value);
        return typeof target === 'string' ? target : null;
      },
      accept: async (value) => {
        const target = parseRemoteTarget(value);
        if (typeof target === 'string') {
          return target;
        }
        this.close();
        await this.parent.modal.message({
          severity: 'info',
          message: 'Remote connections are not available yet',
          detail: `tr-file will connect to ${describeRemoteTarget(target)}${target.password === null ? '' : ' with the password given'} once remote servers are supported.`,
        });
        return null;
      },
    };
  }
}
