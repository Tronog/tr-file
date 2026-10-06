import { TestBed } from '@angular/core/testing';
import { provideTrFile } from './app/app.providers';

/**
 * Runs before every spec file. What the app remembers between sessions
 * (PRD 003, §6) lives in `localStorage` in a browser — and jsdom keeps one per
 * test run, so a layout one test saved would be restored by the next. Each
 * test starts with nothing remembered.
 *
 * And every spec's injector has what `app.config.ts` gives the app's from the
 * libraries (`provideTrFile`): the file manager's components' keys, so a spec
 * that renders one of them on its own gets the keys it has in the app, and the
 * app's settings as the libraries' store. A spec's own `configureTestingModule` adds
 * to this rather than replacing it.
 */
beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideTrFile()] });
});
