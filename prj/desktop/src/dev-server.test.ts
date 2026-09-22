import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { describe, it } from 'node:test';

import { waitForDevServer } from './dev-server.js';

/** A stand-in for `ng serve`: anything that answers HTTP will do. */
function listen(): Promise<{ url: URL; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><app-root></app-root>');
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('The test server bound to a non-TCP address.');
      }
      resolve({ url: new URL(`http://127.0.0.1:${address.port}/`), server });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('waitForDevServer', () => {
  it('reports a server that is already up', async () => {
    const { url, server } = await listen();
    try {
      assert.equal(await waitForDevServer(url, { timeoutMs: 2_000, intervalMs: 50 }), true);
    } finally {
      await close(server);
    }
  });

  /** `ng serve` and the shell start together, so the wait is the whole point. */
  it('keeps asking until one appears', async () => {
    const { url, server } = await listen();
    await close(server);

    let late: Server | null = null;
    const started = setTimeout(() => {
      const replacement = createServer((_request, response) => response.end('ok'));
      replacement.listen(Number(url.port), '127.0.0.1');
      late = replacement;
    }, 250);

    try {
      assert.equal(await waitForDevServer(url, { timeoutMs: 5_000, intervalMs: 50 }), true);
    } finally {
      clearTimeout(started);
      if (late !== null) {
        await close(late);
      }
    }
  });

  /** A missing dev server is recovered from, not thrown: the window still opens. */
  it('gives up rather than failing when nothing answers', async () => {
    const { url, server } = await listen();
    await close(server);

    assert.equal(await waitForDevServer(url, { timeoutMs: 300, intervalMs: 50 }), false);
  });
});
