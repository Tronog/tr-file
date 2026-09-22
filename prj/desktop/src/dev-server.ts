import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

/** How long to keep asking before giving up on the dev server. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Pause between attempts; `ng serve` takes seconds, not milliseconds. */
const DEFAULT_INTERVAL_MS = 300;

/** How long one attempt may hang before it counts as a failure. */
const PROBE_TIMEOUT_MS = 1_000;

/** Knobs the tests need; the shell uses the defaults. */
export interface DevServerWaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

/**
 * Waits until an Angular dev server answers at `url`.
 *
 * `pnpm dev` starts `ng serve` and this shell at the same moment, so the
 * window is usually ready first — polling is the only honest way to find out
 * when the other half is up. Any HTTP response counts: what matters is that
 * something is listening and speaking HTTP, not what it thinks of `/`.
 *
 * Resolves `false` rather than throwing when the server never appears. A
 * missing dev server is a normal thing to recover from (the shell loads the
 * built bundle instead); it is not a reason to fail to open a window.
 */
export async function waitForDevServer(
  url: URL,
  options: DevServerWaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await probe(url)) {
      return true;
    }
    if (Date.now() + intervalMs >= deadline) {
      return false;
    }
    await delay(intervalMs);
  }
}

/** One request; `true` when anything answered it. */
function probe(url: URL): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (answered: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(answered);
      }
    };

    const request = (url.protocol === 'https:' ? httpsGet : httpGet)(url, (response) => {
      // The body is of no interest, but an unread response keeps the socket.
      response.resume();
      done(true);
    });

    request.setTimeout(PROBE_TIMEOUT_MS, () => {
      request.destroy();
      done(false);
    });
    request.on('error', () => done(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
