import { test, expect } from '@playwright/test';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import sharp from 'sharp';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
import { FilesystemPrivateStorage } from '../../api/src/domains/imaging/filesystem-storage.js';

const origin = 'http://localhost:15403';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>, server: Server, directory: string;
test.beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Disposable PostgreSQL DATABASE_URL required');
  directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-browser-private-'));
  fixture = await createSchedulingFixture(
    url,
    origin,
    (app) => {
      const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
      app.use(express.static(dist));
      app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    },
    { storage: new FilesystemPrivateStorage(directory) },
  );
  server = await new Promise<Server>((resolve, reject) => {
    const running = fixture.app.listen(15403, 'localhost', () => resolve(running));
    running.once('error', reject);
  });
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('offline dentist upload uses private authorized storage, retains versions and produces no fake inference', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const external: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  try {
    const page = await context.newPage();
    const animationErrors: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /wasm|dotlottie|content security policy/i.test(message.text())
      )
        animationErrors.push(message.text());
    });
    const animation = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('.wasm'),
    );
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Welcome to DentalAi' })).toBeVisible();
    expect((await animation).status()).toBe(200);
    await expect
      .poll(async () =>
        page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
          const blank = document.createElement('canvas');
          blank.width = canvas.width;
          blank.height = canvas.height;
          return canvas.toDataURL() !== blank.toDataURL();
        }),
      )
      .toBe(true);
    expect(animationErrors).toEqual([]);
    await page.goto(`${origin}/login`);
    await page.locator('input[type=email]').fill('dentist@example.test');
    await page.locator('input[type=password]').fill(fixturePassword);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/dashboard`);
    await page.goto(`${origin}/imaging`);
    await expect(page.getByRole('heading', { name: 'Private X-ray studies' })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Patient', exact: true })
      .selectOption(fixture.patientId);
    await page
      .getByLabel('Reason for upload, analysis or review')
      .fill('Explicitly synthetic technical fixture');
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel('PNG/JPEG image (maximum 10 MiB)')
      .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer });
    await page.getByRole('button', { name: 'Upload as new study', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open private image' })).toHaveCount(1);
    const privatePath = await page
      .getByRole('link', { name: 'Open private image' })
      .getAttribute('href');
    expect(privatePath).toMatch(/^\/api\/v1\/imaging\/images\/.+\/content$/);
    expect((await context.request.get(`${origin}${privatePath}`)).status()).toBe(200);
    const anonymous = await browser.newContext();
    try {
      expect((await anonymous.request.get(`${origin}${privatePath}`)).status()).toBe(401);
    } finally {
      await anonymous.close();
    }
    await expect(
      page.getByRole('button', { name: 'Request experimental analysis' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Upload selected file as next version' }).click();
    await expect(page.getByRole('link', { name: 'Open private image' })).toHaveCount(2);
    await expect(page.getByText(/No findings will be generated/)).toBeVisible();
    expect(external).toEqual([]);
  } finally {
    await context.close();
  }
});
