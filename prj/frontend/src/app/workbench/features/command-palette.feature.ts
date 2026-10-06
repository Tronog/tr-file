import { UiCommandPaletteFeature, type UiInputStep, type UiPaletteCommand, type UiPaletteStep, type UiPickStep } from '@tr-file/ui';
import { isFolder } from '../../file-system/fs-entry-kind';
import { FsError } from '../../file-system/fs-error';
import { describeRemoteTarget, parseRemoteTarget, type RemoteTarget } from '../command-palette/remote-target';
import type { SavedServer } from './saved-servers.feature';
import type { WorkbenchService } from '../workbench.service';
import { isAbsoluteShown, shownPath } from '../../file-system/fs-path';

/** One command the palette offers. */
export type PaletteCommand = UiPaletteCommand;

/** A question a command asks in the palette's box — VS Code's input box. */
export type InputStep = UiInputStep;

/** A choice a command asks for — VS Code's quick pick. */
export type PickStep = UiPickStep;

export type Step = UiPaletteStep;

/** The pick list's row for a new server; saved servers are listed above it. */
const ADD_SERVER = 'remote.add';

/**
 * The command palette (PRD 009, §1) — the library's `UiCommandPaletteFeature`
 * — with the file manager's two commands that ask in the box itself: *Jump to
 * Folder…* first, *Connect to Remote Server…* last; the workbench's table
 * (`CommandsFeature`) between them.
 */
export class CommandPaletteFeature extends UiCommandPaletteFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  protected override leadingCommands(): readonly PaletteCommand[] {
    return [{ id: 'go.jumpToFolder', category: 'Go', label: 'Jump to Folder…', run: () => this.ask(this.jumpToFolder()) }];
  }

  protected override trailingCommands(): readonly PaletteCommand[] {
    return [{ id: 'remote.connect', category: 'Remote', label: 'Connect to Remote Server…', run: () => this.ask(this.connectToRemote()) }];
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
      value: current === undefined ? '/' : shownPath(current),
      validate: (value) => {
        const path = value.trim().replace(/\\/g, '/');
        if (!isAbsoluteShown(path)) {
          return "An absolute path starts with '/', or with a drive, like 'C:/'";
        }
        if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
          return "Leave out '.' and '..'; give the folder's own path";
        }
        return null;
      },
      accept: async (value) => {
        const typed = value.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/');
        const shown = shownPath(typed);
        let path: string;
        try {
          const details = await this.parent.fileSystem.readFt.details(typed);
          if (!isFolder(details)) {
            return `'${shown}' is a file, not a folder`;
          }
          // As the disk spells it (PRD 004, §4.1).
          path = details.path;
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
