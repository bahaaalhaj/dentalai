import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { AuthIdentitySchema } from '@dentalai/contracts';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import sharp from 'sharp';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
import { seedLocalDevelopment, developmentAccounts } from '../../api/src/development/seed.js';
import { FilesystemPrivateStorage } from '../../api/src/domains/imaging/filesystem-storage.js';
import { accessibilitySmoke } from '../e2e/accessibility.js';
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  origin = 'http://localhost:15419';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>, server: Server, directory: string;
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000); // Empty-database migrations and synthetic seeding only; test bodies remain 60s.
  const url = process.env['DATABASE_URL'];
  if (!url) throw Error('Disposable PostgreSQL required');
  directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-phase17-private-'));
  fixture = await createSchedulingFixture(
    url,
    origin,
    (app) => {
      const dist = path.join(root, 'apps', 'web', 'dist');
      app.use(express.static(dist));
      app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    },
    { storage: new FilesystemPrivateStorage(directory) },
  );
  const databaseUrl = fixture.database.pool.options.connectionString;
  if (!databaseUrl) throw Error('Fixture URL required');
  await seedLocalDevelopment(databaseUrl, fixturePassword, 'test');
  server = await new Promise((resolve, reject) => {
    const running = fixture.app.listen(15419, 'localhost', () => resolve(running));
    running.once('error', reject);
  });
  // These are real, opaque server sessions, not auth mocks. A visual viewport change
  // should restore a session instead of repeatedly submitting credentials to the
  // brute-force gate. The original authentication E2E and rate limits are unchanged.
  for (const role of [
    'clinic_owner',
    'clinic_admin',
    'dentist',
    'receptionist',
    'patient',
  ] as const) {
    const context = await browser.newContext();
    try {
      const csrf = await context.request.get(origin + '/api/v1/access/csrf');
      const body: unknown = await csrf.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('token' in body) ||
        typeof body.token !== 'string'
      )
        throw Error('CSRF response invalid');
      const email = developmentAccounts.find((account) => account.role === role)?.email;
      const response = await context.request.post(origin + '/api/v1/auth/sign-in/email', {
        headers: { origin, 'x-csrf-token': body.token },
        data: { email, password: fixturePassword },
      });
      expect(response.status()).toBe(200);
      const me = await context.request.get(origin + '/api/v1/access/me');
      expect(me.status()).toBe(200);
      expect(AuthIdentitySchema.parse(await me.json()).activeMembership?.roles).toContain(role);
      sessions.set(role, await context.storageState());
    } finally {
      await context.close();
    }
  }
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true }); // only this test's mkdtemp directory
});
async function capture(page: Page, name: string) {
  await expect(page.locator('.ui-empty-state[role=status]')).toHaveCount(0);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    await page.screenshot({
      path: path.join(root, '.local', 'phase17-screenshots', `${name}-overflow.png`),
      fullPage: true,
    });
    console.log(
      JSON.stringify(
        await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '.ui-card,.ui-tabs,.ui-tab-panel,.odontogram-scroll,.ui-encounter-context>label',
            ),
          ).map((element) => ({
            className: element.className,
            width: element.getBoundingClientRect().width,
            scroll: element.scrollWidth,
          })),
        ),
      ),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessibilitySmoke(page);
  await page.screenshot({
    path: path.join(root, '.local', 'phase17-screenshots', `${name}.png`),
    fullPage: true,
  });
}
for (const locale of ['en', 'ar'] as const)
  for (const width of [1280, 390]) {
    test(`approved public pages ${locale} ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } }),
        page = await context.newPage();
      await context.addInitScript(
        (language) => localStorage.setItem('dentalai.locale', language),
        locale,
      );
      try {
        for (const [route, name] of [
          ['/', 'landing'],
          ['/login', 'login'],
          ['/register', 'register'],
        ] as const) {
          await page.goto(origin + route);
          await expect(page.locator('h1')).toBeVisible();
          await page.screenshot({
            path: path.join(
              root,
              '.local',
              'phase17-screenshots',
              `${name}-${width}-${locale}.png`,
            ),
            fullPage: true,
          });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      } finally {
        await context.close();
      }
    });
    for (const role of [
      'clinic_owner',
      'clinic_admin',
      'dentist',
      'receptionist',
      'patient',
    ] as const) {
      test(`${role} ${locale} ${width} real-data layout and authorization`, async ({ browser }) => {
        const storageState = sessions.get(role);
        if (!storageState) throw Error('Authenticated fixture session missing');
        const context = await browser.newContext({
            viewport: { width, height: 900 },
            storageState,
          }),
          page = await context.newPage();
        await context.addInitScript(
          (language) => localStorage.setItem('dentalai.locale', language),
          locale,
        );
        try {
          const overviewReady = page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              new URL(response.url()).pathname ===
                (role === 'patient' ? '/api/v1/clinical/portal' : '/api/v1/billing/reports'),
          );
          await page.goto(origin + '/dashboard');
          await expect(page).toHaveURL(origin + '/dashboard');
          expect((await overviewReady).status()).toBe(200);
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            locale === 'ar' ? 'rtl' : 'ltr',
          );
          await expect(page.locator('.ui-metrics')).toBeVisible();
          await capture(page, `${role}-dashboard-${width}-${locale}`);
          if (width === 390) {
            await page.locator('.ui-menu-toggle').click();
            const drawer = page.locator('dialog.ui-mobile-drawer');
            await expect(drawer).toBeVisible();
            await accessibilitySmoke(page);
            await page.screenshot({
              path: path.join(
                root,
                '.local',
                'phase17-screenshots',
                `${role}-drawer-${width}-${locale}.png`,
              ),
            });
            await page.keyboard.press('Escape');
            await expect(drawer).toHaveCount(0);
          }
          for (const [route, name] of [
            ['/appointments', 'appointments'],
            [role === 'patient' ? '/billing/portal' : '/billing', 'billing'],
          ] as const) {
            await page.goto(origin + route);
            await expect(page.locator('main h1')).toBeVisible();
            if (name === 'billing') {
              const invoice = page.locator('main select').last();
              await expect(invoice.locator('option')).not.toHaveCount(1);
              await invoice.selectOption(
                (await invoice.locator('option').nth(1).getAttribute('value'))!,
              );
              await expect(page.locator('.ui-table tbody td').last()).toHaveCSS(
                'white-space',
                'nowrap',
              );
            }
            await capture(page, `${role}-${name}-${width}-${locale}`);
          }
          if (role === 'dentist') {
            await page.goto(
              origin + '/clinical/patients?patient=10000000-0000-4000-8000-000000000009&tab=chart',
            );
            await expect(page.locator('.tooth-button')).toHaveCount(52);
            await capture(page, `dentist-chart-${width}-${locale}`);
            await page.goto(origin + '/imaging');
            await page.locator('main select').selectOption('10000000-0000-4000-8000-000000000009');
            if (locale === 'en' && width === 1280) {
              await page
                .locator('main input[maxlength="500"]')
                .fill('Explicitly synthetic software fixture, not a patient X-ray');
              const buffer = await sharp({
                create: { width: 256, height: 128, channels: 3, background: '#334155' },
              })
                .png()
                .toBuffer();
              await page
                .locator('input[type=file]')
                .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer });
              await page.getByRole('button', { name: 'Upload as new study', exact: true }).click();
              await expect(page.locator('.ui-study-image img')).toHaveCount(1);
            }
            await expect(page.locator('main progress')).toHaveCount(0);
            await capture(page, `dentist-imaging-${width}-${locale}`);
          } else if (role === 'clinic_owner' || role === 'clinic_admin') {
            await page.goto(origin + '/administration');
            await expect(page.locator('input[type=color]')).toBeVisible();
            await capture(page, `${role}-administration-${width}-${locale}`);
          } else {
            if (role === 'patient') {
              await page.goto(origin + '/clinical/history');
              await expect(page.locator('.tooth-button')).toHaveCount(52);
              await expect(page.locator('form')).toHaveCount(0);
              await capture(page, `patient-history-${width}-${locale}`);
            }
            await page.goto(origin + '/imaging');
            await expect(page).toHaveURL(origin + '/dashboard');
            await page.goto(origin + '/clinical/patients');
            await expect(page).toHaveURL(origin + '/dashboard');
          }
        } finally {
          await context.close();
        }
      });
    }
  }
