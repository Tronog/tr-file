import type { ProcessSeriesDto } from './processes.model.js';

/**
 * The last `capacity` samples of one series of numbers — CPU, memory and disk
 * — in fixed arrays written round, so keeping ten minutes of every process
 * allocates once per process and never again. A disk not seen is `NaN` inside
 * and `null` out.
 */
export class SampleRing {
  private readonly cpu: Float32Array;
  private readonly memory: Float64Array;
  private readonly disk: Float64Array;
  private next = 0;
  private length = 0;

  constructor(private readonly capacity: number) {
    this.cpu = new Float32Array(capacity);
    this.memory = new Float64Array(capacity);
    this.disk = new Float64Array(capacity);
  }

  get count(): number {
    return this.length;
  }

  push(cpu: number, memory: number, disk: number | null): void {
    this.cpu[this.next] = cpu;
    this.memory[this.next] = memory;
    this.disk[this.next] = disk ?? Number.NaN;
    this.next = (this.next + 1) % this.capacity;
    this.length = Math.min(this.length + 1, this.capacity);
  }

  /** Oldest first; with `last`, only that many of the newest. */
  series(last = this.length): ProcessSeriesDto {
    const cpu: number[] = [];
    const memory: number[] = [];
    const disk: (number | null)[] = [];
    const count = Math.min(this.length, Math.max(0, last));
    const start = (this.next - count + this.capacity) % this.capacity;
    for (let index = 0; index < count; index += 1) {
      const at = (start + index) % this.capacity;
      cpu.push(Math.round((this.cpu[at] ?? 0) * 10) / 10);
      memory.push(this.memory[at] ?? 0);
      const bytes = this.disk[at] ?? Number.NaN;
      disk.push(Number.isNaN(bytes) ? null : bytes);
    }
    return { cpu, memory, disk };
  }
}

/** The last `capacity` values of one number, written round; `null` is kept as `NaN` and given back as `null`. */
export class ValueRing {
  private readonly values: Float64Array;
  private next = 0;
  private length = 0;

  constructor(private readonly capacity: number) {
    this.values = new Float64Array(capacity);
  }

  push(value: number | null): void {
    this.values[this.next] = value ?? Number.NaN;
    this.next = (this.next + 1) % this.capacity;
    this.length = Math.min(this.length + 1, this.capacity);
  }

  /** Oldest first, rounded to `decimals`; with `last`, only that many of the newest. */
  series(decimals = 0, last = this.length): (number | null)[] {
    const scale = 10 ** decimals;
    const out: (number | null)[] = [];
    const count = Math.min(this.length, Math.max(0, last));
    const start = (this.next - count + this.capacity) % this.capacity;
    for (let index = 0; index < count; index += 1) {
      const value = this.values[(start + index) % this.capacity] ?? Number.NaN;
      out.push(Number.isNaN(value) ? null : Math.round(value * scale) / scale);
    }
    return out;
  }

  /** Oldest first, a value never seen as `0`. */
  numbers(decimals = 0, last?: number): number[] {
    return this.series(decimals, last).map((value) => value ?? 0);
  }
}
