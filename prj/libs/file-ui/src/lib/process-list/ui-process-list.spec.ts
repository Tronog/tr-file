import { TestBed } from '@angular/core/testing';
import { UiProcessList, type UiProcessListModel, type UiProcessRow } from '../../public-api';

/** PRD 014, §2 — Windows 10 Task Manager's Processes tab, drawn. */

const row = (id: string, patch: Partial<UiProcessRow> = {}): UiProcessRow => ({
  id,
  kind: 'process',
  level: 1,
  label: id,
  cells: { cpu: { text: '0%', heat: 0 } },
  ...patch,
});

const model = (overrides: Partial<UiProcessListModel> = {}): UiProcessListModel => ({
  columns: [
    { id: 'name', label: 'Name', width: 200, sort: 'asc' },
    { id: 'cpu', label: 'CPU', width: 70, numeric: true, total: '12%', totalHeat: 0.12 },
  ],
  rows: [
    { id: 's:app', kind: 'section', level: 0, label: 'Apps (2)', cells: {} },
    row('g:chrome', { kind: 'group', label: 'chrome', detail: '(3)', expandable: true, expanded: false, cells: { cpu: { text: '7.5%', heat: 0.3 } } }),
    row('p:2', { label: 'editor' }),
    { id: 's:background', kind: 'section', level: 0, label: 'Background processes (1)', cells: {} },
    row('p:3', { label: 'daemon' }),
  ],
  selectedId: 'g:chrome',
  filter: '',
  paused: false,
  canEnd: true,
  summary: '5 processes',
  ...overrides,
});

describe('UiProcessList', () => {
  const setUp = (value = model()) => {
    const fixture = TestBed.createComponent(UiProcessList);
    fixture.componentRef.setInput('model', value);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const events: string[] = [];
    const ui = fixture.componentInstance;
    ui.select.subscribe((id) => events.push(`select ${id}`));
    ui.toggle.subscribe((id) => events.push(`toggle ${id}`));
    ui.sort.subscribe((id) => events.push(`sort ${id}`));
    ui.endTask.subscribe(() => events.push('end'));
    ui.endTree.subscribe(() => events.push('end tree'));
    ui.pauseToggle.subscribe(() => events.push('pause'));
    ui.contextMenu.subscribe((request) => events.push(`menu ${request.target}`));
    const body = host.querySelector<HTMLElement>('.body') as HTMLElement;
    const key = (init: KeyboardEventInit) => body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { fixture, host, events, body, key };
  };

  it('heads its measured columns with the machine’s load, and its rows with Task Manager’s headings', () => {
    const { host } = setUp();
    const cpu = host.querySelectorAll<HTMLElement>('.head-cell')[1];
    expect(cpu?.querySelector('.total')?.textContent).toBe('12%');
    expect(cpu?.querySelector('.label')?.textContent).toBe('CPU');
    expect(cpu?.style.getPropertyValue('--heat')).toBe('0.12');
    expect(Array.from(host.querySelectorAll('.section-label')).map((label) => label.textContent)).toEqual(['Apps (2)', 'Background processes (1)']);
    const group = host.querySelector('.row.is-group');
    expect(group?.getAttribute('aria-expanded')).toBe('false');
    expect(group?.getAttribute('aria-selected')).toBe('true');
    expect(group?.querySelector('.is-heated')?.textContent?.trim()).toBe('7.5%');
    expect(host.querySelector('.summary')?.textContent).toBe('5 processes');
  });

  it('moves between rows passing over the headings, opens a group with →, and finds a row by typing', () => {
    const { body, events, key } = setUp();
    body.focus();
    key({ key: 'ArrowDown' });
    key({ key: 'End' });
    key({ key: 'ArrowRight' });
    key({ key: 'Enter' });
    key({ key: 'd' });
    expect(events).toEqual(['select p:2', 'select p:3', 'toggle g:chrome', 'toggle g:chrome', 'select p:3']);
  });

  it('ends a task with the keymap’s keys, and with the button', () => {
    const { host, body, events, key } = setUp();
    body.focus();
    key({ key: 'Delete' });
    key({ key: 'Delete', shiftKey: true });
    host.querySelector<HTMLButtonElement>('.footer button')?.click();
    expect(events).toEqual(['end', 'end tree', 'end']);
  });

  it('sorts by a header clicked, pauses, and opens menus on a row and on the header', () => {
    const { host, events } = setUp();
    host.querySelectorAll<HTMLButtonElement>('.head-cell')[1]?.click();
    host.querySelector<HTMLElement>('ui-icon-button button')?.click();
    host.querySelectorAll<HTMLElement>('.row.is-process')[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    host.querySelector('.head')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(events).toEqual(['sort cpu', 'pause', 'select p:3', 'menu p:3', 'menu header']);
  });

  it('cannot end a task it may not, and says why', () => {
    const { host } = setUp(model({ canEnd: false, endTitle: 'Switched off here.' }));
    const button = host.querySelector<HTMLButtonElement>('.footer button');
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe('Switched off here.');
  });
});
