import { computed } from '@angular/core';
import type { UiFunctionKey } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';
import type { CommandTarget } from './commands.feature';

/**
 * What a function key acts on: the entry the active panel's cursor is on
 * (`cursor`) — rename, view, edit — or its selection, falling back to that
 * entry when nothing is picked (`selection`), as Midnight Commander's marked
 * files do; `window` keys act on no entry at all.
 */
type FunctionKeyScope = 'cursor' | 'selection' | 'window';

interface FunctionKeyBinding {
  /** `F5`, as `KeyboardEvent.key` names it. */
  readonly key: string;
  /** The strip's word for it — Midnight Commander's, where it fits what the key does here. */
  readonly label: () => string;
  /** The command of `CommandsFeature` the key runs. */
  readonly command: string;
  readonly scope: FunctionKeyScope;
  /** Whether the key exists here at all; `F10` quits a desktop window only. */
  readonly shown?: () => boolean;
}

/**
 * Midnight Commander's function keys (PRD 004, §2): `F1`–`F10`, bound for the
 * whole window, and the strip in the middle of the status bar that shows them
 * and runs them on a click.
 *
 * Each key is a command of the table (`CommandsFeature`), so it does exactly
 * what its menu entry does and is enabled by the same rule. What the keys
 * *mean* follows Midnight Commander wherever the app has the same verb:
 *
 * | Key | Here | Midnight Commander |
 * | --- | --- | --- |
 * | `F1` | the command palette | Help |
 * | `F2` | rename (VS Code's `F2`) | the user menu |
 * | `F3` | view — open read-only | View |
 * | `F4` | edit — the default app (a browser tab in a browser) | Edit |
 * | `F5` | copy, to the other panel's folder | Copy |
 * | `F6` | move, to the other panel's folder | RenMov |
 * | `F7` | new folder | Mkdir |
 * | `F8` | move to the trash, after asking | Delete |
 * | `F9` | the main menu | PullDn |
 * | `F10` | quit, after asking — desktop only | Quit |
 *
 * `F5` was Refresh; reading a folder again is `Ctrl`+`R` now, Midnight
 * Commander's key for it.
 *
 * The keys act on the *active* panel wherever focus is — in the explorer, in
 * a filter box — just as its menus do; a key pressed while a modal window or
 * the command palette is open is theirs. A bound key is always claimed, even
 * when it has nothing to act on, so a stray `F5` never reloads the page.
 */
export class FunctionKeysFeature {
  private readonly bindings: readonly FunctionKeyBinding[];

  constructor(private readonly parent: WorkbenchService) {
    const p = parent;
    this.bindings = [
      { key: 'F1', label: () => 'Commands', command: 'view.commandPalette', scope: 'window' },
      { key: 'F2', label: () => 'Rename', command: 'file.rename', scope: 'cursor' },
      { key: 'F3', label: () => 'View', command: 'file.open', scope: 'cursor' },
      { key: 'F4', label: () => (p.fileSystem.systemFt.opensInApps ? 'Edit' : 'Open'), command: 'file.openExternal', scope: 'cursor' },
      { key: 'F5', label: () => 'Copy', command: 'file.copyTo', scope: 'selection' },
      { key: 'F6', label: () => 'Move', command: 'file.moveTo', scope: 'selection' },
      { key: 'F7', label: () => 'MkDir', command: 'file.newFolder', scope: 'window' },
      { key: 'F8', label: () => 'Delete', command: 'file.trash', scope: 'selection' },
      { key: 'F9', label: () => 'Menu', command: 'view.mainMenu', scope: 'window' },
      { key: 'F10', label: () => 'Quit', command: 'file.quit', scope: 'window', shown: () => p.desktopWindow.isAvailable },
    ];
  }

  /** The strip: every key there is here, dimmed where it has nothing to act on. */
  readonly strip = computed<readonly UiFunctionKey[]>(() =>
    this.bindings
      .filter((binding) => binding.shown?.() ?? true)
      .map((binding) => {
        const command = this.parent.commandsFt.command(binding.command);
        const target = this.targetOf(binding);
        return {
          id: binding.key,
          key: binding.key.slice(1),
          label: binding.label(),
          title: `${command?.label(target) ?? binding.label()} (${binding.key})`,
          ...(command?.enabled(target) ? {} : { disabled: true }),
        };
      }),
  );

  /** A key pressed anywhere in the window; see the class comment for when it is taken. */
  handleShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    const binding = this.bindings.find((candidate) => candidate.key === event.key);
    if (binding === undefined || !(binding.shown?.() ?? true)) {
      return;
    }
    if (this.parent.modal.isOpen() || this.parent.commandPaletteFt.isOpen()) {
      return;
    }
    event.preventDefault();
    this.run(binding.key);
  }

  /** Runs a key — pressed, or clicked in the strip — if it applies. */
  run(key: string): void {
    const binding = this.bindings.find((candidate) => candidate.key === key);
    if (binding !== undefined) {
      this.parent.commandsFt.run(binding.command, this.targetOf(binding));
    }
  }

  private targetOf(binding: FunctionKeyBinding): CommandTarget {
    const commands = this.parent.commandsFt;
    const target = commands.activeTarget();
    if (binding.scope !== 'cursor') {
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
}
