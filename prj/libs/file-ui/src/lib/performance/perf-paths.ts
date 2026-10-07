import type { UiPerfSeries } from '../models';

/** A graph is drawn in a 100 × 100 box, stretched to fit: x across time, y up from the bottom. */
export const PERF_BOX = 100;

/** The points of a series in the box, oldest at the left and the newest at the right edge; `null` breaks the line. */
function runs(values: readonly (number | null)[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  const last = Math.max(1, values.length - 1);
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (run.length > 0) {
        out.push(run);
        run = [];
      }
      return;
    }
    run.push({ x: (index / last) * PERF_BOX, y: PERF_BOX - Math.max(0, Math.min(1, value)) * PERF_BOX });
  });
  if (run.length > 0) {
    out.push(run);
  }
  return out;
}

const fixed = (value: number): string => (Math.round(value * 100) / 100).toString();

/** The SVG path of a series' line. */
export function linePath(series: UiPerfSeries): string {
  return runs(series.values)
    .map((run) => run.map((point, index) => `${index === 0 ? 'M' : 'L'}${fixed(point.x)} ${fixed(point.y)}`).join(' '))
    .join(' ');
}

/** The SVG path of the area under a series, down to the bottom — Task Manager fills under its first line. */
export function areaPath(series: UiPerfSeries): string {
  return runs(series.values)
    .map((run) => {
      const first = run[0];
      const last = run.at(-1);
      if (first === undefined || last === undefined) {
        return '';
      }
      return `M${fixed(first.x)} ${PERF_BOX} ${run.map((point) => `L${fixed(point.x)} ${fixed(point.y)}`).join(' ')} L${fixed(last.x)} ${PERF_BOX} Z`;
    })
    .join(' ');
}
