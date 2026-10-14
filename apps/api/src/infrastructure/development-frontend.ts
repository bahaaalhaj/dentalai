import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Express } from 'express';

export function developmentFrontendRequested(args: readonly string[]): boolean {
  return args.includes('--with-vite') && !args.includes('--api-only');
}

export function developmentPolicy(policy: string, html: string, origin: string): string {
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.origin !== origin
  )
    throw new Error('Development frontend requires an explicit loopback origin.');
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]!) && match[2]!.trim())
    .map((match) => `'sha256-${createHash('sha256').update(match[2]!).digest('base64')}'`);
  const directives = policy
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(script-src|connect-src|upgrade-insecure-requests)(?:\s|$)/.test(part));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  directives.push(`script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`);
  directives.push(`connect-src 'self' ${url.origin}`);
  return directives.join('; ');
}

export async function mountDevelopmentFrontend(
  application: Express,
  options: {
    nodeEnv: string;
    deploymentEnv: string;
    origin: string;
    root: string;
    server: Server;
  },
): Promise<() => Promise<void>> {
  if (options.nodeEnv !== 'development' || options.deploymentEnv !== 'development')
    throw new Error('Vite frontend is permitted only in explicit development configuration.');
  developmentPolicy("script-src 'self'", '', options.origin);
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: options.root,
    configFile: path.join(options.root, 'vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: { server: options.server } },
  });
  application.use(vite.middlewares);
  application.get(/^\/(?!api(?:\/|$)|@).*$/, async (request, response, next) => {
    try {
      if (path.extname(request.path)) return next();
      const template = await readFile(path.join(options.root, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(request.originalUrl, template);
      const policy = response.getHeader('Content-Security-Policy');
      if (typeof policy !== 'string') throw new Error('Base security policy is missing.');
      response.setHeader(
        'Content-Security-Policy',
        developmentPolicy(policy, html, options.origin),
      );
      response.setHeader('Cache-Control', 'no-store');
      response.type('html').send(html);
    } catch (error) {
      next(error);
    }
  });
  return () => vite.close();
}
