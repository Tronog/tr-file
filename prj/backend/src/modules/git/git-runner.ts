import { spawn } from 'node:child_process';

import { HttpError, type Logger } from '../../core/index.js';

/** What one run of git left behind. */
export interface GitOutput {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly code: number;
  /** `stdout` was cut at `maxBytes`. */
  readonly truncated: boolean;
}

export interface GitRunOptions {
  readonly timeoutMs: number;
  /** Written to git's standard input — a commit message, for `commit -F -`. */
  readonly input?: string;
  /** Exit codes that are answers, not failures: `diff --no-index` exits `1` when files differ. */
  readonly accept?: readonly number[];
  /** Keep at most this much of standard output; the rest is dropped. */
  readonly maxBytes?: number;
  /**
   * A read that must not take git's locks — `status` would otherwise refresh
   * the index, and a status polled while a commit runs would make it fail.
   */
  readonly read?: boolean;
}

/** What is kept of an error's output: enough to say why, not a screenful. */
const MAX_STDERR = 64 * 1024;

/**
 * Variables of the server's own environment that would point git somewhere
 * other than the repository it is run in.
 */
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX'];

/**
 * Runs the `git` program (PRD 011, §1). Never through a shell: the arguments
 * go to git one by one, so a file or branch name is only ever a name.
 *
 * Nothing it runs may wait for a person. Standard input is closed (or holds
 * the one thing git reads from it), `GIT_TERMINAL_PROMPT=0` stops git asking
 * for a password, and on POSIX git runs in a session of its own, with no
 * terminal, so `ssh` has none to ask on either — a push that needs a password
 * the system's credential helper or agent does not have fails, and says so,
 * rather than hanging. Every run has a deadline, after which it is killed.
 */
export class GitRunner {
  constructor(
    private readonly logger: Logger,
    private readonly binary = 'git',
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** `2.46.0`, or `null` when there is no git to run. */
  async version(): Promise<string | null> {
    try {
      const output = await this.run(process.cwd(), ['--version'], { timeoutMs: 10_000 });
      return /(\d+\.\d+(?:\.\d+)?)/.exec(output.stdout.toString('utf8'))?.[1] ?? null;
    } catch (error) {
      this.logger.debug('git not available', { reason: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Runs `git <args>` in `cwd`. Rejects with `GIT_UNAVAILABLE` when there is
   * no git, `GIT_TIMEOUT` past the deadline, and `GIT_FAILED` — git's own
   * words — when it exits with a code `accept` does not name.
   */
  run(cwd: string, args: readonly string[], options: GitRunOptions): Promise<GitOutput> {
    const startedAt = performance.now();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      // Git's own askpass would open a window, on some desktops, for a push nobody is watching.
      GCM_INTERACTIVE: 'never',
      ...(options.read ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
    };
    for (const name of REPOSITORY_VARIABLES) {
      delete env[name];
    }
    const posix = this.platform !== 'win32';

    return new Promise<GitOutput>((resolve, reject) => {
      const child = spawn(this.binary, ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
        cwd,
        env,
        stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Its own session: no controlling terminal for ssh to prompt on, and a
        // process group that a timeout can kill whole — ssh included.
        detached: posix,
      });

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      let stderr = '';
      let timedOut = false;
      const limit = options.maxBytes ?? Number.POSITIVE_INFINITY;

      const kill = (): void => {
        try {
          if (posix && child.pid !== undefined) {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (size >= limit) {
          truncated = true;
          return;
        }
        const room = limit - size;
        if (chunk.length > room) {
          chunks.push(chunk.subarray(0, room));
          size = limit;
          truncated = true;
          // Nothing more is wanted: a diff of a huge file need not be written out whole.
          kill();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR) {
          stderr += chunk.toString('utf8');
        }
      });
      if (options.input !== undefined) {
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(options.input, 'utf8');
      }

      child.once('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          error.code === 'ENOENT'
            ? new HttpError(503, 'GIT_UNAVAILABLE', 'Git is not installed on this computer')
            : new HttpError(500, 'GIT_FAILED', `Could not run git: ${error.message}`),
        );
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        const exit = code ?? -1;
        this.logger.debug('git', {
          args: args.slice(0, 3).join(' '),
          code: exit,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
        });
        if (timedOut) {
          reject(new HttpError(504, 'GIT_TIMEOUT', `git ${args[0] ?? ''} took too long and was stopped`));
          return;
        }
        const output: GitOutput = { stdout: Buffer.concat(chunks), stderr, code: exit, truncated };
        // Cut short on purpose: what was kept is the answer.
        if (truncated || exit === 0 || (options.accept ?? []).includes(exit)) {
          resolve(output);
          return;
        }
        reject(new HttpError(422, 'GIT_FAILED', GitRunner.explain(stderr, output.stdout, args[0] ?? 'git')));
      });
    });
  }

  /**
   * Git's reason, without its advice: `error:` and `fatal:` lines first,
   * `hint:` lines left out — they tell someone at a terminal what to type.
   */
  static explain(stderr: string, stdout: Buffer, command: string): string {
    const lines = `${stderr}\n${stdout.toString('utf8')}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('hint:'));
    const reasons = lines.filter((line) => /^(error|fatal):/i.test(line)).map((line) => line.replace(/^(error|fatal):\s*/i, ''));
    const chosen = (reasons.length > 0 ? reasons : lines).slice(0, 6).join('\n');
    return chosen === '' ? `git ${command} failed` : chosen.length > 2000 ? `${chosen.slice(0, 2000)}…` : chosen;
  }
}
