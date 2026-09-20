import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Lazily loaded so the workbench and the UI library stay out of the
    // initial chunk once other screens exist.
    loadComponent: () => import('./workbench/workbench').then((m) => m.Workbench),
    title: 'tr-file',
  },
];
