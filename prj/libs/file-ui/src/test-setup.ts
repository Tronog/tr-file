import { TestBed } from '@angular/core/testing';
import { provideFileUi } from './lib/keyboard/file-keybindings';

/**
 * Runs before every spec file: each test starts with nothing remembered, and
 * with the components' keys in its injector, as an application provides them
 * (`provideFileUi`). A spec's own `configureTestingModule` adds to this.
 */
beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideFileUi()] });
});
