import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import {
  developmentPolicy,
  developmentFrontendRequested,
  mountDevelopmentFrontend,
} from '../../src/infrastructure/development-frontend.js';
const vite = vi.hoisted(() => ({
  transform: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
}));
vi.mock('vite', () => ({ createServer: vite.create }));

describe('development-only frontend security policy', () => {
  it.each([
    { args: [], expected: false },
    { args: ['--api-only'], expected: false },
    { args: ['--production'], expected: false },
    { args: ['--with-vite'], expected: true },
    { args: ['--with-vite', '--api-only'], expected: false },
  ])('preserves CLI frontend mode precedence for $args', ({ args, expected }) => {
    expect(developmentFrontendRequested(args)).toBe(expected);
  });
  it('uses wss for exact HTTPS loopback and does not hash empty or external scripts', () => {
    const policy = developmentPolicy(
      "default-src 'self';script-src 'self'",
      '<script>   </script><script src="https://untrusted.example/script.js"></script>',
      'https://127.0.0.1:3000',
    );
    expect(policy).toContain("connect-src 'self' wss://127.0.0.1:3000");
    expect(policy).not.toContain('sha256-');
    expect(policy).not.toContain('untrusted.example');
  });
  async function fixture() {
    const app = express(),
      server = createServer();
    app.use(
      helmet({
        contentSecurityPolicy: { directives: { scriptSrc: ["'self'", "'wasm-unsafe-eval'"] } },
      }),
    );
    vite.transform.mockImplementation(async (_url: string, html: string) =>
      html.replace('</head>', '<script type="module">import "/@react-refresh";</script></head>'),
    );
    vite.create.mockResolvedValue({
      middlewares: (_req: unknown, _res: unknown, next: () => void) => next(),
      transformIndexHtml: vite.transform,
      close: vite.close,
    });
    const close = await mountDevelopmentFrontend(app, {
      nodeEnv: 'development',
      deploymentEnv: 'development',
      origin: 'http://localhost:3000',
      root: fileURLToPath(new URL('../../../web/', import.meta.url)),
      server,
    });
    return { app, server, close };
  }
  it('mounts the trusted HTML transform with parent-server HMR and preserves strict non-HTML headers', async () => {
    const { app, server, close } = await fixture();
    expect(vite.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appType: 'custom',
        server: { middlewareMode: true, hmr: { server } },
      }),
    );
    const html = await request(app).get('/login').expect(200);
    expect(html.text).toContain('/@react-refresh');
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.headers['content-security-policy']).toContain(
      "connect-src 'self' ws://localhost:3000",
    );
    const asset = await request(app).get('/missing.png').expect(404);
    expect(asset.headers['content-security-policy']).not.toContain('ws://');
    expect(asset.headers['content-security-policy']).toBe("default-src 'none'");
    await request(app).get('/api/not-implemented').expect(404);
    await request(app).get('/@private').expect(404);
    await close();
    expect(vite.close).toHaveBeenCalled();
  });
  it('passes transform failures to centralized error handling rather than serving partial HTML', async () => {
    const { app, close } = await fixture();
    vite.transform.mockRejectedValueOnce(new Error('Transform unavailable'));
    app.use(
      (
        _error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status(503).json({ error: 'FRONTEND_UNAVAILABLE' }),
    );
    const response = await request(app).get('/dashboard').expect(503);
    expect(response.body).toEqual({ error: 'FRONTEND_UNAVAILABLE' });
    await close();
  });
  it('fails closed when the base CSP is absent', async () => {
    const { app, close } = await fixture();
    // Express middleware order is fixed; a separate app proves absence is not silently accepted.
    const unsafe = express();
    const stop = await mountDevelopmentFrontend(unsafe, {
      nodeEnv: 'development',
      deploymentEnv: 'development',
      origin: 'http://localhost:3000',
      root: fileURLToPath(new URL('../../../web/', import.meta.url)),
      server: createServer(),
    });
    unsafe.use(
      (
        _error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.sendStatus(503),
    );
    await request(unsafe).get('/login').expect(503);
    await stop();
    await close();
    expect(app).toBeTruthy();
  });
  it('permits only the exact trusted inline preamble and same-origin HMR endpoint', () => {
    const preamble = 'import RefreshRuntime from "/@react-refresh";';
    const policy = developmentPolicy(
      "default-src 'self';script-src 'self';object-src 'none';upgrade-insecure-requests",
      `<script type="module">${preamble}</script><script src="/src/main.tsx"></script>`,
      'http://localhost:3000',
    );
    expect(policy).toContain(`'sha256-${createHash('sha256').update(preamble).digest('base64')}'`);
    expect(policy).toContain("connect-src 'self' ws://localhost:3000");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*|upgrade-insecure-requests/);
    expect(
      developmentPolicy("default-src 'self'", '<script>changed</script>', 'http://localhost:3000'),
    ).not.toContain(createHash('sha256').update(preamble).digest('base64'));
  });
  it.each([
    'https://example.com',
    'http://localhost:3000/path',
    'http://user@localhost:3000',
    'ftp://localhost:3000',
    'http://localhost:3000/',
  ])('rejects non-loopback or noncanonical origin %s', (origin) => {
    expect(() => developmentPolicy("default-src 'self'", '', origin)).toThrow();
  });
  it.each([
    ['production', 'production'],
    ['development', 'staging'],
    ['test', 'test'],
  ])('rejects Vite in %s/%s before mounting middleware', async (nodeEnv, deploymentEnv) => {
    await expect(
      mountDevelopmentFrontend(express(), {
        nodeEnv,
        deploymentEnv,
        origin: 'http://localhost:3000',
        root: '.',
        server: createServer(),
      }),
    ).rejects.toThrow('explicit development');
  });
});
