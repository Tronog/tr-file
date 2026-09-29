import { computed } from '@angular/core';
import type { UiFunctionKey } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** The strip's word for a command — Midnight Commander's, where it fits what the command does here. */
const SHORT_LABELS: Readonly<Record<string, (parent: WorkbenchService) => string>> = {
  'view.commandPalette': () => 'Commands',
  'help.show': () => 'Help',
  'file.rename': () => 'Rename',
  'file.open': () => 'View',
  'file.openExternal': (p) => (p.fileSystem.systemFt.opensInApps ? 'Edit' : 'Open'),
  'file.copyTo': () => 'Copy',
  'file.moveTo': () => 'Move',
  'file.newFolder': () => 'MkDir',
  'file.trash': () => 'Delete',
  'view.mainMenu': () => 'Menu',
  'file.quit': () => 'Quit',
};

/** The keys the strip shows, in order. */
const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] as const;

/**
 * Midnight Commander's function keys (PRD 004, §2): the strip in the middle
 * of the status bar that shows what `F1`–`F10` do and runs them on a click.
 *
 * The keys themselves are window bindings of `KeybindingsFeature`, which runs
 * them — so the strip shows whatever they are bound to now, and follows the
 * user's changes on the Keyboard Shortcuts page (PRD 010, §2). By default
 * they follow Midnight Commander wherever the app has the same verb:
 *
 * | Key | Here | Midnight Commander |
 * | --- | --- | --- |
 * | `F1` | help — the cheatsheet (PRD 001, §16) | Help |
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
 * Commander's key for it. A key bound to nothing, or to something that can
 * never run here (Quit in a browser), is left off the strip.
 */
export class FunctionKeysFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** The strip: every bound key, dimmed where it has nothing to act on — or hidden, by the setting (PRD 010, §1). */
  readonly strip = computed<readonly UiFunctionKey[]>(() => {
    if (!this.parent.preferencesFt.value('workbench.functionKeyBar')) {
      return [];
    }
    const keys = this.parent.keybindingsFt;
    return FUNCTION_KEYS.flatMap((key): UiFunctionKey[] => {
      const id = keys.windowCommandOf(key);
      const command = id === null ? undefined : this.parent.commandsFt.command(id);
      if (id === null || command === undefined || (id === 'file.quit' && !this.parent.desktopWindow.isAvailable)) {
        return [];
      }
      const target = keys.targetOf(id);
      const label = SHORT_LABELS[id]?.(this.parent) ?? keys.describe(id).label;
      return [
        {
          id: key,
          key: key.slice(1),
          label,
          title: `${command.label(target)} (${key})`,
          ...(command.enabled(target) ? {} : { disabled: true }),
        },
      ];
    });
  });

  /** A key clicked in the strip: what it is bound to, as if it were pressed. */
  run(key: string): void {
    const command = this.parent.keybindingsFt.windowCommandOf(key);
    if (command !== null) {
      this.parent.keybindingsFt.run(command);
    }
  }
}
