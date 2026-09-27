import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench/workbench.service';
import { MemorySettingsStore, SettingsService } from './settings.service';
import { ThemeService } from './theme.service';

/** PRD 010, §4 — the dark theme, as it was, and a light one, after VS Code's. */
describe('ThemeService', () => {
  let store: MemorySettingsStore;
  let systemLight: boolean;
  let listeners: ((event: MediaQueryListEvent) => void)[];

  const root = (): HTMLElement => document.documentElement;

  beforeEach(() => {
    store = new MemorySettingsStore();
    systemLight = false;
    listeners = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('light') ? systemLight : false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
      removeEventListener: () => undefined,
    }));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SettingsService, useValue: store }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete root().dataset['theme'];
  });

  it('is dark to start with: no theme attribute on the root', () => {
    const theme = TestBed.inject(ThemeService);

    expect(theme.theme()).toBe('dark');
    expect(root().dataset['theme']).toBeUndefined();
  });

  it('applies a stored light theme at once, before anything is drawn', () => {
    store.set('tr-file.preferences.v1', { 'workbench.colorTheme': 'light' });

    TestBed.inject(ThemeService);

    expect(root().dataset['theme']).toBe('light');
  });

  it('follows the system when asked to, and when the system changes its mind', () => {
    systemLight = true;
    store.set('tr-file.preferences.v1', { 'workbench.colorTheme': 'system' });
    const theme = TestBed.inject(ThemeService);
    expect(theme.theme()).toBe('light');

    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    TestBed.tick();

    expect(theme.theme()).toBe('dark');
    expect(root().dataset['theme']).toBeUndefined();
  });

  it('is chosen in the settings window, and remembered', () => {
    const workbench = TestBed.inject(WorkbenchService);
    const editor = workbench.settingsEditorFt;
    editor.open('appearance');
    const page = editor.model().page;
    const setting = (page.kind === 'settings' ? page.groups.flatMap((group) => group.settings) : []).find((candidate) => candidate.id === 'workbench.colorTheme');
    expect(setting?.control).toEqual({
      kind: 'select',
      value: 'dark',
      options: [
        { value: 'dark', label: 'Dark Modern' },
        { value: 'light', label: 'Light Modern' },
        { value: 'system', label: 'Follow the System' },
      ],
    });

    editor.changeSetting({ id: 'workbench.colorTheme', value: 'light' });
    TestBed.tick();

    expect(root().dataset['theme']).toBe('light');
    expect(store.get('tr-file.preferences.v1')).toEqual({ 'workbench.colorTheme': 'light' });

    workbench.preferencesFt.reset('workbench.colorTheme');
    TestBed.tick();
    expect(root().dataset['theme']).toBeUndefined();
  });
});
