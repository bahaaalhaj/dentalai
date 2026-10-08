import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { drainServer } from '../../src/infrastructure/shutdown.js';

describe('server shutdown', () => {
  it('keeps database resources open until in-flight HTTP requests finish', async () => {
    let received: () => void = () => {};
    let respond: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    const server = createServer((_request, response) => {
      respond = () => response.end('ok');
      received();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');
    const request = get(`http://127.0.0.1:${address.port}`, { agent: false }, (response) =>
      response.resume(),
    );
    request.on('error', () => {});
    const closeResources = vi.fn(async () => {});
    try {
      await started;
      const draining = drainServer(server, closeResources, 1000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResources).not.toHaveBeenCalled();
      respond();
      await draining;
      expect(closeResources).toHaveBeenCalledOnce();
    } finally {
      request.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
  it('closes the listener and registered resources and clears its deadline', async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const closeResources = vi.fn(async () => {});
    await drainServer(server, closeResources, 1000);
    expect(closeResources).toHaveBeenCalledOnce();
    expect(server.listening).toBe(false);
  });
  it('enforces the deadline and destroys hung HTTP connections', async () => {
    let received: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    const server = createServer(() => {
      received();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test listener.');
    const request = get(`http://127.0.0.1:${address.port}`);
    const failed = once(request, 'error');
    try {
      await started;
      await expect(drainServer(server, async () => {}, 50)).rejects.toThrow('timed out');
      await failed;
      expect(server.listening).toBe(false);
    } finally {
      request.destroy();
      server.closeAllConnections();
    }
  });
});
