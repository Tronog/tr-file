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
export { UiZoomMenu } from './lib/title-bar/ui-zoom-menu';
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
export { UiSourceControl } from './lib/source-control/ui-source-control';

/* controls ---------------------------------------------------------------- */
export { UiIconButton } from './lib/controls/ui-icon-button';
export { UiButton } from './lib/controls/ui-button';
export { UiSegmented } from './lib/controls/ui-segmented';
export type { UiSegmentedOption } from './lib/controls/ui-segmented';
export { UiSearchField } from './lib/controls/ui-search-field';

/* keyboard (PRD 010, §2) --------------------------------------------------- */
export {
  UiKeymap,
  UI_DEFAULT_KEYBINDINGS,
  chordOf,
  chordParts,
  displayChord,
  displayKey,
  isChord,
} from './lib/keyboard/keymap';
export type { UiKeybinding, UiKeyContext } from './lib/keyboard/keymap';
export { UiSash } from './lib/sash/ui-sash';
/* help (PRD 001, §16) */
export { UiHelp } from './lib/help/ui-help';
export { UiCheatsheet } from './lib/help/ui-cheatsheet';
export { UiProgress } from './lib/progress/ui-progress';
export { UiEmptyState } from './lib/empty-state/ui-empty-state';
export { UiBreadcrumbs } from './lib/breadcrumbs/ui-breadcrumbs';
export { UiContextMenu } from './lib/context-menu/ui-context-menu';
export type { UiMenuDismissReason } from './lib/context-menu/ui-context-menu';

/* editor area ------------------------------------------------------------- */
export { UiTabBar } from './lib/tabs/ui-tab-bar';
export { UiFileList } from './lib/file-list/ui-file-list';
export { UiIconView } from './lib/icon-view/ui-icon-view';
export { UiDocumentView } from './lib/document-view/ui-document-view';
export { UiImageView } from './lib/image-view/ui-image-view';
export { UiImageViewService } from './lib/image-view/ui-image-view.service';
export type { UiImagePoint, UiImageZoom } from './lib/image-view/ui-image-view.service';
export { UiPanelGroup, UI_LOADING_RAIL_DELAY_MS } from './lib/panel-group/ui-panel-group';
export { UiPanelBody } from './lib/panel-group/ui-panel-body';
export { UiPanelToolbar } from './lib/panel-toolbar/ui-panel-toolbar';
export { UiPanelGrid } from './lib/panel-grid/ui-panel-grid';

/* settings (PRD 010) ------------------------------------------------------ */
export { UiSettingsEditor } from './lib/settings/ui-settings-editor';
export { UiKeybindingsTable } from './lib/settings/ui-keybindings-table';

/* panel content ----------------------------------------------------------- */
export { UiFileBrowser } from './lib/file-browser/ui-file-browser';
export { UiDiskUsage } from './lib/disk-usage/ui-disk-usage';
export { DISK_USAGE_HUES, sunburst, squarify, tableRows, treemap } from './lib/disk-usage/disk-usage-layout';
export type { DiskUsageCell, DiskUsageHue, DiskUsageRow, DiskUsageSlice } from './lib/disk-usage/disk-usage-layout';

/* quick input — the command palette's box (PRD 009, §1) ------------------ */
export { UiQuickInput } from './lib/quick-input/ui-quick-input';

/* modal windows (PRD 002, §3) -------------------------------------------- */
export { UiModal } from './lib/modal/ui-modal';
export { UiDialog } from './lib/modal/ui-dialog';
export { UiProgressDialog } from './lib/modal/ui-progress-dialog';

/* bottom panel ------------------------------------------------------------ */
export { UiBottomPanel } from './lib/bottom-panel/ui-bottom-panel';
export { UiTransferList } from './lib/transfers/ui-transfer-list';
export { UiNotes } from './lib/notes/ui-notes';
