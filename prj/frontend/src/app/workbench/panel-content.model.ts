import type { UiPanelContentDriver } from '@tr-file/ui';
import type { PanelGroupState, PanelTabState } from './panel-group.model';

/**
 * What the groups need from the feature behind a kind of panel content — the
 * library's `UiPanelContentDriver`, over tr-file's tabs and groups.
 * `WorkbenchService` registers one per content type of `trFileWorkbenchConfig`.
 */
export type PanelContentFeature = Required<Pick<UiPanelContentDriver<PanelTabState, PanelGroupState>, 'load' | 'isLoading' | 'acceptsFiles'>>;
