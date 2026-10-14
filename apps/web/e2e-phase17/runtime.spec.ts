import { test, expect } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createSchedulingFixture } from '../../api/test/support/scheduling-fixture.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const origin = 'http://localhost:15417';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>, child: ChildProcess | undefined;
let startup = '';
function stop() {
  if (!child?.pid) return;
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  // Kill only the process group created by this fixture, including npm's API child.
  else process.kill(-child.pid, 'SIGTERM');
  child = undefined;
}
function start(command: 'dev' | 'start') {
  const databaseUrl = fixture.database.pool.options.connectionString;
  if (!databaseUrl) throw Error('Disposable fixture URL missing');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'development',
    DEPLOYMENT_ENV: 'development',
    HOST: 'localhost',
    PORT: '15417',
    APP_ORIGIN: origin,
    AUTH_SECRET: fixture.authOptions.secret,
    MAIL_DRIVER: 'filesystem',
    PRIVATE_MAIL_DIRECTORY: path.join(root, '.local', 'phase17-runtime-mail'),
    CLINICAL_STORAGE_ENABLED: 'false',
    XRAY_INFERENCE_ENABLED: 'false',
    OUTBOX_WORKER_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  };
  for (const key of Object.keys(env))
    if (key.endsWith('_FILE')) delete (env as NodeJS.ProcessEnv)[key];
  startup = '';
  child =
    process.platform === 'win32'
      ? spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', `npm run ${command}`], {
          cwd: root,
          env,
          windowsHide: true,
        })
      : spawn('npm', ['run', command], { cwd: root, env, detached: true });
  child.stdout?.on('data', (chunk) => {
    startup += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    startup += String(chunk);
  });
}
async function ready() {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${origin}/login`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 180000, message: 'Owned runtime must start' },
    )
    .toBe(200);
  expect(startup).not.toContain('API failed to start');
}
test.beforeAll(async () => {
  test.setTimeout(180000); // Builds workspace packages and starts an owned runtime; test bodies remain 60s.
  const url = process.env['DATABASE_URL'];
  if (!url) throw Error('Disposable PostgreSQL required');
  fixture = await createSchedulingFixture(url, origin);
  start('dev');
  await ready();
});
test.afterAll(async () => {
  stop();
  await fixture?.dispose();
});

test('npm run dev loads React with exact development CSP and actual HMR updates', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|preamble/i.test(message.text()))
      errors.push(message.text());
  });
  const connected = page.waitForEvent('websocket');
  const response = await page.goto(`${origin}/login`);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  const socket = await connected;
  expect(new URL(socket.url()).origin).toBe('ws://localhost:15417');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self' ws://localhost:15417");
  expect(csp).toContain("'sha256-");
  expect(
    csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src')),
  ).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
  const moduleName = `.phase17-hmr-${randomUUID()}.ts`,
    filename = path.join(root, 'apps', 'web', moduleName);
  const module = (value: string) =>
    `document.documentElement.dataset.phase17Hmr=${JSON.stringify(value)}; if(import.meta.hot) import.meta.hot.accept();`;
  try {
    await writeFile(filename, module('before'), { flag: 'wx' });
    await page.evaluate(async (name) => {
      await import(`/${name}`);
    }, moduleName);
    await expect(page.locator('html')).toHaveAttribute('data-phase17-hmr', 'before');
    await writeFile(filename, module('after'));
    await expect(page.locator('html')).toHaveAttribute('data-phase17-hmr', 'after');
    expect(errors).toEqual([]);
    expect((await page.request.get(`${origin}/favicon.svg`)).status()).toBe(200);
  } finally {
    await unlink(filename);
  }
});
test('npm start serves the built application with strict script CSP and no development socket/hash', async ({
  page,
}) => {
  stop();
  start('start');
  await ready();
  const response = await page.goto(`${origin}/login`);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain('upgrade-insecure-requests');
  expect(csp).not.toMatch(/ws:|wss:|sha256-/);
  expect(
    csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src')),
  ).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
});
