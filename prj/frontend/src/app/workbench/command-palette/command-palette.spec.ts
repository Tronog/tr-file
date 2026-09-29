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
import { SAVED_SERVERS_KEY, SavedServersFeature } from '../features/saved-servers.feature';
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
    expect(parseRemoteTarget('10.0.0.5:22')).toEqual({ scheme: 'http', user: null, password: null, host: '10.0.0.5', port: 22 });
    expect(parseRemoteTarget(' files.example.com:2222 ')).toEqual({
      scheme: 'http',
      user: null,
      password: null,
      host: 'files.example.com',
      port: 2222,
    });
  });

  it('reads user:password@ in front, a password may hold : and @', () => {
    expect(parseRemoteTarget('ana:p@ss:w0rd@nas.local:8022')).toEqual({
      scheme: 'http',
      user: 'ana',
      password: 'p@ss:w0rd',
      host: 'nas.local',
      port: 8022,
    });
  });

  /** How a saved server, kept without its password, is written back for editing. */
  it('reads user@ without a password', () => {
    expect(parseRemoteTarget('ana@nas.local:22')).toEqual({ scheme: 'http', user: 'ana', password: null, host: 'nas.local', port: 22 });
  });

  it('reads https:// and http:// in front, and takes port 443 for HTTPS', () => {
    expect(parseRemoteTarget('https://files.example.com:8443')).toMatchObject({ scheme: 'https', port: 8443 });
    expect(parseRemoteTarget('http://files.example.com:443')).toMatchObject({ scheme: 'http' });
    expect(parseRemoteTarget('files.example.com:443')).toMatchObject({ scheme: 'https' });
    expect(parseRemoteTarget('ftp://files.example.com:21')).toContain('Only http:// and https://');
  });

  it('writes HTTPS back only where the port would not imply it', () => {
    const https = parseRemoteTarget('https://ana:pw@files.example.com:8443');
    expect(typeof https === 'string' ? https : describeRemoteTarget(https)).toBe('https://ana@files.example.com:8443');
    const implied = parseRemoteTarget('files.example.com:443');
    expect(typeof implied === 'string' ? implied : describeRemoteTarget(implied)).toBe('files.example.com:443');
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
    expect(parseRemoteTarget(':secret@example.com:22')).toContain('user:password');
    expect(parseRemoteTarget('ana:@example.com:22')).toContain('user:password');
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
    localStorage.removeItem(SAVED_SERVERS_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const palette = () => workbench.commandPaletteFt;
  const shortcut = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    workbench.keybindingsFt.handleShortcut(event);
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
    // Only what applies to the active panel — nothing is selected, so nothing to rename or trash.
    expect(palette().items().map((item) => item.label)).toEqual([
      'Go: Jump to Folder…',
      'File: New File…',
      'File: New Folder…',
      'File: Upload Files…',
      'File: Upload Folder…',
      'File: Copy Path',
      'File: Empty Trash…',
      'Edit: Filter Folder',
      'Edit: Search Files…',
      'Selection: Select All',
      'Selection: Invert Selection',
      'Selection: Select by Pattern…',
      'Selection: Unselect by Pattern…',
      'View: List',
      'View: Icons',
      'View: Tree',
      'View: Sort by Name',
      'View: Sort by Size',
      'View: Sort by Type',
      'View: Sort by Date Modified',
      'View: Descending',
      'View: Show Hidden Files',
      'View: Refresh',
      'View: Show Bookmarks',
      'View: Show Notes',
      'Preferences: Restore Layout on Start',
      'View: Reset Layout',
      'Preferences: Open Settings',
      'Preferences: Open Keyboard Shortcuts',
      'Go: Go to Location…',
      'Tab: New Tab',
      'View: Toggle Maximized Panel',
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
      expect(palette().message()).toEqual({ severity: 'error', text: "An absolute path starts with '/', or with a drive, like 'C:/'" });

      // A drive's path is absolute without a leading `/` (PRD 004, §1.4).
      palette().setQuery('C:/Windows');
      expect(palette().message()?.severity).not.toBe('error');

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
      // The explorer opens the folders above it, to reveal where the panel went (PRD 001, §9.1.2).
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [])));
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

  /**
   * PRD 009, §1 and PRD 006, §1 — servers are kept on this machine, to pick,
   * edit and remove; picking or adding one connects the desktop window to it.
   */
  describe('Connect to Remote Server', () => {
    /** Stands in for the desktop preload, answering the connection commands. */
    let sent: Record<string, unknown>[];
    let answer: (request: Record<string, unknown>) => unknown;
    let reloads: number;

    beforeEach(() => {
      sent = [];
      reloads = 0;
      answer = (request) => ({
        data: { connected: true, scheme: request['scheme'], host: request['host'], port: request['port'], user: request['user'] ?? null },
      });
      Object.defineProperty(window, 'trFileBridge', {
        configurable: true,
        writable: true,
        value: {
          version: 2,
          invoke: async (request: Record<string, unknown>) => {
            sent.push(request);
            return answer(request);
          },
          save: async () => ({ data: { saved: false } }),
          onSaveProgress: () => () => undefined,
        },
      });
      vi.spyOn(workbench.connection, 'reload').mockImplementation(() => (reloads += 1));
    });

    afterEach(() => {
      Object.defineProperty(window, 'trFileBridge', { configurable: true, writable: true, value: undefined });
    });

    const connect = async (): Promise<void> => {
      palette().show();
      palette().setActive('remote.connect');
      await palette().accept();
    };
    const labels = (): string[] => palette().items().map((item) => item.label);
    const stored = (): unknown => JSON.parse(localStorage.getItem(SAVED_SERVERS_KEY) ?? 'null');
    const add = async (value: string): Promise<void> => {
      await connect();
      palette().setActive('remote.add');
      await palette().accept();
      palette().setQuery(value);
      await palette().accept();
    };

    it('offers the saved servers and a row to add one — only the row, to begin with', async () => {
      await connect();

      expect(palette().showList()).toBe(true);
      expect(palette().placeholder()).toBe('Select a saved server, or add a new one');
      expect(labels()).toEqual(['Add New Remote Server…']);
      expect(palette().activeId()).toBe('remote.add');
    });

    it('asks for [user:password@]host:port to add one, checking it as it is typed', async () => {
      await connect();
      await palette().accept();

      expect(palette().showList()).toBe(false);
      expect(palette().placeholder()).toBe('[user:password@]host:port');
      palette().setQuery('nas.local');
      expect(palette().message()?.text).toContain('Add the port');
      palette().setQuery('nas.local:22');
      expect(palette().message()).toMatchObject({ severity: 'info' });
    });

    it('connects to a new server, signing in with its password, then keeps it — without the password — and starts over', async () => {
      await add('ana:secret@nas.local:4310');

      expect(sent).toEqual([
        { command: 'connect', scheme: 'http', host: 'nas.local', port: 4310, user: 'ana', password: 'secret' },
      ]);
      expect(palette().isOpen()).toBe(false);
      expect(reloads).toBe(1);
      expect(workbench.connection.label()).toBe('ana@nas.local:4310');
      expect(JSON.stringify(stored())).not.toContain('secret');
      expect(stored()).toEqual([expect.objectContaining({ user: 'ana', host: 'nas.local', port: 4310, scheme: 'http' })]);
    });

    it('reaches a server over HTTPS when told to, or on port 443', async () => {
      await add('https://files.example.com:8443');
      await add('files.example.com:443');

      expect(sent.map((request) => request['scheme'])).toEqual(['https', 'https']);
    });

    it('stays open, keeping nothing, when the password is wrong', async () => {
      answer = () => ({ error: { code: 'UNAUTHORIZED', message: 'Wrong username or password', status: 401 } });

      await add('ana:nope@nas.local:4310');

      expect(palette().isOpen()).toBe(true);
      expect(palette().message()).toEqual({ severity: 'error', text: 'Wrong username or password for nas.local:4310.' });
      expect(stored()).toBeNull();
      expect(reloads).toBe(0);
    });

    it('says so when the server cannot be reached', async () => {
      answer = () => ({
        error: { code: 'NETWORK_ERROR', message: 'Could not reach nas.local:4310: connect ECONNREFUSED', status: 0 },
      });

      await add('nas.local:4310');

      expect(palette().message()?.text).toBe('Could not reach nas.local:4310: connect ECONNREFUSED');
    });

    /** In a browser there is no main process to hold a connection. */
    it('needs the desktop app to connect at all', async () => {
      Object.defineProperty(window, 'trFileBridge', { configurable: true, writable: true, value: undefined });

      await add('nas.local:4310');

      expect(palette().message()?.text).toBe('Connecting to a remote server needs the tr-file desktop app.');
      expect(stored()).toBeNull();
    });

    it('connects to a saved server by picking it — asking for no password — and moves it to the top', async () => {
      // A clock that moves, so "most recently used" has an order to go by.
      let now = 1_000;
      vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));
      await add('first.local:4310');
      await add('ana:pw@second.local:4310');
      sent = [];
      await connect();
      expect(labels().slice(0, 2)).toEqual(['ana@second.local:4310', 'first.local:4310']);
      palette().setActive(palette().items()[1]?.id ?? '');

      await palette().accept();

      expect(sent).toEqual([
        { command: 'connect', scheme: 'http', host: 'first.local', port: 4310, user: null, password: null },
      ]);
      await connect();
      expect(labels().slice(0, 2)).toEqual(['first.local:4310', 'ana@second.local:4310']);
    });

    it('offers edit and remove on a saved server, with keys for both', async () => {
      await add('nas.local:22');
      await connect();

      expect(palette().items()[0]?.buttons?.map((button) => [button.id, button.shortcut])).toEqual([
        ['edit', 'F2'],
        ['remove', 'Shift+Delete'],
      ]);
    });

    it('removes a server, staying on the list', async () => {
      await add('nas.local:22');
      await add('10.0.0.5:2222');
      await connect();
      const id = palette().items().find((item) => item.label === 'nas.local:22')?.id ?? '';

      palette().itemButton({ itemId: id, buttonId: 'remove' });

      expect(palette().isOpen()).toBe(true);
      expect(labels()).toEqual(['10.0.0.5:2222', 'Add New Remote Server…']);
      expect(stored()).toEqual([expect.objectContaining({ host: '10.0.0.5' })]);
    });

    it('edits a server, then goes back to the list with it', async () => {
      await add('ana:x@nas.local:22');
      await connect();
      const id = palette().items()[0]?.id ?? '';

      palette().itemButton({ itemId: id, buttonId: 'edit' });
      expect(palette().showList()).toBe(false);
      // The password was never kept, so it is not there to edit.
      expect(palette().query()).toBe('ana@nas.local:22');
      // The prefilled address is valid as it stands…
      expect(palette().message()).toMatchObject({ severity: 'info' });
      palette().setQuery('bo:pw@nas.local:2200');
      await palette().accept();

      expect(palette().showList()).toBe(true);
      expect(labels()).toEqual(['bo@nas.local:2200', 'Add New Remote Server…']);
      expect(palette().activeId()).toBe(id);
      expect(JSON.stringify(stored())).not.toContain('pw');
    });

    it('filters the list as it is typed', async () => {
      await add('first.local:22');
      await add('second.local:22');
      await connect();

      palette().setQuery('sec');

      expect(labels()).toEqual(['second.local:22']);
    });
  });
});

