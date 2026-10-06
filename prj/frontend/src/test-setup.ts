import { TestBed } from '@angular/core/testing';
import { provideTrFile } from './app/app.providers';
import { provideTrFileWorkbench } from './app/workbench/workbench.providers';

/**
 * Runs before every spec file. What the app remembers between sessions
 * (PRD 003, §6) lives in `localStorage` in a browser — and jsdom keeps one per
 * test run, so a layout one test saved would be restored by the next. Each
 * test starts with nothing remembered.
 *
 * And every spec's injector has what the app's have from the libraries: the
 * app's settings as their store (`provideTrFile`), and the workbench with the
 * file manager's components' keys (`provideTrFileWorkbench`) — so a spec that
 * renders one of them on its own gets the keys it has in the app. A spec's own `configureTestingModule` adds
 * to this rather than replacing it.
 */
beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideTrFile(), provideTrFileWorkbench()] });
});
