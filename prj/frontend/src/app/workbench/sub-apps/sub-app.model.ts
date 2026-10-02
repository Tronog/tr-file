import type { UiIconName } from '@tr-file/ui';

/**
 * The sub-applications of the window (PRD 001, §1.1). The file manager is one
 * of them: they share the title bar with its menus, the activity bar and the
 * status bar, and each fills the rest — the two sidebars and the centre — with
 * its own content.
 */
export type SubAppId = 'file-manager' | 'search' | 'disk-usage';

export interface SubApp {
  readonly id: SubAppId;
  /** Its name: the activity bar's tooltip, and the palette's *View: Show …*. */
  readonly label: string;
  readonly icon: UiIconName;
}

/** In the activity bar's order, the file manager first. */
export const SUB_APPS: readonly SubApp[] = [
  { id: 'file-manager', label: 'File Manager', icon: 'copy' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'disk-usage', label: 'Disk Usage', icon: 'database' },
];

/** The sub-application a window starts with. */
export const DEFAULT_SUB_APP: SubAppId = 'file-manager';
