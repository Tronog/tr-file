import type { UiPerfGraph, UiPerfPage, UiPerfResource, UiPerfSeries, UiPerfSpan, UiPerformanceModel } from '@tr-file/file-ui';
import type { FsProcessesHistory, FsProcessesSnapshot } from '../../file-system/file-system.model';

/** The CPU page drawn as one graph, or one per logical processor (Task Manager's *Change graph to*). */
export type CpuView = 'overall' | 'logical';

export interface PerformanceInput {
  readonly snapshot: FsProcessesSnapshot;
  /** The machine's last ten minutes; `null` until the first answer. */
  readonly history: FsProcessesHistory | null;
  readonly selectedId: string | null;
  readonly span: UiPerfSpan;
  readonly cpuView: CpuView;
}

/** How long each span is, in seconds. */
const SPAN_SECONDS: Readonly<Record<UiPerfSpan, number>> = { '60s': 60, '10m': 600 };

/** The least a transfer graph's top stands for, so a quiet disk or network is not drawn as if busy. */
const DISK_FLOOR = 100 * 1024;
const NETWORK_FLOOR_BITS = 100 * 1000;

/** Id of a network adapter's page. */
export const networkId = (name: string): string => `net:${name}`;

/**
 * The Graph section of Task Manager (PRD 014, §2.1), as Windows 10's
 * *Performance* tab: one resource per row — CPU, memory, disk, and each
 * network adapter — and the one chosen drawn large over the span chosen, from
 * the history the backend keeps: ten minutes, a sample every two seconds
 * while Task Manager is shown and every ten while not (§4.1) — so each
 * point is placed by when it was taken, not by its count.
 *
 * Every series is fitted to its graph here: CPU and memory against their
 * whole, disk and network against a top rounded up from the busiest moment
 * shown (1, 2 or 5 of a power of ten), as Task Manager rescales its transfer
 * graphs. A span longer than what has been measured starts empty at the left,
 * and a gap longer than the slow pace allows (the backend down) breaks the line.
 */
