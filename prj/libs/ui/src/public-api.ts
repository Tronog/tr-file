/**
 * @tr-file/ui — the workbench component library.
 *
 * A VS Code style shell built as small, purely presentational Angular
 * components: signal inputs in, outputs out, no service or HTTP dependency, no
 * zone.js. Application state (and, later, real backend data) lives in the app —
 * see `frontend/src/app/workbench`.
 */

/* view models ------------------------------------------------------------- */
export * from './lib/models';

/* icons ------------------------------------------------------------------- */
export { UiIcon } from './lib/icon/ui-icon';
export { UiIconSprite } from './lib/icon/ui-icon-sprite';

/* shell ------------------------------------------------------------------- */
export { UiWorkbench } from './lib/workbench/ui-workbench';
export { UiTitleBar } from './lib/title-bar/ui-title-bar';
export { UiActivityBar } from './lib/activity-bar/ui-activity-bar';
export { UiStatusBar } from './lib/status-bar/ui-status-bar';

/* sidebars ---------------------------------------------------------------- */
export { UiSidebar } from './lib/sidebar/ui-sidebar';
export { UiPane } from './lib/pane/ui-pane';
export { UiTree } from './lib/tree/ui-tree';

/* details sidebar widgets ------------------------------------------------- */
export { UiPreviewCard } from './lib/details/ui-preview-card';
export { UiPropertyList } from './lib/details/ui-property-list';
export { UiPermissionGrid } from './lib/details/ui-permission-grid';
export { UiChipList } from './lib/details/ui-chip-list';
export { UiActionList } from './lib/details/ui-action-list';

/* controls ---------------------------------------------------------------- */
export { UiIconButton } from './lib/controls/ui-icon-button';
export { UiSegmented } from './lib/controls/ui-segmented';
export type { UiSegmentedOption } from './lib/controls/ui-segmented';
export { UiSearchField } from './lib/controls/ui-search-field';
export { UiSash } from './lib/sash/ui-sash';
export { UiProgress } from './lib/progress/ui-progress';
export { UiEmptyState } from './lib/empty-state/ui-empty-state';
export { UiBreadcrumbs } from './lib/breadcrumbs/ui-breadcrumbs';
export { UiContextMenu } from './lib/context-menu/ui-context-menu';

/* editor area ------------------------------------------------------------- */
export { UiTabBar } from './lib/tabs/ui-tab-bar';
export { UiFileList } from './lib/file-list/ui-file-list';
export { UiIconView } from './lib/icon-view/ui-icon-view';
export { UiDocumentView } from './lib/document-view/ui-document-view';
export { UiImageView } from './lib/image-view/ui-image-view';
export { UiImageViewService } from './lib/image-view/ui-image-view.service';
export type { UiImagePoint, UiImageZoom } from './lib/image-view/ui-image-view.service';
export { UiPanelGroup } from './lib/panel-group/ui-panel-group';
export { UiPanelBody } from './lib/panel-group/ui-panel-body';
export { UiPanelToolbar } from './lib/panel-toolbar/ui-panel-toolbar';
export { UiPanelGrid } from './lib/panel-grid/ui-panel-grid';

/* panel content ----------------------------------------------------------- */
export { UiFileBrowser } from './lib/file-browser/ui-file-browser';

/* bottom panel ------------------------------------------------------------ */
export { UiBottomPanel } from './lib/bottom-panel/ui-bottom-panel';
export { UiTransferList } from './lib/transfers/ui-transfer-list';