describe('UiQuickInput row buttons', () => {
  let fixture: ComponentFixture<UiQuickInput>;
  const pressed: string[] = [];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiQuickInput] }).compileComponents();
    fixture = TestBed.createComponent(UiQuickInput);
    fixture.componentRef.setInput('items', [
      {
        id: 's1',
        icon: 'cloud',
        label: 'nas.local:22',
        buttons: [
          { id: 'edit', icon: 'pencil', label: 'Edit server', shortcut: 'F2' },
          { id: 'remove', icon: 'trash', label: 'Remove server', shortcut: 'Shift+Delete' },
        ],
      },
      { id: 'add', icon: 'plus', label: 'Add New Remote Server…' },
    ] satisfies UiQuickPickItem[]);
    fixture.componentRef.setInput('activeId', 's1');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    pressed.length = 0;
    fixture.componentInstance.itemButton.subscribe((event) => pressed.push(`${event.itemId}:${event.buttonId}`));
    fixture.componentInstance.accept.subscribe(() => pressed.push('accept'));
  });

  afterEach(() => fixture.nativeElement.remove());

  const field = (): HTMLInputElement => fixture.nativeElement.querySelector('input');

  it('draws the row icon and its buttons, named with their keys', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.row-button')) as HTMLElement[];

    expect(fixture.nativeElement.querySelectorAll('.row-icon')).toHaveLength(2);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Edit server (F2)', 'Remove server (Shift+Delete)']);
  });

  it('reports a button without picking the row', () => {
    (fixture.nativeElement.querySelectorAll('.row-button')[1] as HTMLElement).click();

    expect(pressed).toEqual(['s1:remove']);
  });

  it('runs a button of the active row by its shortcut, leaving other keys to the field', () => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true, bubbles: true, cancelable: true }));
    const plainDelete = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    field().dispatchEvent(plainDelete);

    expect(pressed).toEqual(['s1:edit', 's1:remove']);
    expect(plainDelete.defaultPrevented).toBe(false);
  });
});

