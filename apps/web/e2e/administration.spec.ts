import { navigateWorkspace } from './navigation.js';
import { test, expect } from '@playwright/test';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Server } from 'node:http';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
const origin = 'http://localhost:15404';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>;
let server: Server;
test.beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Disposable PostgreSQL required.');
  fixture = await createSchedulingFixture(url, origin, (app) => {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    app.use(express.static(dist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  });
  server = await new Promise((resolve, reject) => {
    const started = fixture.app.listen(15404, 'localhost', () => resolve(started));
    started.once('error', reject);
  });
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (fixture) await fixture.dispose();
});
test('responsive illustrative assets and Arabic landing layout do not claim implemented reminders', async ({
  browser,
}) => {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }),
      page = await context.newPage();
    await page.goto(origin);
    await page.locator('section').nth(1).scrollIntoViewIfNeeded();
    const images = page.locator('img[src*=".webp"]');
    await expect(images).toHaveCount(8);
    await expect
      .poll(() => images.first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(images.first()).toHaveAttribute('loading', 'lazy');
    await expect(images.first()).toHaveAttribute('srcset', /320w.*640w/);
    await expect(
      page.getByText('Automated reminders and easy online booking for your convenience.'),
    ).toHaveCount(0);
    await page.evaluate(() => {
      localStorage.setItem('dentalai.locale', 'ar');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('section').nth(1).scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        images.evaluateAll((nodes) =>
          nodes.some((node) => {
            const img = node as HTMLImageElement,
              rect = img.getBoundingClientRect();
            return img.naturalWidth > 0 && rect.right > 0 && rect.left < window.innerWidth;
          }),
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `../../.local/phase16-landing-${width}-ar.png`, fullPage: true });
    await context.close();
  }
});
test('English owner dashboard and Arabic RTL remain usable; onboarding creates an isolated clinic', async ({
  browser,
}) => {
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    page = await owner.newPage();
  await page.goto(`${origin}/login`);
  await page.locator('input[type=email]').fill('clinic_owner@example.test');
  await page.locator('input[type=password]').fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await navigateWorkspace(page, 'Clinic administration');
  await expect(
    page.getByRole('heading', { name: 'Clinic administration', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Plan and usage', exact: true }).click();
  await expect(
    page.getByText('Administrative provider only. No payments are processed.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Language', { exact: true }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'إدارة العيادة', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('اللغة', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const context = await browser.newContext(),
    patient = await context.newPage();
  await patient.goto(`${origin}/login`);
  await patient.locator('input[type=email]').fill('patient2@example.test');
  await patient.locator('input[type=password]').fill(fixturePassword);
  await patient.getByRole('button', { name: 'Sign In', exact: true }).click();
  await patient.getByRole('link', { name: 'Set up a new clinic', exact: true }).click();
  await patient.getByLabel('Legal clinic name', { exact: true }).fill('Fictional browser clinic');
  await patient.getByLabel('Clinic display name', { exact: true }).fill('Fictional browser clinic');
  await patient
    .getByLabel('Unique clinic address', { exact: true })
    .fill('fictional-browser-clinic');
  await patient
    .getByLabel('First location name', { exact: true })
    .fill('Fictional browser location');
  await patient.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(patient.getByLabel('Default currency (no conversion)', { exact: true })).toHaveValue(
    'SYP',
  );
  await patient.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    patient.getByRole('button', { name: 'Create isolated clinic', exact: true }),
  ).toBeDisabled();
  await patient
    .getByLabel('I am authorized to administer this new clinic.', { exact: true })
    .check();
  await patient.getByRole('button', { name: 'Create isolated clinic', exact: true }).click();
  await expect(
    patient.getByRole('heading', { name: 'Clinic administration', exact: true }),
  ).toBeVisible();
  await expect(
    patient.getByText('Fictional browser clinic', { exact: true }).first(),
  ).toBeVisible();
  const response = await patient.request.get(`${origin}/api/v1/admin/overview`);
  expect(response.ok()).toBe(true);
  const overview = await response.json();
  expect(overview.configuration.clinicId).not.toBe(fixture.clinicId);
  expect(overview.members).toHaveLength(1);
  expect(overview.subscription.state).toBe('trial');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Clinic administration', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Fictional browser clinic', { exact: true })).toHaveCount(0);
  await context.close();
  await owner.close();
});
