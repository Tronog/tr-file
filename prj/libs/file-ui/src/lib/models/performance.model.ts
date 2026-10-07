import type { UiEmptyStateModel } from '@tr-file/ui';

/** A resource's colour, as Task Manager gives each its own: CPU blue, memory purple, disk green, network orange. */
export type UiPerfHue = 'blue' | 'purple' | 'green' | 'orange';

/**
 * One line of a graph, oldest first, already scaled to the graph: `0` at the
 * bottom, `1` at the top. `null` is a time nothing was measured — before the
 * backend started, or an adapter came up — and is left out.
 */
export interface UiPerfSeries {
  readonly label: string;
  readonly values: readonly (number | null)[];
  /** Drawn dashed, as Task Manager draws a second line (write, send). */
  readonly dashed?: boolean;
}

/** One graph: a single big one, or one of many small ones (a logical processor). */
export interface UiPerfGraph {
  readonly id: string;
  /** Over a small graph: `CPU 3`. */
  readonly label?: string;
  readonly series: readonly UiPerfSeries[];
}

/** A number under the graph: a label, small, over its value, large. */
export interface UiPerfStat {
  readonly label: string;
  readonly value: string;
}

/**
 * A resource in the list on the left: its name, its load in a word, and a
 * small graph of the same span.
 */
export interface UiPerfResource {
  readonly id: string;
  readonly label: string;
  /** Under the name: `12%  2.30 GHz`, `7.8/15.9 GB (49%)`. */
  readonly detail: string;
  readonly hue: UiPerfHue;
  readonly thumbnail: readonly UiPerfSeries[];
}

/** The resource chosen, drawn large. */
export interface UiPerfPage {
  /** `CPU`, `Memory`, `Disk`, `Ethernet`. */
  readonly title: string;
  /** Right of the title: the processor's model, the adapter's name. */
  readonly subtitle?: string;
  readonly hue: UiPerfHue;
  /** Above the graph, left: `% Utilization`. */
  readonly graphLabel: string;
  /** Above the graph, right: what its top stands for, `100%`, `1 Mbps`. */
  readonly maxLabel: string;
  readonly graphs: readonly UiPerfGraph[];
  /** Under the graph, the big numbers. */
  readonly stats: readonly UiPerfStat[];
  /** Beside them, smaller: logical processors, the host. */
  readonly details?: readonly UiPerfStat[];
  /** Ways to draw the page — the CPU's *Overall utilization* / *Logical processors*. */
  readonly views?: { readonly options: readonly { readonly id: string; readonly label: string }[]; readonly selected: string };
}

/** How much of the past a graph spans. */
export type UiPerfSpan = '60s' | '10m';

/** Everything a `UiPerformance` draws. */
export interface UiPerformanceModel {
  readonly resources: readonly UiPerfResource[];
  readonly selectedId: string | null;
  readonly page: UiPerfPage | null;
  readonly span: UiPerfSpan;
  /** Under the graph, left: `60 seconds`. */
  readonly spanLabel: string;
  /** Shown instead of everything: not measured here, not yet. */
  readonly empty?: UiEmptyStateModel;
}