export function buildPerformance(input: PerformanceInput): UiPerformanceModel {
  const { snapshot, history, span } = input;
  const window = (values: readonly (number | null)[] | undefined): Placed => place(history?.times ?? [], values ?? [], SPAN_SECONDS[span] * 1000);
  const totals = history?.totals;
  const { totals: now, machine } = snapshot;

  const cpuSeries = line('Utilization', window(totals?.cpu), 100);
  const memoryTotal = Math.max(1, totals?.memoryTotal ?? now.memoryTotal);
  const memorySeries = line('In use', window(totals?.memory), memoryTotal);
  const reads = window(totals?.diskRead);
  const writes = window(totals?.diskWrite);
  const diskTop = niceTop(peak(reads, writes), DISK_FLOOR);
  const diskSeries: UiPerfSeries[] = [line('Read', reads, diskTop), { ...line('Write', writes, diskTop), dashed: true }];

  const memoryShare = now.memoryTotal === 0 ? 0 : (now.memoryUsed / now.memoryTotal) * 100;
  const resources: UiPerfResource[] = [
    {
      id: 'cpu',
      label: 'CPU',
      detail: `${Math.round(now.cpu)}%  ${formatSpeed(machine.cpuSpeedMhz)}`.trim(),
      hue: 'blue',
      thumbnail: [cpuSeries],
    },
    {
      id: 'memory',
      label: 'Memory',
      detail: `${formatGb(now.memoryUsed)}/${formatGb(now.memoryTotal)} GB (${Math.round(memoryShare)}%)`,
      hue: 'purple',
      thumbnail: [memorySeries],
    },
    {
      id: 'disk',
      label: 'Disk',
      detail: now.disk === null ? 'Not measured here' : `R: ${formatBytesRate(now.diskRead ?? 0)}  W: ${formatBytesRate(now.diskWrite ?? 0)}`,
      hue: 'green',
      thumbnail: diskSeries,
    },
  ];

  const adapters = now.network.map((adapter) => {
    const series = totals?.network[adapter.name];
    const sends = window(series?.send.map((bytes) => bytes * 8));
    const receives = window(series?.receive.map((bytes) => bytes * 8));
    const top = niceTop(peak(sends, receives), NETWORK_FLOOR_BITS);
    const lines: UiPerfSeries[] = [line('Receive', receives, top), { ...line('Send', sends, top), dashed: true }];
    resources.push({
      id: networkId(adapter.name),
      label: adapterLabel(adapter.name, snapshot.platform),
      detail: `S: ${formatBits(adapter.send * 8)}  R: ${formatBits(adapter.receive * 8)}`,
      hue: 'orange',
      thumbnail: lines,
    });
    return { adapter, top, lines };
  });

  const selectedId = resources.some((resource) => resource.id === input.selectedId) ? (input.selectedId as string) : 'cpu';
  let page: UiPerfPage;
  switch (selectedId) {
    case 'memory':
      page = {
        title: 'Memory',
        subtitle: `${formatGb(now.memoryTotal)} GB`,
        hue: 'purple',
        graphLabel: 'Memory usage',
        maxLabel: `${formatGb(now.memoryTotal)} GB`,
        graphs: [{ id: 'memory', series: [memorySeries] }],
        stats: [
          { label: 'In use', value: `${formatGb(now.memoryUsed)} GB` },
          { label: 'Available', value: `${formatGb(Math.max(0, now.memoryTotal - now.memoryUsed))} GB` },
          { label: 'Used', value: `${Math.round(memoryShare)}%` },
        ],
      };
      break;
    case 'disk':
      page = {
        title: 'Disk',
        subtitle: 'All processes',
        hue: 'green',
        graphLabel: 'Disk transfer rate',
        maxLabel: roundLabel(formatBytesRate(diskTop)),
        graphs: [{ id: 'disk', series: diskSeries }],
        stats: [
          { label: 'Read speed', value: now.diskRead === null ? '—' : formatBytesRate(now.diskRead) },
          { label: 'Write speed', value: now.diskWrite === null ? '—' : formatBytesRate(now.diskWrite) },
        ],
        details: [{ label: 'Measured from', value: 'what each process reads and writes' }],
      };
      break;
    case 'cpu':
      page = cpuPage(input, cpuSeries, window);
      break;
    default: {
      const shown = adapters.find((entry) => networkId(entry.adapter.name) === selectedId) ?? adapters[0];
      page =
        shown === undefined
          ? cpuPage(input, cpuSeries, window)
          : {
              title: adapterLabel(shown.adapter.name, snapshot.platform),
              subtitle: shown.adapter.name,
              hue: 'orange',
              graphLabel: 'Throughput',
              maxLabel: roundLabel(formatBits(shown.top)),
              graphs: [{ id: 'network', series: shown.lines }],
              stats: [
                { label: 'Send', value: formatBits(shown.adapter.send * 8) },
                { label: 'Receive', value: formatBits(shown.adapter.receive * 8) },
              ],
            };
    }
  }

  return { resources, selectedId, page, span, spanLabel: span === '60s' ? '60 seconds' : '10 minutes' };
}

function cpuPage(input: PerformanceInput, cpuSeries: UiPerfSeries, window: (values: readonly (number | null)[] | undefined) => Placed): UiPerfPage {
  const { snapshot, history, cpuView } = input;
  const { totals: now, machine } = snapshot;
  const cores = history?.totals.cores ?? [];
  const graphs: UiPerfGraph[] =
    cpuView === 'logical' && cores.length > 0
      ? cores.map((series, index) => ({
          id: `core-${index}`,
          label: `CPU ${index}`,
          series: [line('Utilization', window(series), 100)],
        }))
      : [{ id: 'cpu', series: [cpuSeries] }];
  return {
    title: 'CPU',
    ...(machine.cpuModel === '' ? {} : { subtitle: machine.cpuModel }),
    hue: 'blue',
    graphLabel: cpuView === 'logical' ? '% Utilization of each logical processor' : '% Utilization',
    maxLabel: '100%',
    graphs,
    stats: [
      { label: 'Utilization', value: `${Math.round(now.cpu)}%` },
      { label: 'Speed', value: formatSpeed(machine.cpuSpeedMhz) || '—' },
      { label: 'Processes', value: String(now.processes) },
      { label: 'Threads', value: now.threads === null ? '—' : String(now.threads) },
      { label: 'Up time', value: formatUptime(machine.uptimeSeconds) },
    ],
    details: [
      { label: 'Logical processors', value: String(snapshot.cpuCount) },
      ...(machine.hostname === '' ? [] : [{ label: 'Computer', value: machine.hostname }]),
    ],
    views: {
      options: [
        { id: 'overall', label: 'Overall utilization' },
        { id: 'logical', label: 'Logical processors' },
      ],
      selected: cpuView,
    },
  };
}

