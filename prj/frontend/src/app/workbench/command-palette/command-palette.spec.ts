import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiQuickInput } from '@tr-file/ui';
import type { UiQuickPickItem } from '@tr-file/ui';
import {
  detailsUrl,
  fsDetails,
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { fuzzyMatch } from './fuzzy-match';
import { describeRemoteTarget, parseRemoteTarget } from './remote-target';

/** PRD 009, §1 — the command palette. */

describe('fuzzyMatch', () => {
  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'Go: Jump to Folder…')).toEqual({ score: 0, ranges: [] });
  });

  it('matches a run of characters, case-insensitively, and says where', () => {
    expect(fuzzyMatch('FOLD', 'Go: Jump to Folder…')?.ranges).toEqual([[12, 16]]);
  });

  it('matches characters in order, preferring the starts of words', () => {
    expect(fuzzyMatch('jf', 'Go: Jump to Folder…')?.ranges).toEqual([
      [4, 5],
      [12, 13],
    ]);
  });

  it('needs every word of the query, in any order', () => {
    expect(fuzzyMatch('folder jump', 'Go: Jump to Folder…')).not.toBeNull();
    expect(fuzzyMatch('folder remote', 'Go: Jump to Folder…')).toBeNull();
  });

  it('ranks a run at a word start above scattered characters', () => {
    const run = fuzzyMatch('con', 'Remote: Connect to Remote Server…')?.score ?? 0;
    const scattered = fuzzyMatch('con', 'Go: Jump to Folder…');

    expect(scattered).toBeNull();
    expect(run).toBeGreaterThan(fuzzyMatch('cn', 'Remote: Connect to Remote Server…')?.score ?? 0);
  });
});

describe('parseRemoteTarget', () => {
  it('reads host:port, for an IP address and a host name', () => {
    expect(parseRemoteTarget('10.0.0.5:22')).toEqual({ user: null, password: null, host: '10.0.0.5', port: 22 });
    expect(parseRemoteTarget(' files.example.com:2222 ')).toEqual({
      user: null,
      password: null,
      host: 'files.example.com',
      port: 2222,
    });
  });

  it('reads user:password@ in front, a password may hold : and @', () => {
    expect(parseRemoteTarget('ana:p@ss:w0rd@nas.local:8022')).toEqual({
      user: 'ana',
      password: 'p@ss:w0rd',
      host: 'nas.local',
      port: 8022,
    });
  });

  it('reads an IPv6 address in brackets', () => {
    expect(parseRemoteTarget('[::1]:22')).toMatchObject({ host: '[::1]', port: 22 });
  });

  it('says what is wrong with anything else', () => {
    expect(parseRemoteTarget('')).toContain('[user:password@]host:port');
    expect(parseRemoteTarget('example.com')).toContain('Add the port');
    expect(parseRemoteTarget('example.com:0')).toContain('from 1 to 65535');
    expect(parseRemoteTarget('example.com:99999')).toContain('from 1 to 65535');
    expect(parseRemoteTarget('example.com:ssh')).toContain('not a port');
    expect(parseRemoteTarget('300.1.1.1:22')).toContain('not a host name or an IP address');
    expect(parseRemoteTarget('bad_host!:22')).toContain('not a host name');
    expect(parseRemoteTarget(':22')).toContain('Add a host');
    expect(parseRemoteTarget('ana@example.com:22')).toContain('user:password');
    expect(parseRemoteTarget(':secret@example.com:22')).toContain('user:password');
  });

  it('describes a target without its password', () => {
    const target = parseRemoteTarget('ana:secret@nas.local:22');

    expect(typeof target === 'string' ? target : describeRemoteTarget(target)).toBe('ana@nas.local:22');
  });
});

