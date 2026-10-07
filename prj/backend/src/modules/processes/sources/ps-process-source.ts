import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import type { ProcessSource, ProcessStatus, RawProcess } from '../processes.model.js';

const run = promisify(execFile);

const STATES: Readonly<Record<string, ProcessStatus>> = {
  R: 'running',
  S: 'sleeping',
  I: 'idle',
  U: 'waiting',
  D: 'waiting',
  T: 'suspended',
  Z: 'zombie',
};

/**
 * Every process of a machine that is neither Linux nor Windows — macOS and
 * the BSDs — from `ps` (PRD 014, §1). It tells less: no bytes moved, and a
 * resident size rather than a private one. The account the backend runs as
 * has its processes as *Apps* when they lead their session; root's are the
 * system's.
 */
export class PsProcessSource implements ProcessSource {
  private readonly self = typeof process.getuid === 'function' ? process.getuid() : null;

  async sample(): Promise<readonly RawProcess[]> {
    const { stdout } = await run('ps', ['-axww', '-o', 'pid=,ppid=,uid=,user=,state=,rss=,time=,sess=,lstart=,comm='], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const processes: RawProcess[] = [];
    for (const line of stdout.split('\n')) {
      const parsed = this.parse(line);
      if (parsed !== null) {
        processes.push(parsed);
      }
    }
    return processes;
  }

  close(): void {
    // Nothing kept between samples.
  }

  /** `pid ppid uid user state rss time sess <lstart: 5 words> comm…`. */
  private parse(line: string): RawProcess | null {
    const words = line.trim().split(/\s+/);
    if (words.length < 14) {
      return null;
    }
    const [pid, ppid, uid, user, state, rss, time, sess] = words;
    const started = Date.parse(words.slice(8, 13).join(' '));
    const path = words.slice(13).join(' ');
    const owner = Number(uid);
    const leader = sess === pid;
    return {
      pid: Number(pid),
      ppid: Number(ppid),
      name: basename(path),
      path: path.startsWith('/') ? path : null,
      command: null,
      user: user ?? null,
      title: null,
      status: STATES[state?.[0] ?? 'S'] ?? 'running',
      category: owner === this.self && leader ? 'app' : owner === 0 ? 'system' : 'background',
      cpuMs: PsProcessSource.cpuMs(time ?? '0'),
      memory: Number(rss) * 1024,
      ioRead: null,
      ioWrite: null,
      threads: null,
      started: Number.isNaN(started) ? null : started,
    };
  }

  /** `[[dd-]hh:]mm:ss[.cc]` in milliseconds. */
  private static cpuMs(time: string): number {
    const [days, rest] = time.includes('-') ? time.split('-') : ['0', time];
    const parts = (rest ?? '0').split(':').map(Number);
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return (Number(days) * 86_400 + seconds) * 1000;
  }
}
