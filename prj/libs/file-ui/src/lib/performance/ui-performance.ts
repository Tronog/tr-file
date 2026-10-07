import { Component, ElementRef, afterRenderEffect, computed, input, output, viewChild } from '@angular/core';
import { UiEmptyState } from '@tr-file/ui';
import type { UiPerfSeries, UiPerfSpan, UiPerformanceModel } from '../models';
import { PERF_BOX, areaPath, linePath } from './perf-paths';

/** Grid lines across and down a big graph, as Task Manager rules it. */
const ROWS = 10;
const COLUMNS = 20;

/**
 * Windows 10 Task Manager's *Performance* tab (PRD 014, §2.1), the Graph
 * section of Task Manager: on the left the machine's resources — CPU, memory,
 * disk, each network adapter — each with its load in a word and a small graph;
 * on the right the one chosen, large: its graph ruled in its colour, what the
 * top of the graph stands for, the span under it, and the numbers below. The
 * CPU's page draws one graph for the whole or one per logical processor.
 *
 * Render-only: the series are handed in already scaled to the graph and the
 * numbers already worded; it reports a resource chosen, a span, a view.
 * `↑` / `↓`, `Home` / `End` move through the resources (navigation, so fixed).
 */
@Component({
  selector: 'ui-performance',
  imports: [UiEmptyState],
  templateUrl: './ui-performance.html',
  styleUrl: './ui-performance.scss',
})
export class UiPerformance {
  readonly model = input.required<UiPerformanceModel>();
  /** Bump to put the keyboard on the list of resources. */
  readonly focusToken = input<number>(0);

  readonly resourceSelect = output<string>();
  readonly spanChange = output<UiPerfSpan>();
  /** One of the page's `views` chosen. */
  readonly viewChange = output<string>();

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private seenFocus = 0;

  protected readonly box = PERF_BOX;
  protected readonly rows = Array.from({ length: ROWS - 1 }, (_, index) => ((index + 1) * PERF_BOX) / ROWS);
  protected readonly columns = Array.from({ length: COLUMNS - 1 }, (_, index) => ((index + 1) * PERF_BOX) / COLUMNS);
  protected readonly spans: readonly { readonly id: UiPerfSpan; readonly label: string }[] = [
    { id: '60s', label: '60 seconds' },
    { id: '10m', label: '10 minutes' },
  ];

  /** Many graphs (one per logical processor) are laid out in a near-square grid. */
  protected readonly gridColumns = computed(() => {
    const count = this.model().page?.graphs.length ?? 1;
    return count <= 1 ? 1 : Math.ceil(Math.sqrt(count));
  });

  constructor() {
    afterRenderEffect(() => {
      const token = this.focusToken();
      if (token !== this.seenFocus) {
        this.seenFocus = token;
        if (token > 0) {
          this.list()?.nativeElement.focus({ preventScroll: true });
        }
      }
    });
  }

  protected line(series: UiPerfSeries): string {
    return linePath(series);
  }

  protected area(series: UiPerfSeries): string {
    return areaPath(series);
  }

  protected optionId(id: string): string {
    return `ui-perf-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  protected onListKeydown(event: KeyboardEvent): void {
    const { resources, selectedId } = this.model();
    if (resources.length === 0 || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const at = resources.findIndex((resource) => resource.id === selectedId);
    const next =
      event.key === 'ArrowDown'
        ? Math.min(resources.length - 1, at + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, at - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? resources.length - 1
              : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    const resource = resources[next];
    if (resource !== undefined) {
      this.resourceSelect.emit(resource.id);
    }
  }
}
