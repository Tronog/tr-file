import { Component, inject } from '@angular/core';
import { UiEmptyState } from '@tr-file/ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The Search sub-application (PRD 001, §1.1) — to be built. Until it is, it
 * says so and points at the search the file manager already has: by name, in
 * its Explorer sidebar (PRD 003, §5).
 */
@Component({
  selector: 'app-search-app',
  imports: [UiEmptyState],
  template: `
    <ui-empty-state
      [state]="{
        icon: 'search',
        title: 'Search is not available yet',
        hint: 'The file manager searches by name in its Explorer sidebar:',
        keys: searchKeys(),
      }"
    />
  `,
  styleUrl: '../sub-app-placeholder.scss',
  host: {
    role: 'region',
    'aria-label': 'Search',
    '[class.is-inactive]': '!workbench.subAppsFt.isActive("search")',
  },
})
export class SearchApp {
  protected readonly workbench = inject(WorkbenchService);

  /** The key of the file manager's name search, as the user has it bound. */
  protected searchKeys(): readonly string[] {
    return this.workbench.keybindingsFt.label('edit.search')?.split('+') ?? [];
  }
}