/** Samples placed across a span: each value, and where it stands, `0` the left edge and `1` the newest at the right. */
export interface Placed {
  readonly values: readonly (number | null)[];
  readonly x: readonly number[];
}

/** A gap in the samples longer than this is the backend not measuring, drawn as a break in the line. */
const GAP_MS = 25_000;

/**
 * The samples of the last `spanMs` placed by when they were taken: `values`
 * matches the end of `times`; the newest is at the right edge. A gap longer
 * than `GAP_MS` gets a `null` between its two sides, so the line breaks there
 * rather than drawing a slope nothing measured.
 */
export function place(times: readonly number[], values: readonly (number | null)[], spanMs: number): Placed {
  const end = times.at(-1);
  if (end === undefined) {
    return { values: [], x: [] };
  }
  const offset = times.length - values.length;
  const start = end - spanMs;
  const out: (number | null)[] = [];
  const x: number[] = [];
  let previous: number | null = null;
  values.forEach((value, index) => {
    const time = times[offset + index];
    if (time === undefined || time < start) {
      return;
    }
    const at = (time - start) / spanMs;
    if (previous !== null && time - previous > GAP_MS) {
      out.push(null);
      x.push(at);
    }
    out.push(value);
    x.push(at);
    previous = time;
  });
  return { values: out, x };
}

/** A line of the graph, scaled so `top` is the top. */
function line(label: string, placed: Placed, top: number): UiPerfSeries {
  return { label, values: placed.values.map((value) => (value === null ? null : value / top)), x: placed.x };
}

/** The busiest moment of a few series. */
function peak(...series: Placed[]): number {
  return Math.max(0, ...series.flatMap((placed) => placed.values.map((value) => value ?? 0)));
}

/** A graph's top is a round number, and says so: `1 Mbps`, not `1.0 Mbps`. */
function roundLabel(label: string): string {
  return label.replace(/\.0 /, ' ');
}

/** A graph's top: the busiest value rounded up to 1, 2 or 5 of a power of ten, and never under `floor`. */
export function niceTop(value: number, floor: number): number {
  const target = Math.max(value, floor);
  const power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= target) ?? 10;
  return step * power;
}

/** On Windows the adapter's own name says it; elsewhere `wl…` is Wi-Fi and `en…` / `eth…` Ethernet. */
export function adapterLabel(name: string, platform: string): string {
  if (platform === 'win32') {
    return name;
  }
  return /^wl/.test(name) ? 'Wi-Fi' : /^(en|eth)/.test(name) ? 'Ethernet' : name;
}

function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function formatSpeed(mhz: number): string {
  return mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : '';
}

/** `0 KB/s`, `512 KB/s`, `12.3 MB/s` — Task Manager's disk speeds. */
export function formatBytesRate(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB/s`;
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MB/s`;
}

/** `0 Kbps`, `120 Kbps`, `8.4 Mbps`, `1.2 Gbps` — Task Manager's network speeds, in bits. */
export function formatBits(bits: number): string {
  if (bits < 1000 * 1000) {
    return `${Math.round(bits / 1000)} Kbps`;
  }
  if (bits < 1000 ** 3) {
    return `${(bits / 1000 ** 2).toFixed(1)} Mbps`;
  }
  return `${(bits / 1000 ** 3).toFixed(1)} Gbps`;
}

/** `3:04:05:09` — days, hours, minutes and seconds, as Task Manager shows how long the machine has been up. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const rest = [Math.floor((seconds % 86_400) / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)];
  return [String(days), ...rest.map((part) => String(part).padStart(2, '0'))].join(':');
}
