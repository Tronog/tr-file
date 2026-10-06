import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { UiBreadcrumbs, UiIconButton, UiSegmented, type UiSegmentedOption, UiEmptyState, UiIcon, UiKeymap, UiPanelBody, UiPanelToolbar } from '@tr-file/ui';
import type { UiDiskUsageItem, UiDiskUsageModel, UiDiskUsageView } from '../models';
import { PIE_INNER, sunburst, tableRows, treemap, TREEMAP_HEADER, type DiskUsageHue } from './disk-usage-layout';

/** The panel keys a disk usage panel answers, as the toolbar's ids they stand for. */
const PANEL_KEYS: Readonly<Record<string, string>> = {
  'go.up': 'up',
  'view.refresh': 'refresh',
  'view.stopLoading': 'stop',
};

/**
 * What takes up the space in a folder (PRD 013, §2.1): the path bar of a file
 * browser, with the same UX — crumbs, typing a path, its suggestions — a
 * toolbar to switch the drawing and its depth, and the folder drawn as a pie
 * (a sunburst, a ring per level), a table with a bar for each entry's share,
 * or rectangles (a treemap).
 *
 * Render-only: it is handed a tree already sized and labelled, and reports
 * what was asked for — a folder to show (`open`), a view, a depth, a
 * toolbar button. A folder is gone into by clicking it in any view, or with
 * `Enter` on it in the table or the pie's legend; `Backspace` / `Alt`+`↑`
 * go up, `Ctrl`+`R` scans again and `Escape` stops a scan — the keymap's
 * panel commands, as in a file browser.
 */
@Component({
  selector: 'ui-disk-usage',
  imports: [UiBreadcrumbs, UiEmptyState, UiIcon, UiIconButton, UiPanelBody, UiPanelToolbar, UiSegmented],
  templateUrl: './ui-disk-usage.html',
  styleUrl: './ui-disk-usage.scss',
  host: { '(keydown)': 'onKeydown($event)' },
})
export class UiDiskUsage {
  readonly model = input.required<UiDiskUsageModel>();

  readonly breadcrumbSelect = output<string>();
  readonly pathSubmit = output<string>();
  readonly locationInput = output<string>();
  readonly toolbarAction = output<string>();
  readonly viewChange = output<UiDiskUsageView>();
  readonly depthChange = output<number>();
  /** A folder of the drawing was chosen, to be shown: its id. */
  readonly open = output<string>();

  private readonly keymap = inject(UiKeymap);
  private readonly pathBar = viewChild(UiBreadcrumbs);
  private readonly drawing = viewChild<ElementRef<HTMLElement>>('treemapArea');
  private seenLocationEdit: number | undefined;

  /** The treemap's room, in pixels; measured, since its rectangles are laid out in them. */
  protected readonly area = signal({ width: 0, height: 0 });

  protected readonly viewOptions: readonly UiSegmentedOption[] = [
    { id: 'pie', label: 'Pie chart', icon: 'chart-pie' },
    { id: 'table', label: 'Table', icon: 'table' },
    { id: 'rectangles', label: 'Rectangles', icon: 'chart-treemap' },
  ];

  protected readonly pieInner = PIE_INNER;
  protected readonly treemapHeader = TREEMAP_HEADER;

  protected readonly rows = computed(() => {
    const { root, depth } = this.model();
    return root === null ? [] : tableRows(root, depth);
  });

  protected readonly slices = computed(() => {
    const { root, depth } = this.model();
    return root === null ? [] : sunburst(root, depth);
  });

  protected readonly cells = computed(() => {
    const { root, depth } = this.model();
    const { width, height } = this.area();
    return root === null ? [] : treemap(root, depth, width, height);
  });

  /** The pie's legend: the folder's own entries, as in the inner ring. */
  protected readonly legend = computed(() => this.rows().filter((row) => row.level === 0));

  protected readonly breadcrumbLabel = computed(() => {
    const last = this.model().breadcrumbs.at(-1);
    return last ? `Path of ${last.label}` : 'Path';
  });

  constructor() {
    afterRenderEffect(() => {
      const edit = this.model().locationEdit ?? 0;
      if (this.seenLocationEdit !== undefined && edit !== this.seenLocationEdit) {
        this.pathBar()?.edit();
      }
      this.seenLocationEdit = edit;
    });

    // The treemap follows the size of its box.
    let observer: ResizeObserver | null = null;
    let observed: HTMLElement | null = null;
    afterRenderEffect(() => {
      const element = this.drawing()?.nativeElement ?? null;
      if (element === observed) {
        return;
      }
      observer?.disconnect();
      observed = element;
      if (element === null || typeof ResizeObserver === 'undefined') {
        return;
      }
      observer = new ResizeObserver(([entry]) => {
        const box = entry?.contentRect;
        if (box !== undefined) {
          this.area.set({ width: Math.floor(box.width), height: Math.floor(box.height) });
        }
      });
      observer.observe(element);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }

  protected setView(value: string): void {
    this.viewChange.emit(value as UiDiskUsageView);
  }

  protected choose(item: UiDiskUsageItem): void {
    if (item.openable) {
      this.open.emit(item.id);
    }
  }

  /** The tooltip of an entry: its name, size, share and whatever else there is to say. */
  protected titleOf(item: UiDiskUsageItem, percent: number): string {
    return [item.name, `${item.sizeLabel} · ${DiskUsageFormat.percent(percent)}`, item.detail, item.note].filter(Boolean).join('\n');
  }

  protected percent(value: number): string {
    return DiskUsageFormat.percent(value);
  }

  protected hueClass(hue: DiskUsageHue): string {
    return `hue-${hue}`;
  }

  /** Deeper rings and rectangles are paler, and a file paler than a folder. */
  protected opacity(level: number, item: UiDiskUsageItem): number {
    const base = Math.max(0.9 - (level - 1) * 0.16, 0.3);
    return item.kind === 'file' ? base * 0.65 : base;
  }

  /** Whether a rectangle has room for its name, and for its size below it. */
  protected fits(width: number, height: number): { readonly name: boolean; readonly size: boolean } {
    return { name: width > 44 && height > 16, size: width > 44 && height > 32 };
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || DiskUsageFormat.isTextField(event.target)) {
      return;
    }
    if (this.keymap.commandFor(event, 'panel', ['go.location']) !== null) {
      event.preventDefault();
      this.pathBar()?.edit();
      return;
    }
    const command =
      this.keymap.commandFor(event, 'list', ['go.up']) ?? this.keymap.commandFor(event, 'panel', Object.keys(PANEL_KEYS));
    const id = command === null ? undefined : PANEL_KEYS[command];
    // A toolbar button that is not there now — Stop when nothing is scanning — leaves its key alone.
    if (id === undefined || !this.model().toolbarActions.some((action) => action.id === id && !action.disabled)) {
      return;
    }
    event.preventDefault();
    this.toolbarAction.emit(id);
  }

  /** `↑` / `↓`, `Home` / `End` between the rows of the table or the legend: fixed navigation keys. */
  protected onRowKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const list = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-row]');
    const rows = Array.from(list);
    const at = rows.indexOf(event.target as HTMLElement);
    if (at === -1 || rows.length === 0) {
      return;
    }
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1);
    rows.forEach((row, index) => row.setAttribute('tabindex', index === next ? '0' : '-1'));
    rows[next]?.focus();
  }
}

const DiskUsageFormat = {
  percent(value: number): string {
    return value >= 10 || value === 0 ? `${Math.round(value)} %` : value >= 0.1 ? `${value.toFixed(1)} %` : '< 0.1 %';
  },
  isTextField(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
  },
};
