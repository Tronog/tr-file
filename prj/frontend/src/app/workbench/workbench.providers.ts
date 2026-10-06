import { type EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { provideFileUi } from '@tr-file/file-ui';
import { provideUiWorkbench } from '@tr-file/ui';
import { FileSystemService } from '../file-system/file-system.service';
import { RemoteConnectionService } from '../file-system/remote-connection.service';
import { MockDataWorkbenchService } from './mock-data/mock-data-workbench.service';
import { trFileWorkbenchConfig } from './workbench.config';
import { WorkbenchService } from './workbench.service';

/**
 * The workbench (PRD 001, §17.1): the file manager's components and their
 * keys, tr-file's configuration of the library's shell, and `WorkbenchService`
 * as the service that runs it. The workbench route's providers, and every
 * spec's (`test-setup.ts`).
 */
export function provideTrFileWorkbench(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFileUi(),
    provideUiWorkbench(() => {
      const connection = inject(RemoteConnectionService);
      return trFileWorkbenchConfig(inject(MockDataWorkbenchService), inject(FileSystemService).transport.systemShell, () => connection.label() ?? 'local');
    }, WorkbenchService),
  ]);
}
