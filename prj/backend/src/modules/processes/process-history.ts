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

  /** Oldest first. */
  series(): ProcessSeriesDto {
    const cpu: number[] = [];
    const memory: number[] = [];
    const disk: (number | null)[] = [];
    const start = (this.next - this.length + this.capacity) % this.capacity;
    for (let index = 0; index < this.length; index += 1) {
      const at = (start + index) % this.capacity;
      cpu.push(Math.round((this.cpu[at] ?? 0) * 10) / 10);
      memory.push(this.memory[at] ?? 0);
      const bytes = this.disk[at] ?? Number.NaN;
      disk.push(Number.isNaN(bytes) ? null : bytes);
    }
    return { cpu, memory, disk };
  }
}
