import { Component, inject } from '@angular/core';
import { UiProcessList } from '@tr-file/file-ui';
import { WorkbenchService } from '../../workbench.service';

/**
 * The Task Manager sub-application (PRD 014): the backend machine's
 * processes, as Windows 10's Task Manager shows them on its *Processes* tab.
 * Render-only; `TaskManagerFeature` asks for the processes and builds the list.
 */
@Component({
  selector: 'app-task-manager-app',
  imports: [UiProcessList],
  template: `
    @let tm = workbench.taskManagerFt;
    <ui-process-list
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
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    :host(.is-inactive) {
      display: none;
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
}
