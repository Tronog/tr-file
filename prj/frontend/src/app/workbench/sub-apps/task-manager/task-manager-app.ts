import { Component, inject } from '@angular/core';
import { UiPerformance, UiProcessList } from '@tr-file/file-ui';
import type { TaskManagerView } from '../../features/task-manager.feature';
import { WorkbenchService } from '../../workbench.service';

/**
 * The Task Manager sub-application (PRD 014): the backend machine's
 * processes, as Windows 10's Task Manager shows them — its tabs across the
 * top, *Processes* and *Graph* (§2.1, Task Manager's *Performance*), and the
 * one chosen below. Render-only; `TaskManagerFeature` asks for the processes
 * and the history and builds what both tabs draw.
 */
@Component({
  selector: 'app-task-manager-app',
  imports: [UiPerformance, UiProcessList],
  template: `
    @let tm = workbench.taskManagerFt;
    <div class="tabs" role="tablist" aria-label="Task Manager" (keydown)="onTabKeydown($event)">
      @for (tab of tabs; track tab.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="'task-manager-tab-' + tab.id"
          [attr.aria-selected]="tm.view() === tab.id"
          [attr.aria-controls]="'task-manager-panel-' + tab.id"
          [attr.tabindex]="tm.view() === tab.id ? 0 : -1"
          [class.is-active]="tm.view() === tab.id"
          (click)="tm.setView(tab.id)"
        >
          {{ tab.label }}
        </button>
      }
    </div>
    @if (tm.view() === 'processes') {
      <ui-process-list
        id="task-manager-panel-processes"
        role="tabpanel"
        aria-labelledby="task-manager-tab-processes"
        data-focus-region="task-manager"
        [model]="tm.model()"
        [focusToken]="tm.focusToken()"
        [filterFocus]="tm.filterFocus()"
        (select)="tm.select($event)"
        (toggle)="tm.toggle($event)"
        (sort)="tm.sort($event)"
        (filterChange)="tm.setFilter($event)"
        (pauseToggle)="tm.togglePause()"
        (endTask)="workbench.commandsFt.run('process.endTask')"
        (endTree)="workbench.commandsFt.run('process.endTree')"
        (refresh)="tm.refresh()"
        (contextMenu)="tm.openMenu($event)"
      />
    } @else {
      <ui-performance
        id="task-manager-panel-graph"
        role="tabpanel"
        aria-labelledby="task-manager-tab-graph"
        data-focus-region="task-manager"
        [model]="tm.performance()"
        [focusToken]="tm.focusToken()"
        (resourceSelect)="tm.selectResource($event)"
        (spanChange)="tm.setSpan($event)"
        (viewChange)="tm.setCpuView($event)"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      background: var(--vsc-editor-bg);
    }

    :host(.is-inactive) {
      display: none;
    }

    .tabs {
      display: flex;
      flex: none;
      gap: 2px;
      padding: 0 8px;
      border-bottom: 1px solid var(--vsc-border);
    }

    .tab {
      padding: 6px 12px 5px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--vsc-fg-muted);
      font: inherit;
      cursor: pointer;

      &:hover {
        color: var(--vsc-fg);
      }

      &.is-active {
        border-bottom-color: var(--vsc-accent);
        color: var(--vsc-fg-bright);
      }

      &:focus-visible {
        outline: 1px solid var(--vsc-focus-border);
        outline-offset: -1px;
      }
    }
  `,
  host: {
    role: 'region',
    'aria-label': 'Task Manager',
    '[class.is-inactive]': '!workbench.subAppsFt.isActive("task-manager")',
  },
})
export class TaskManagerApp {
  protected readonly workbench = inject(WorkbenchService);

  protected readonly tabs: readonly { readonly id: TaskManagerView; readonly label: string }[] = [
    { id: 'processes', label: 'Processes' },
    { id: 'graph', label: 'Graph' },
  ];

  /** `←` / `→` between the tabs, as in any tab strip; the tab chosen is shown at once. */
  protected onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const at = this.tabs.findIndex((tab) => tab.id === this.workbench.taskManagerFt.view());
    const next = this.tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length];
    if (next !== undefined) {
      this.workbench.taskManagerFt.setView(next.id);
      (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#task-manager-tab-${next.id}`)?.focus();
    }
  }
}
