import type { Routes } from '@angular/router';
import { Workbench } from './workbench';
import { provideTrFileWorkbench } from './workbench.providers';

/** The workbench, with its providers — loaded with it, out of the initial chunk. */
export const WORKBENCH_ROUTES: Routes = [{ path: '', component: Workbench, providers: [provideTrFileWorkbench()] }];