describe('UiQuickInput', () => {
  let fixture: ComponentFixture<UiQuickInput>;
  const events: string[] = [];
  const $ = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);
  const ITEMS: readonly UiQuickPickItem[] = [
    { id: 'a', label: 'Go: Jump to Folder…', highlights: [[4, 8]] },
    { id: 'b', label: 'Remote: Connect to Remote Server…', keys: ['Ctrl', 'K'] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiQuickInput] }).compileComponents();
    fixture = TestBed.createComponent(UiQuickInput);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('activeId', 'a');
    fixture.componentRef.setInput('label', 'Command palette');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    events.length = 0;
    const instance = fixture.componentInstance;
    instance.valueChange.subscribe((value) => events.push(`value:${value}`));
    instance.activeChange.subscribe((id) => events.push(`active:${id}`));
    instance.accept.subscribe(() => events.push('accept'));
    instance.dismiss.subscribe(() => events.push('dismiss'));
  });

  afterEach(() => fixture.nativeElement.remove());

  const key = (name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    $('input').dispatchEvent(event);
    return event;
  };

  it('is a combobox whose list is its popup, focused as it opens', () => {
    const field = $('input');

    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('role')).toBe('combobox');
    expect(document.getElementById(field.getAttribute('aria-controls') ?? '')?.getAttribute('role')).toBe('listbox');
    expect(document.getElementById(field.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('Jump to Folder');
  });

  it('highlights the matched characters and shows key chips', () => {
    expect($('.row .hl').textContent).toBe('Jump');
    expect(Array.from(fixture.nativeElement.querySelectorAll('kbd')).map((kbd) => (kbd as HTMLElement).textContent)).toEqual(['Ctrl', 'K']);
  });

  it('moves the active row with the arrows, wrapping, while focus stays in the field', () => {
    key('ArrowDown');
    key('ArrowUp');
    fixture.componentRef.setInput('activeId', 'b');
    fixture.detectChanges();
    key('ArrowDown');

    expect(events).toEqual(['active:b', 'active:b', 'active:a']);
    expect(document.activeElement).toBe($('input'));
  });

  it('reports typing, Enter and Escape', () => {
    const field = $('input') as HTMLInputElement;
    field.value = 'fold';
    field.dispatchEvent(new Event('input'));
    key('Enter');
    key('Escape');

    expect(events).toEqual(['value:fold', 'accept', 'dismiss']);
  });

  it('picks a row with a click', () => {
    (fixture.nativeElement.querySelectorAll('.row')[1] as HTMLElement).click();

    expect(events).toEqual(['active:b', 'accept']);
  });

  it('says so when nothing matches, and shows a message instead of a list when asking for a value', () => {
    fixture.componentRef.setInput('items', []);
    fixture.componentRef.setInput('emptyText', 'No matching commands');
    fixture.detectChanges();
    expect($('.empty').textContent).toBe('No matching commands');

    fixture.componentRef.setInput('showList', false);
    fixture.componentRef.setInput('message', { severity: 'error', text: 'Not a port' });
    fixture.detectChanges();
    expect($('.list')).toBeNull();
    expect($('.message-error').textContent).toBe('Not a port');
    expect($('input').getAttribute('aria-invalid')).toBe('true');
  });

  it('closes when focus leaves it', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    outside.remove();

    expect(events).toContain('dismiss');
  });
});

