import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { UI_STORAGE_PREFIX, provideUiWorkbench } from '@tr-file/ui';
import { DEMO_CONFIG } from './demo.config';
import { DemoWorkbenchService } from './demo-workbench.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Its own keys in `localStorage`, apart from any other app on the origin.
    { provide: UI_STORAGE_PREFIX, useValue: 'ui-demo' },
    provideUiWorkbench(DEMO_CONFIG, DemoWorkbenchService),
  ],
};
