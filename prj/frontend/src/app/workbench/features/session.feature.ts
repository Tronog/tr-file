import { UiSessionFeature, uiRestoreSessionKey, uiSessionKey, type UiSessionSnapshot } from '@tr-file/ui';
import { STORAGE_PREFIX } from '../../settings/settings.service';
import { MockDataWorkbenchService } from '../mock-data/mock-data-workbench.service';
import type { PanelGroupState, PanelTabState } from '../panel-group.model';
import { trFileWorkbenchConfig } from '../workbench.config';
import type { WorkbenchService } from '../workbench.service';

/** Settings key of the last session's layout; the backend it was on is appended. */
export const SESSION_KEY = `${STORAGE_PREFIX}.session.v1`;

/** Whether a session is restored at all; on unless switched off in the Settings menu. */
export const RESTORE_SESSION_KEY = uiRestoreSessionKey(STORAGE_PREFIX);

/** Everything a session remembers (PRD 003, §6): the library's, and whether hidden files show. */
export type SessionSnapshot = UiSessionSnapshot<PanelGroupState>;

/**
 * The session, remembered (PRD 003, §6) — the library's `UiSessionFeature`:
 * the panel layout and every panel's tabs, folder, view and sort, the active
 * panel, the sidebars, their panes, the bottom panel — and here whether
 * hidden files show. Kept per backend: the folders of this computer are not a
 * remote server's.
 *
 * What a panel had selected, its history and its filter are not kept: they
 * are about what someone was doing, not where they were.
 */
export class SessionFeature extends UiSessionFeature<PanelTabState, PanelGroupState> {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /** The key this backend's session is kept under. */
  static keyFor(scope: string): string {
    return uiSessionKey(STORAGE_PREFIX, scope);
  }

  /** `value` as a snapshot of tr-file's workbench, or `null` when any part of it does not hold together. */
  static validate(value: unknown): SessionSnapshot | null {
    return UiSessionFeature.check(value, trFileWorkbenchConfig(new MockDataWorkbenchService()));
  }

  protected override extras(): Readonly<Record<string, unknown>> {
    return { selectedEntryId: '', showHidden: this.parent.showHidden() };
  }
}