describe('SavedServersFeature', () => {
  let clock: number;
  const make = (): SavedServersFeature => new SavedServersFeature(() => clock);
  const target = (host: string, user: string | null = null, port = 22) => ({ scheme: 'http' as const, user, password: 'pw', host, port });

  beforeEach(() => {
    clock = 1000;
    localStorage.removeItem(SAVED_SERVERS_KEY);
  });

  it('keeps servers across sessions, never with a password', () => {
    make().use(target('nas.local', 'ana'));

    const again = make();
    expect(again.servers()).toEqual([expect.objectContaining({ user: 'ana', host: 'nas.local', port: 22 })]);
    expect(localStorage.getItem(SAVED_SERVERS_KEY)).not.toContain('pw');
  });

  it('keeps one entry per user, host and port', () => {
    const servers = make();
    servers.use(target('NAS.local', 'ana'));
    clock += 1;
    servers.use(target('nas.local', 'ana'));
    servers.use(target('nas.local', 'bo'));

    expect(servers.servers()).toHaveLength(2);
  });

  it('merges an edit into a server that is kept already', () => {
    const servers = make();
    const a = servers.use(target('a.local'));
    servers.use(target('b.local'));

    servers.update(a.id, target('b.local'));

    expect(servers.servers().map((server) => server.host)).toEqual(['b.local']);
  });

  it('ignores storage it cannot read, keeping what is well formed', () => {
    localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify([{ id: 'ok', user: null, host: 'h', port: 1, addedAt: 1, lastUsedAt: null }, { id: 'bad' }]));
    expect(make().servers().map((server) => server.id)).toEqual(['ok']);

    localStorage.setItem(SAVED_SERVERS_KEY, '{not json');
    expect(make().servers()).toEqual([]);
  });
});
