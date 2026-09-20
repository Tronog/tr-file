import type { UiPanelKey } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * What a panel's keyboard does (PRD 001, Section 6.2).
 *
 * The split is deliberate. `UiFileList` and `UiIconView` own everything that
 * is only about *where focus is* — the arrows, `Home`/`End`, the page keys and
 * type-to-find — because a roving tabindex can only be rolled where the
 * elements live, and because nothing outside the panel cares which row a
 * keyboard user is standing on. Every key that changes what the workbench
 * *shows* arrives here instead, as a `UiPanelKey`, so the binding table below
 * is the whole answer to "what does this key do in a panel".
 *
 * That also keeps the bindings honest about their reach: `open` and `select`
 * are the same operations a double click and a click perform, `up` is the
 * toolbar's Up button, and `F5` is its Refresh — a keyboard user gets at the
 * panel's existing verbs rather than a parallel set of their own.
 */
export class PanelKeyboardFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /**
   * Runs one key of a panel body against the group it was pressed in.
   *
   * A command that needs an entry and has none is dropped rather than guessed
   * at: an empty listing can still be left or reloaded, but there is nothing
   * in it to open.
   */
  run(groupId: string, key: UiPanelKey): void {
    const groups = this.parent.editorGroupsFt;

    switch (key.command) {
      case 'open':
        if (key.entryId !== null) {
          groups.openEntry(groupId, key.entryId);
        }
        break;

      case 'select':
        if (key.entryId !== null) {
          groups.selectEntry(groupId, key.entryId);
        }
        break;

      case 'up':
        groups.navigateUp(groupId);
        break;

      case 'refresh':
        groups.runToolbarAction(groupId, 'refresh');
        break;
    }
  }
}
