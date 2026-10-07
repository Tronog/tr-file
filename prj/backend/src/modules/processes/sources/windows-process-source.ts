import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { Logger } from '../../../core/index.js';
import type { ProcessCategory, ProcessSource, ProcessStatus, RawAdapter, RawProcess } from '../processes.model.js';
import { WINDOWS_SAMPLER_SCRIPT } from './windows-sampler.ps1.js';

/** Compiling the C# takes a few seconds the first time; a sample, well under one. */
const READY_TIMEOUT_MS = 60_000;
const SAMPLE_TIMEOUT_MS = 15_000;

/** One row of the sampler's answer, in the order `WINDOWS_SAMPLER_SCRIPT` writes it. */
type Row = [
  pid: number,
  ppid: number,
  name: string,
  path: string | null,
  command: string | null,
  user: string | null,
  title: string | null,
  status: ProcessStatus,
  category: ProcessCategory,
  cpuMs: number,
  memory: number,
  ioRead: number,
  ioWrite: number,
  threads: number,
  started: number,
];

interface Pending {
  readonly resolve: (line: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Every process of a Windows machine (PRD 014, §1), measured by one hidden
 * PowerShell kept running beside the backend (`WINDOWS_SAMPLER_SCRIPT`): it
 * costs a compile once and almost nothing per sample, needs nothing
 * installed, and leaves the desktop's single-file bundle as it is.
 *
 * The script is written to the temp folder and run by a one-line command
 * that reads it, so a machine whose policy refuses unsigned script *files*
 * still runs it. A PowerShell that dies is started again at the next sample.
 */
export class WindowsProcessSource implements ProcessSource {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private readonly waiting: Pending[] = [];
  private closed = false;
  /** The adapters the last sample read, given out by `adapters`. */
  private lastAdapters: readonly RawAdapter[] = [];
  /** The script, written to the temp folder once. */
  private script: Promise<string> | null = null;

  constructor(private readonly logger: Logger) {}

  async sample(): Promise<readonly RawProcess[]> {
    if (this.closed) {
      return [];
    }
    await this.start();
    const line = await this.ask();
    const parsed = JSON.parse(line) as { p: Row[]; n: [string, number, number][] } | { error: string };
    if ('error' in parsed) {
      throw new Error(parsed.error);
    }
    this.lastAdapters = parsed.n.map(([name, received, sent]) => ({ name, received, sent }));
    return parsed.p.map(
      ([pid, ppid, name, path, command, user, title, status, category, cpuMs, memory, ioRead, ioWrite, threads, started]): RawProcess => ({
        pid,
        ppid,
        name,
        path,
        command,
        user,
        title,
        status,
        category,
        cpuMs,
        memory,
        ioRead,
        ioWrite,
        threads,
        started: started === 0 ? null : started,
      }),
    );
  }

  async adapters(): Promise<readonly RawAdapter[]> {
    return this.lastAdapters;
  }

  close(): void {
    this.closed = true;
    this.stop(new Error('The process sampler was closed.'));
  }

  private start(): Promise<void> {
    if (this.ready !== null) {
      return this.ready;
    }
    this.ready = this.launch().catch((error: unknown) => {
      this.script = null;
      this.stop(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
    return this.ready;
  }

  private async launch(): Promise<void> {
    this.script ??= WindowsProcessSource.writeScript();
    const script = await this.script;
    const bootstrap = `. ([ScriptBlock]::Create([IO.File]::ReadAllText('${script.replace(/'/g, "''")}')))`;
    const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'pipe' },
    );
    this.child = child;

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once('exit', (code) => {
      if (this.child === child) {
        this.logger.warn('process sampler exited', { code, stderr: stderr.trim() });
        this.stop(new Error(stderr.trim() || `The process sampler exited (${String(code)}).`));
      }
    });
    child.once('error', (error) => {
      if (this.child === child) {
        this.stop(error);
      }
    });

    const lines = createInterface({ input: child.stdout });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The process sampler did not start.')), READY_TIMEOUT_MS);
      let started = false;
      lines.on('line', (line) => {
        if (!started) {
          if (line.trim() === 'ready') {
            started = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        const pending = this.waiting.shift();
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pending.resolve(line);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(stderr.trim() || 'The process sampler exited before it was ready.'));
      });
    });
    this.logger.debug('process sampler ready', { pid: child.pid });
  }

  private ask(): Promise<string> {
    const child = this.child;
    if (child === null) {
      return Promise.reject(new Error('The process sampler is not running.'));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A sampler that stops answering is replaced rather than waited on.
        this.stop(new Error('The process sampler stopped answering.'));
      }, SAMPLE_TIMEOUT_MS);
      this.waiting.push({ resolve, reject, timer });
      child.stdin.write('sample\n');
    });
  }

  private static async writeScript(): Promise<string> {
    const script = join(await mkdtemp(join(tmpdir(), 'tr-file-processes-')), 'sampler.ps1');
    await writeFile(script, WINDOWS_SAMPLER_SCRIPT, 'utf8');
    return script;
  }

  /** Ends the PowerShell, failing whatever waited on it; the next sample starts another. */
  private stop(error: Error): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    for (const pending of this.waiting.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    if (child !== null && child.exitCode === null) {
      child.stdin.end();
      child.kill();
    }
  }
}
