/**
 * @tr-file/ui — the workbench component library.
 *
 * A VS Code style shell built as small, purely presentational Angular
 * components: signal inputs in, outputs out, no HTTP dependency, no zone.js.
 * Nothing in it knows what the application is about — the file manager's own
 * components are `@tr-file/file-ui`.
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
export { UiChipList } from './lib/details/ui-chip-list';
export { UiActionList } from './lib/details/ui-action-list';

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
  UI_KEYBINDING_DEFAULTS,
  chordOf,
  chordParts,
  displayChord,
  displayKey,
  isChord,
} from './lib/keyboard/keymap';
export type { UiKeybinding, UiKeyContext } from './lib/keyboard/keymap';
/* lists: selection, keyboard navigation, type-to-find, virtual scrolling — for list components built on the library */
export { clickMode, moveMode, UiListSelection } from './lib/keyboard/list-selection';
export type { UiSelectMode } from './lib/keyboard/list-selection';
export { isTypeaheadKey, pageStep, UiTypeahead } from './lib/keyboard/list-navigation';
export { UiVirtualViewport, VIRTUAL_THRESHOLD, visibleRange } from './lib/virtual/ui-virtual-viewport';
export type { UiVirtualRange } from './lib/virtual/ui-virtual-viewport';
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
export { UiDocumentView } from './lib/document-view/ui-document-view';
export { UiImageView } from './lib/image-view/ui-image-view';
export { UiImageViewService } from './lib/image-view/ui-image-view.service';
export type { UiImagePoint, UiImageZoom } from './lib/image-view/ui-image-view.service';
export { UiPanelGroup, UI_LOADING_RAIL_DELAY_MS } from './lib/panel-group/ui-panel-group';
export { UiPanelBody } from './lib/panel-group/ui-panel-body';
export { UiPanelToolbar } from './lib/panel-toolbar/ui-panel-toolbar';
export { UiPanelGrid } from './lib/panel-grid/ui-panel-grid';
/* the layout of the panels, as data (PRD 001, §1) */
export { UiPanelLayout } from './lib/layout/ui-panel-layout';

/* settings (PRD 010) and themes (PRD 010, §4) ----------------------------- */
export { UI_SETTINGS_STORE, UI_STORAGE_PREFIX, UiLocalStorageSettingsStore, UiMemorySettingsStore, uiPreferencesKey } from './lib/settings/ui-settings-store';
export type { UiSettingsStore } from './lib/settings/ui-settings-store';
export { UiThemeService, UI_THEME_PREFERENCE } from './lib/theme/ui-theme.service';
export type { UiColorTheme } from './lib/theme/ui-theme.service';
export { UiSettingsEditor } from './lib/settings/ui-settings-editor';
export { UiKeybindingsTable } from './lib/settings/ui-keybindings-table';

/* quick input — the command palette's box (PRD 009, §1) ------------------ */
export { UiQuickInput } from './lib/quick-input/ui-quick-input';
export { fuzzyMatch } from './lib/palette/fuzzy-match';
export type { UiFuzzyMatch } from './lib/palette/fuzzy-match';

/* modal windows (PRD 002, §3) -------------------------------------------- */
export { UiModal } from './lib/modal/ui-modal';
export { UiDialog } from './lib/modal/ui-dialog';
export { UiProgressDialog } from './lib/modal/ui-progress-dialog';
export { UiModalService } from './lib/modal/ui-modal.service';
export { UiModalHost } from './lib/modal/ui-modal-host';
export { UI_MODAL_REF } from './lib/modal/ui-modal-ref';
export type { UiModalRef } from './lib/modal/ui-modal-ref';
export type {
  UiComponentModalOptions,
  UiConfirmOptions,
  UiDialogOptions,
  UiModalComponentEntry,
  UiModalDialogEntry,
  UiModalEntry,
  UiPromptOptions,
} from './lib/modal/ui-modal-options';

/* bottom panel ------------------------------------------------------------ */
export { UiBottomPanel } from './lib/bottom-panel/ui-bottom-panel';
export { UiNotes } from './lib/notes/ui-notes';
