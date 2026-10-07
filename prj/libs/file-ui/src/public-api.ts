/**
 * @tr-file/file-ui — the file manager's components, built on `@tr-file/ui`.
 *
 * Presentational like the rest: a file browser and its listings (list, grid,
 * tree), disk usage, a git pane, transfers, a permission grid — and Task
 * Manager's list of processes (PRD 014). They know
 * what a folder, an entry and a path are — which is why they are not in the
 * generic library — but nothing about where files come from: no service, no
 * HTTP. Add `provideFileUi()` to the providers.
 */

/* view models ------------------------------------------------------------- */
export * from './lib/models';

/* keys -------------------------------------------------------------------- */
export { FILE_UI_DEFAULT_KEYBINDINGS, provideFileUi } from './lib/keyboard/file-keybindings';
export { isBoundAbove, isPanelCharacter, LIST_COMMANDS, LIST_PANEL_KEYS, listCommandFor, listKeyShortcuts } from './lib/keyboard/list-keys';
export type { UiListCommand } from './lib/keyboard/list-keys';

/* panel content ----------------------------------------------------------- */
export { UiFileBrowser } from './lib/file-browser/ui-file-browser';
export { UiFileList } from './lib/file-list/ui-file-list';
export { UiIconView } from './lib/icon-view/ui-icon-view';
export { UiDiskUsage } from './lib/disk-usage/ui-disk-usage';
export { DISK_USAGE_HUES, sunburst, squarify, tableRows, treemap } from './lib/disk-usage/disk-usage-layout';
export type { DiskUsageCell, DiskUsageHue, DiskUsageRow, DiskUsageSlice } from './lib/disk-usage/disk-usage-layout';

export { UiProcessList } from './lib/process-list/ui-process-list';

/* details sidebar --------------------------------------------------------- */
export { UiPermissionGrid } from './lib/permission-grid/ui-permission-grid';
export { UiSourceControl } from './lib/source-control/ui-source-control';

/* bottom panel ------------------------------------------------------------ */
export { UiTransferList } from './lib/transfers/ui-transfer-list';
