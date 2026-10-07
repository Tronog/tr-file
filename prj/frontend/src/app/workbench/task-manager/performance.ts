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
 * the history the backend keeps (ten minutes, a sample every two seconds).
 *
 * Every series is fitted to its graph here: CPU and memory against their
 * whole, disk and network against a top rounded up from the busiest moment
 * shown (1, 2 or 5 of a power of ten), as Task Manager rescales its transfer
 * graphs. A span longer than what has been measured starts empty at the left.
 */
export function buildPerformance(input: PerformanceInput): UiPerformanceModel {
  const { snapshot, history, span } = input;
  const points = Math.max(2, Math.round((SPAN_SECONDS[span] * 1000) / Math.max(1, snapshot.intervalMs)));
  const window = <T>(values: readonly T[] | undefined): (T | null)[] => fit(values ?? [], points);
  const totals = history?.totals;
  const { totals: now, machine } = snapshot;

  const cpuValues = window(totals?.cpu).map((value) => (value === null ? null : value / 100));
  const memoryTotal = Math.max(1, totals?.memoryTotal ?? now.memoryTotal);
  const memoryValues = window(totals?.memory).map((value) => (value === null ? null : value / memoryTotal));
  const reads = window(totals?.diskRead);
  const writes = window(totals?.diskWrite);
  const diskTop = niceTop(Math.max(...[...reads, ...writes].map((value) => value ?? 0)), DISK_FLOOR);
  const diskSeries: UiPerfSeries[] = [
    { label: 'Read', values: scale(reads, diskTop) },
    { label: 'Write', values: scale(writes, diskTop), dashed: true },
  ];

  const memoryShare = now.memoryTotal === 0 ? 0 : (now.memoryUsed / now.memoryTotal) * 100;
  const resources: UiPerfResource[] = [
    {
      id: 'cpu',
      label: 'CPU',
      detail: `${Math.round(now.cpu)}%  ${formatSpeed(machine.cpuSpeedMhz)}`.trim(),
      hue: 'blue',
      thumbnail: [{ label: 'Utilization', values: cpuValues }],
    },
    {
      id: 'memory',
      label: 'Memory',
      detail: `${formatGb(now.memoryUsed)}/${formatGb(now.memoryTotal)} GB (${Math.round(memoryShare)}%)`,
      hue: 'purple',
      thumbnail: [{ label: 'In use', values: memoryValues }],
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
    const top = niceTop(Math.max(...[...sends, ...receives].map((value) => value ?? 0)), NETWORK_FLOOR_BITS);
    const lines: UiPerfSeries[] = [
      { label: 'Receive', values: scale(receives, top) },
      { label: 'Send', values: scale(sends, top), dashed: true },
    ];
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
        graphs: [{ id: 'memory', series: [{ label: 'In use', values: memoryValues }] }],
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
      page = cpuPage(input, cpuValues, window);
      break;
    default: {
      const shown = adapters.find((entry) => networkId(entry.adapter.name) === selectedId) ?? adapters[0];
      page =
        shown === undefined
          ? cpuPage(input, cpuValues, window)
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

function cpuPage(input: PerformanceInput, cpuValues: (number | null)[], window: <T>(values: readonly T[] | undefined) => (T | null)[]): UiPerfPage {
  const { snapshot, history, cpuView } = input;
  const { totals: now, machine } = snapshot;
  const cores = history?.totals.cores ?? [];
  const graphs: UiPerfGraph[] =
    cpuView === 'logical' && cores.length > 0
      ? cores.map((series, index) => ({
          id: `core-${index}`,
          label: `CPU ${index}`,
          series: [{ label: 'Utilization', values: window(series).map((value) => (value === null ? null : value / 100)) }],
        }))
      : [{ id: 'cpu', series: [{ label: 'Utilization', values: cpuValues }] }];
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

/** The last `points` values, the newest at the end; padded with `null` at the start when fewer were measured. */
export function fit<T>(values: readonly T[], points: number): (T | null)[] {
  const tail = values.slice(-points);
  return [...Array.from({ length: points - tail.length }, () => null), ...tail];
}

/** A graph's top is a round number, and says so: `1 Mbps`, not `1.0 Mbps`. */
function roundLabel(label: string): string {
  return label.replace(/\.0 /, ' ');
}

function scale(values: readonly (number | null)[], top: number): (number | null)[] {
  return values.map((value) => (value === null ? null : value / top));
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