describe('CommandPaletteFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const palette = () => workbench.commandPaletteFt;
  const shortcut = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    palette().handleShortcut(event);
    return event;
  };

  const start = async (): Promise<void> => {
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsDirectory('docs'), fsEntry('README.md')])));
    await settled();
  };

  it('opens on Ctrl+Shift+P, F1 and Ctrl+P, listing every command', () => {
    expect(shortcut('P', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(palette().isOpen()).toBe(true);
    expect(palette().items().map((item) => item.label)).toEqual([
      'Go: Jump to Folder…',
      'Remote: Connect to Remote Server…',
    ]);
    expect(palette().activeId()).toBe('go.jumpToFolder');

    palette().close();
    shortcut('F1');
    expect(palette().isOpen()).toBe(true);

    palette().close();
    shortcut('p', { ctrlKey: true });
    expect(palette().isOpen()).toBe(true);
  });

  it('stays shut while a modal window is open', () => {
    void workbench.modal.message({ message: 'Busy' });

    expect(shortcut('F1').defaultPrevented).toBe(false);
    expect(palette().isOpen()).toBe(false);
  });

  it('filters as you type, best match first and active', () => {
    palette().show();

    palette().setQuery('remote');

    expect(palette().items().map((item) => item.id)).toEqual(['remote.connect']);
    expect(palette().activeId()).toBe('remote.connect');
    expect(palette().items()[0]?.highlights).toEqual([[0, 6]]);

    palette().setQuery('xyz');
    expect(palette().items()).toEqual([]);
    expect(palette().activeId()).toBeNull();
  });

  describe('Jump to Folder', () => {
    const jump = async (): Promise<void> => {
      palette().show();
      palette().setActive('go.jumpToFolder');
      await palette().accept();
    };

    it('asks for an absolute path, starting from where the panel is', async () => {
      await start();
      await jump();

      expect(palette().showList()).toBe(false);
      expect(palette().query()).toBe('/');
      expect(palette().message()).toMatchObject({ severity: 'info' });
      expect(palette().message()?.text).toContain('absolute path');
    });

    it('refuses a relative path, and . or ..', async () => {
      await start();
      await jump();

      palette().setQuery('docs');
      expect(palette().message()).toEqual({ severity: 'error', text: "An absolute path starts with '/'" });

      palette().setQuery('/docs/../etc');
      expect(palette().message()?.text).toContain("'..'");

      await palette().accept();
      http.expectNone(() => true);
      expect(palette().isOpen()).toBe(true);
    });

    it('checks the folder is there, shows it in the active panel and closes', async () => {
      await start();
      await jump();
      palette().setQuery('/docs/prd/');

      const accepted = palette().accept();
      expect(palette().busy()).toBe(true);
      http.expectOne(detailsUrl('docs/prd')).flush(fsEnvelope(fsDetails('docs/prd', { type: 'directory' })));
      await accepted;
      http.expectOne(listUrl('docs/prd')).flush(fsEnvelope(fsListing('docs/prd', [])));
      await settled();

      expect(palette().isOpen()).toBe(false);
      expect(workbench.editorGroupsFt.pathOf(workbench.activeGroupId())).toBe('docs/prd');
      expect(workbench.editorGroupsFt.group(workbench.activeGroupId())?.tabs[0]).toMatchObject({ label: 'prd' });
    });

    it('stays open and says why when there is no such folder, or it is a file', async () => {
      await start();
      await jump();

      palette().setQuery('/nowhere');
      const missing = palette().accept();
      http
        .expectOne(detailsUrl('nowhere'))
        .flush(fsErrorBody('NOT_FOUND', 'Path not found: nowhere'), { status: 404, statusText: 'Not Found' });
      await missing;
      expect(palette().isOpen()).toBe(true);
      expect(palette().message()).toEqual({ severity: 'error', text: "There is no folder at '/nowhere'" });

      palette().setQuery('/README.md');
      const file = palette().accept();
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await file;
      expect(palette().message()?.text).toBe("'/README.md' is a file, not a folder");
    });

    it('goes to the root for /', async () => {
      await start();
      await jump();
      palette().setQuery('/');

      const accepted = palette().accept();
      http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDetails('', { type: 'directory' })));
      await accepted;

      expect(palette().isOpen()).toBe(false);
      expect(workbench.editorGroupsFt.pathOf(workbench.activeGroupId())).toBe('');
    });
  });

  describe('Connect to Remote Server', () => {
    const connect = async (): Promise<void> => {
      palette().show();
      palette().setActive('remote.connect');
      await palette().accept();
    };

    it('asks for [user:password@]host:port, checking it as it is typed', async () => {
      await connect();

      expect(palette().placeholder()).toBe('[user:password@]host:port');
      palette().setQuery('nas.local');
      expect(palette().message()?.text).toContain('Add the port');
      palette().setQuery('nas.local:22');
      expect(palette().message()).toMatchObject({ severity: 'info' });
    });

    it('acknowledges a good address — without its password — since connecting comes later', async () => {
      await connect();
      palette().setQuery('ana:secret@nas.local:22');

      const accepted = palette().accept();
      await settled();

      expect(palette().isOpen()).toBe(false);
      const dialog = workbench.modal.stack().at(-1);
      expect(dialog?.kind === 'dialog' && dialog.model()).toMatchObject({
        message: 'Remote connections are not available yet',
      });
      const detail = dialog?.kind === 'dialog' ? (dialog.model().detail ?? '') : '';
      expect(detail).toContain('ana@nas.local:22');
      expect(detail).not.toContain('secret');

      workbench.modal.dismiss(dialog?.id ?? -1);
      await accepted;
    });
  });
});
