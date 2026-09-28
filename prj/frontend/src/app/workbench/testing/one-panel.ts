import type { Provider } from '@angular/core';
import { MockDataWorkbenchService } from '../mock-data/mock-data-workbench.service';
import type { MockWorkbenchLayout } from '../mock-data/mock-data.model';

/**
 * The workbench starts with two panels (PRD 002, §1.3). Specs of the layout's
 * mechanics — splitting, closing, moving tabs, walking the panels — build the
 * layout they test from one panel instead, so each step's effect is the only
 * one in view.
 */
class OnePanelWorkbench extends MockDataWorkbenchService {
  override readonly layout: MockWorkbenchLayout = {
    ...new MockDataWorkbenchService().layout,
    grid: { kind: 'leaf', groupId: 'group-root', size: 1 },
    groups: [
      {
        id: 'group-root',
        path: '',
        view: 'list',
        selection: [],
        tabs: [{ id: 'tab-root', label: 'tr-file', path: '', kind: 'folder', active: true }],
      },
    ],
  };
}

/** Starts the workbench with one panel on the root; add to a spec's providers. */
export const provideOnePanel = (): Provider => ({ provide: MockDataWorkbenchService, useClass: OnePanelWorkbench });
