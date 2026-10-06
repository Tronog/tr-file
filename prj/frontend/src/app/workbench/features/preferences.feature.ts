import { computed } from '@angular/core';
import { UiPreferencesFeature, uiPreferencesKey, type UiPreference } from '@tr-file/ui';
import { STORAGE_PREFIX } from '../../settings/settings.service';
import type { WorkbenchService } from '../workbench.service';

/** Where the preferences of their own are kept (PRD 010, §1) — for every backend alike. */
export const PREFERENCES_KEY = uiPreferencesKey(STORAGE_PREFIX);

/** One setting: a switch, a choice, or a thing to do. */
export type Preference = UiPreference;

/**
 * The settings of the settings window (PRD 010, §1) — the library's
 * `UiPreferencesFeature` over `PREFERENCES` (`workbench.config.ts`). Hidden
 * files are kept where they always were, the session's `showHidden`; turning
 * auto refresh off or on stops or starts it at once.
 */
export class PreferencesFeature extends UiPreferencesFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  protected override read(id: string): boolean | undefined {
    return id === 'files.showHidden' ? this.parent.showHidden() : undefined;
  }

  protected override write(id: string, value: boolean): boolean {
    if (id !== 'files.showHidden') {
      return false;
    }
    this.parent.showHidden.set(value);
    return true;
  }

  protected override applied(id: string, value: boolean): void {
    if (id === 'files.autoRefresh') {
      if (value) {
        this.parent.autoRefreshFt.start();
      } else {
        this.parent.autoRefreshFt.stop();
      }
    }
  }

  /** The edge each sidebar is at (PRD 010, §3) — each on its own: both may be on the same side. */
  readonly explorerSide = computed(() => this.sideOf('explorer'));
  readonly detailsSide = computed(() => this.sideOf('details'));

  /** Whether auto refresh is on — `WorkbenchService.start` asks before starting it. */
  readonly autoRefresh = computed(() => this.value('files.autoRefresh'));
}
