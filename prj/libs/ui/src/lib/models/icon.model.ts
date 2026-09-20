/**
 * Every icon the workbench can draw. The names match the `<symbol>` ids emitted
 * by `UiIconSprite`; `UiIcon` refuses anything outside this union at compile
 * time, so a typo cannot reach the DOM as an empty box.
 */
export type UiIconName =
  | 'chevron-right'
  | 'chevron-down'
  | 'chevrons-up'
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
  | 'sync'
  | 'database'
  | 'menu'
  | 'minus'
  | 'play'
  | 'window-min'
  | 'window-max';

/** Icon sizes used across the workbench (16px is VS Code's list/tab size). */
export type UiIconSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * A colour token name from `_tokens.scss` (without the `--vsc-ic-` prefix) used
 * to tint a file-type icon.
 */
export type UiIconTint = 'folder' | 'ts' | 'html' | 'css' | 'json' | 'md' | 'img' | 'yaml' | 'generic';

/** A clickable icon in a toolbar, pane header or tab bar. */
export interface UiIconAction {
  readonly id: string;
  /** Accessible name — also used as the tooltip. */
  readonly label: string;
  readonly icon: UiIconName;
  readonly active?: boolean;
  readonly disabled?: boolean;
}
