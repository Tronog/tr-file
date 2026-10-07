import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Lazily loaded so the workbench and the UI library stay out of the
    // initial chunk once other screens exist.
    loadChildren: () => import('./workbench/workbench.routes').then((m) => m.WORKBENCH_ROUTES),
    title: 'tr-file',
  },
];
