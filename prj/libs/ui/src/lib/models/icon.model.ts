/**
 * Every icon the workbench can draw. The names match the `<symbol>` ids emitted
 * by `UiIconSprite`; `UiIcon` refuses anything outside this union at compile
 * time, so a typo cannot reach the DOM as an empty box.
 */
export type UiIconName =
  | 'chevron-right'
  | 'chevron-down'
  | 'chevrons-up'
  | 'chevrons-down'
  | 'folder'
  | 'folder-open'
  | 'folder-plus'
  | 'file'
  | 'file-plus'
  | 'search'
  | 'x'
  | 'plus'
  | 'check'
  | 'dots'
  | 'git-branch'
  | 'git-commit'
  | 'arrow-back-up'
  | 'layout-grid'
  | 'settings'
  | 'user'
  | 'columns'
  | 'rows'
  | 'sidebar-left'
  | 'sidebar-right'
  | 'panel-bottom'
  | 'maximize'
  | 'refresh'
  | 'sort'
  | 'filter'
  | 'list'
  | 'list-tree'
  | 'terminal'
  | 'bell'
  | 'alert-circle'
  | 'alert-triangle'
  | 'info'
  | 'lock'
  | 'clock'
  | 'trash'
  | 'copy'
  | 'cut'
  | 'pencil'
  | 'external'
  | 'eye'
  | 'cloud'
  | 'desktop'
  | 'download'
  | 'upload'
  | 'star'
  | 'arrow-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'sync'
  | 'database'
  | 'menu'
  | 'minus'
  | 'play'
  | 'window-min'
  | 'window-max'
  | 'window-restore'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-actual'
  | 'arrows-minimize'
  | 'arrows-maximize'
  | 'home'
  | 'device-hdd'
  | 'usb'
  | 'photo'
  | 'music'
  | 'movie'
  | 'file-text'
  | 'history'
  | 'archive'
  | 'network'
  | 'keyboard'
  | 'palette'
  | 'sun'
  | 'moon'
  | 'chart-pie'
  | 'chart-treemap'
  | 'table'
  | 'player-stop'
  | 'activity'
  | 'player-pause'
  | 'device-floppy'
  | 'braces'
  | 'arrow-down';

/** Icon sizes used across the workbench (16px is VS Code's list/tab size). */
export type UiIconSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * A colour token name from `_tokens.scss` (without the `--vsc-ic-` prefix) used
 * to tint a file-type icon.
 */
export type UiIconTint = 'folder' | 'ts' | 'html' | 'css' | 'json' | 'md' | 'img' | 'yaml' | 'generic';

/**
 * A pane header's button was pressed, and where it is on screen — its
 * bottom-left corner, in viewport pixels — for a menu to open beside it.
 */
export interface UiIconActionAt {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** A clickable icon in a toolbar, pane header or tab bar. */
export interface UiIconAction {
  readonly id: string;
  /** Accessible name — also used as the tooltip. */
  readonly label: string;
  readonly icon: UiIconName;
  readonly active?: boolean;
  readonly disabled?: boolean;
}
