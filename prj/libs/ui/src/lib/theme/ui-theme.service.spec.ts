import { TestBed } from '@angular/core/testing';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX, UiMemorySettingsStore } from '../settings/ui-settings-store';
import { UiThemeService } from './ui-theme.service';

/** PRD 010, §4 — the dark theme, as it was, and a light one, after VS Code's. */
describe('UiThemeService', () => {
  let store: UiMemorySettingsStore;
  let systemLight: boolean;
  let listeners: ((event: MediaQueryListEvent) => void)[];

  const root = (): HTMLElement => document.documentElement;

  beforeEach(() => {
    store = new UiMemorySettingsStore();
    systemLight = false;
    listeners = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('light') ? systemLight : false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
      removeEventListener: () => undefined,
    }));
    TestBed.configureTestingModule({
      providers: [{ provide: UI_SETTINGS_STORE, useValue: store }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete root().dataset['theme'];
  });

  it('is dark to start with: no theme attribute on the root', () => {
    const theme = TestBed.inject(UiThemeService);

    expect(theme.theme()).toBe('dark');
    expect(root().dataset['theme']).toBeUndefined();
  });

  it('reads the choice under the application\'s prefix', () => {
    store.set('app.preferences.v1', { 'workbench.colorTheme': 'light' });
    TestBed.overrideProvider(UI_STORAGE_PREFIX, { useValue: 'app' });

    expect(TestBed.inject(UiThemeService).theme()).toBe('light');
  });

  it('applies a stored light theme at once, before anything is drawn', () => {
    store.set('ui.preferences.v1', { 'workbench.colorTheme': 'light' });

    TestBed.inject(UiThemeService);

    expect(root().dataset['theme']).toBe('light');
  });

  it('follows the system when asked to, and when the system changes its mind', () => {
    systemLight = true;
    store.set('ui.preferences.v1', { 'workbench.colorTheme': 'system' });
    const theme = TestBed.inject(UiThemeService);
    expect(theme.theme()).toBe('light');

    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    TestBed.tick();

    expect(theme.theme()).toBe('dark');
    expect(root().dataset['theme']).toBeUndefined();
  });
});
