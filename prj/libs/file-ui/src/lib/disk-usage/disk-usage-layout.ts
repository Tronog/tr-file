import type { UiDiskUsageItem } from '../models';

/**
 * The geometry of `UiDiskUsage`'s three drawings (PRD 013, §2.1), kept apart
 * from the component so it can be reasoned about — and tested — as plain
 * arithmetic: a sunburst for the pie, a squarified treemap for the
 * rectangles, and the table's rows.
 *
 * Every drawing colours an entry by the top-level entry it is in, so one
 * folder keeps one colour all the way down, and the views agree.
 */

/** Hues entries are coloured by, in turn — red is left out, as it reads as an error. */
export const DISK_USAGE_HUES = ['blue', 'green', 'orange', 'purple', 'teal', 'yellow', 'pink'] as const;

export type DiskUsageHue = (typeof DISK_USAGE_HUES)[number] | 'rest';

/** The hue of the `index`-th top-level entry; what is left summed is grey. */
export function hueOf(item: UiDiskUsageItem, index: number): DiskUsageHue {
  return item.kind === 'rest' ? 'rest' : (DISK_USAGE_HUES[index % DISK_USAGE_HUES.length] as DiskUsageHue);
}

/* -- table ---------------------------------------------------------------- */

export interface DiskUsageRow {
  readonly item: UiDiskUsageItem;
  /** `0` for the folder's own entries. */
  readonly level: number;
  /** Share of the folder drawn, `0`–`100`. */
  readonly percent: number;
  readonly hue: DiskUsageHue;
}

/** The entries to `depth` levels, each folder's own straight after it, one level in. */
export function tableRows(root: UiDiskUsageItem, depth: number): readonly DiskUsageRow[] {
  const total = root.size;
  const rows: DiskUsageRow[] = [];
  const walk = (items: readonly UiDiskUsageItem[], level: number, hue: DiskUsageHue | null): void => {
    items.forEach((item, index) => {
      const own = hue ?? hueOf(item, index);
      rows.push({ item, level, percent: total > 0 ? (item.size / total) * 100 : 0, hue: own });
      if (level + 1 < depth && item.children !== undefined) {
        walk(item.children, level + 1, own);
      }
    });
  };
  walk(root.children ?? [], 0, null);
  return rows;
}

/* -- pie (a sunburst) ------------------------------------------------------- */

export interface DiskUsageSlice {
  readonly item: UiDiskUsageItem;
  /** `1` for the folder's own entries, the inner ring. */
  readonly level: number;
  readonly hue: DiskUsageHue;
  /** The SVG path of the slice, in a 200 × 200 box centred on 100, 100. */
  readonly d: string;
  /** Share of the folder drawn, `0`–`100`. */
  readonly percent: number;
}

/** Radius of the hole in the middle, where the folder's own size is written. */
export const PIE_INNER = 34;
const PIE_OUTER = 98;
const CENTRE = 100;
/** Slices narrower than this (radians) are not drawn: they would be a hairline. */
const MIN_ANGLE = 0.003;

/**
 * A ring per level, out from the middle: the folder's entries round the inner
 * ring, each folder's own entries in the ring outside it, within its angle.
 */
export function sunburst(root: UiDiskUsageItem, depth: number): readonly DiskUsageSlice[] {
  const total = root.size;
  if (total <= 0 || depth < 1) {
    return [];
  }
  const width = (PIE_OUTER - PIE_INNER) / depth;
  const slices: DiskUsageSlice[] = [];
  const walk = (items: readonly UiDiskUsageItem[], parentSize: number, start: number, span: number, level: number, hue: DiskUsageHue | null): void => {
    let at = start;
    items.forEach((item, index) => {
      const share = parentSize > 0 ? Math.min(item.size / parentSize, 1) : 0;
      const angle = span * share;
      const own = hue ?? hueOf(item, index);
      if (angle >= MIN_ANGLE) {
        const inner = PIE_INNER + (level - 1) * width;
        slices.push({ item, level, hue: own, percent: (item.size / total) * 100, d: arc(inner, inner + width - 1, at, at + angle) });
        if (level < depth && item.children !== undefined && item.size > 0) {
          walk(item.children, item.size, at, angle, level + 1, own);
        }
      }
      at += angle;
    });
  };
  walk(root.children ?? [], total, 0, Math.PI * 2, 1, null);
  return slices;
}

