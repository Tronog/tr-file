import { TestBed } from '@angular/core/testing';
import { UiPerformance, areaPath, linePath, type UiPerformanceModel } from '../../public-api';

/** PRD 014, §2.1 — Task Manager's graphs, drawn. */

const model = (overrides: Partial<UiPerformanceModel> = {}): UiPerformanceModel => ({
  resources: [
    { id: 'cpu', label: 'CPU', detail: '12%  2.30 GHz', hue: 'blue', thumbnail: [{ label: 'Utilization', values: [null, 0.1, 0.5] }] },
    { id: 'memory', label: 'Memory', detail: '4.0/8.0 GB (50%)', hue: 'purple', thumbnail: [{ label: 'In use', values: [0.5, 0.5, 0.5] }] },
    { id: 'disk', label: 'Disk', detail: 'R: 0 KB/s  W: 0 KB/s', hue: 'green', thumbnail: [] },
  ],
  selectedId: 'cpu',
  page: {
    title: 'CPU',
    subtitle: 'Test CPU',
    hue: 'blue',
    graphLabel: '% Utilization',
    maxLabel: '100%',
    graphs: [{ id: 'cpu', series: [{ label: 'Utilization', values: [null, 0.1, 0.5] }] }],
    stats: [{ label: 'Utilization', value: '12%' }],
    details: [{ label: 'Logical processors', value: '2' }],
    views: { options: [{ id: 'overall', label: 'Overall utilization' }, { id: 'logical', label: 'Logical processors' }], selected: 'overall' },
  },
  span: '60s',
  spanLabel: '60 seconds',
  ...overrides,
});

describe('UiPerformance', () => {
  const setUp = (value = model()) => {
    const fixture = TestBed.createComponent(UiPerformance);
    fixture.componentRef.setInput('model', value);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const events: string[] = [];
    const ui = fixture.componentInstance;
    ui.resourceSelect.subscribe((id) => events.push(`resource ${id}`));
    ui.spanChange.subscribe((span) => events.push(`span ${span}`));
    ui.viewChange.subscribe((view) => events.push(`view ${view}`));
    return { host, events };
  };

  it('draws a line from left to right, the newest at the right edge, breaking where nothing was measured', () => {
    expect(linePath({ label: 'x', values: [null, 0, 1] })).toBe('M50 100 L100 0');
    expect(linePath({ label: 'x', values: [0.5, null, 0.5] })).toBe('M0 50 M100 50');
    expect(areaPath({ label: 'x', values: [0, 1] })).toBe('M0 100 L0 100 L100 0 L100 100 Z');
  });

  it('lists the resources with their load, and draws the one chosen with its numbers', () => {
    const { host } = setUp();
    const options = Array.from(host.querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.querySelector('.resource-label')?.textContent)).toEqual(['CPU', 'Memory', 'Disk']);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.page-title')?.textContent).toBe('CPU');
    expect(host.querySelector('.page-subtitle')?.textContent).toBe('Test CPU');
    expect(host.querySelector('.graph-head')?.textContent).toContain('100%');
    expect(host.querySelector('.graph .line')?.getAttribute('d')).toBe('M50 90 L100 50');
    expect(host.querySelector('.stat dd')?.textContent).toBe('12%');
    expect(host.querySelector('.detail dd')?.textContent).toBe('2');
  });

  it('chooses a resource by click and with the arrow keys, a span and a view', () => {
    const { host, events } = setUp();
    host.querySelectorAll<HTMLElement>('[role="option"]')[2]?.click();
    const list = host.querySelector<HTMLElement>('[role="listbox"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[1]?.click();
    radios[3]?.click();
    expect(events).toEqual(['resource disk', 'resource memory', 'resource disk', 'span 10m', 'view logical']);
  });

  it('lays many graphs out in a grid, each labelled', () => {
    const graphs = Array.from({ length: 4 }, (_, index) => ({ id: `core-${index}`, label: `CPU ${index}`, series: [{ label: 'Utilization', values: [0.2] }] }));
    const { host } = setUp(model({ page: { ...(model().page as NonNullable<UiPerformanceModel['page']>), graphs } }));
    expect(Array.from(host.querySelectorAll('.graph-label')).map((label) => label.textContent)).toEqual(['CPU 0', 'CPU 1', 'CPU 2', 'CPU 3']);
    expect(host.querySelector<HTMLElement>('.graphs')?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('says why there is nothing to draw', () => {
    const { host } = setUp(model({ resources: [], page: null, empty: { icon: 'lock', title: 'Task Manager is not available here' } }));
    expect(host.querySelector('ui-empty-state')?.textContent).toContain('Task Manager is not available here');
  });
});