/** A ring segment from `start` to `end` (radians, clockwise from the top), as an SVG path. */
export function arc(inner: number, outer: number, start: number, end: number): string {
  const full = end - start >= Math.PI * 2 - 1e-6;
  if (full) {
    // A whole ring: two halves, since one arc cannot start and end at the same point.
    const middle = start + Math.PI;
    return `${arc(inner, outer, start, middle)} ${arc(inner, outer, middle, start + Math.PI * 2)}`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = point(outer, start);
  const [x1, y1] = point(outer, end);
  const [x2, y2] = point(inner, end);
  const [x3, y3] = point(inner, start);
  return [
    `M${x0} ${y0}`,
    `A${outer} ${outer} 0 ${large} 1 ${x1} ${y1}`,
    `L${x2} ${y2}`,
    `A${inner} ${inner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function point(radius: number, angle: number): readonly [number, number] {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return [round(CENTRE + radius * Math.sin(angle)), round(CENTRE - radius * Math.cos(angle))];
}

/* -- rectangles (a squarified treemap) -------------------------------------- */

export interface DiskUsageCell {
  readonly item: UiDiskUsageItem;
  readonly level: number;
  readonly hue: DiskUsageHue;
  /** Pixels, within the drawing. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A folder with room for its name above what it holds. */
  readonly header: boolean;
  readonly percent: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Height of the strip a folder's name takes above its entries. */
export const TREEMAP_HEADER = 18;
/** Gap between a folder's edge and its entries. */
const TREEMAP_PADDING = 2;
/** A cell smaller than this either way is not drawn, nor anything in it. */
const TREEMAP_MIN = 3;

/**
 * The entries as rectangles whose areas are their sizes, laid out in rows
 * that keep them as square as they can be (Bruls, Huizing and van Wijk's
 * squarified treemap) — each folder's own entries inside it, to `depth`
 * levels, under a strip with its name where there is room for one.
 */
export function treemap(root: UiDiskUsageItem, depth: number, width: number, height: number): readonly DiskUsageCell[] {
  const total = root.size;
  if (total <= 0 || width < TREEMAP_MIN || height < TREEMAP_MIN || depth < 1) {
    return [];
  }
  const cells: DiskUsageCell[] = [];
  const place = (items: readonly UiDiskUsageItem[], area: Rect, level: number, hue: DiskUsageHue | null): void => {
    const drawn = items.filter((item) => item.size > 0);
    squarify(drawn, area).forEach(({ item, rect }) => {
      // Too small to see — or the room of a folder its entries do not account for (`scaled`).
      if (rect.width < TREEMAP_MIN || rect.height < TREEMAP_MIN || item.id.endsWith(GAP)) {
        return;
      }
      const own = hue ?? hueOf(item, items.indexOf(item));
      const nested = level < depth && item.children !== undefined && item.children.length > 0;
      const header = nested && rect.width > 40 && rect.height > TREEMAP_HEADER + 12;
      cells.push({ item, level, hue: own, ...rect, header, percent: (item.size / total) * 100 });
      if (!nested) {
        return;
      }
      const top = header ? TREEMAP_HEADER : TREEMAP_PADDING;
      const inner: Rect = {
        x: rect.x + TREEMAP_PADDING,
        y: rect.y + top,
        width: rect.width - TREEMAP_PADDING * 2,
        height: rect.height - top - TREEMAP_PADDING,
      };
      if (inner.width >= TREEMAP_MIN && inner.height >= TREEMAP_MIN) {
        place(DiskUsageLayout.scaled(item), inner, level + 1, own);
      }
    });
  };
  place(root.children ?? [], { x: 0, y: 0, width, height }, 1, null);
  return cells;
}

/** Ends the id of the room a folder's listed entries leave unaccounted for. */
const GAP = '\u0000gap';

const DiskUsageLayout = {
  /**
   * A folder's entries, plus — when they add up to less than the folder (its
   * scan still going, files too small to list) — nothing for the gap: the
   * entries keep their own sizes, so they fill only their share of it.
   */
  scaled(item: UiDiskUsageItem): readonly UiDiskUsageItem[] {
    const children = item.children ?? [];
    const sum = children.reduce((total, child) => total + Math.max(child.size, 0), 0);
    const gap = item.size - sum;
    return gap > item.size * 0.001 ? [...children, { id: `${item.id}${GAP}`, name: '', kind: 'rest', size: gap, sizeLabel: '' }] : children;
  },
};

/** Lays `items` (largest first) into `area`, areas in proportion to their sizes. */
export function squarify(items: readonly UiDiskUsageItem[], area: Rect): readonly { readonly item: UiDiskUsageItem; readonly rect: Rect }[] {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= 0 || area.width <= 0 || area.height <= 0) {
    return [];
  }
  const scale = (area.width * area.height) / total;
  const sorted = [...items].sort((a, b) => b.size - a.size);
  const placed: { item: UiDiskUsageItem; rect: Rect }[] = [];
  let free = area;
  let row: UiDiskUsageItem[] = [];

  const worst = (candidate: readonly UiDiskUsageItem[], side: number): number => {
    const areas = candidate.map((item) => item.size * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const largest = Math.max(...areas);
    const smallest = Math.min(...areas);
    return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
  };
  const layRow = (): void => {
    const sum = row.reduce((total, item) => total + item.size * scale, 0);
    const horizontal = free.width >= free.height; // A column down the left, or a row along the top.
    const thickness = horizontal ? sum / free.height : sum / free.width;
    let offset = 0;
    for (const item of row) {
      const length = (item.size * scale) / thickness;
      placed.push({
        item,
        rect: horizontal
          ? { x: free.x, y: free.y + offset, width: thickness, height: length }
          : { x: free.x + offset, y: free.y, width: length, height: thickness },
      });
      offset += length;
    }
    free = horizontal
      ? { x: free.x + thickness, y: free.y, width: Math.max(free.width - thickness, 0), height: free.height }
      : { x: free.x, y: free.y + thickness, width: free.width, height: Math.max(free.height - thickness, 0) };
    row = [];
  };

  for (const item of sorted) {
    if (item.size <= 0) {
      continue;
    }
    const side = Math.min(free.width, free.height);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item);
    } else {
      layRow();
      row.push(item);
    }
  }
  if (row.length > 0) {
    layRow();
  }
  return placed;
}
