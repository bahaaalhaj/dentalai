import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Server } from 'node:http';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
const origin = 'http://localhost:15401';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>;
let server: Server;
async function applyClinicalChange(page: Page, button: string, suffix: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/clinical/') &&
        response.url().endsWith(suffix),
    );
    await page.getByRole('button', { name: button, exact: true }).click();
    const response = await responsePromise;
    if (response.status() === 200) return;
    // Exercise an explicit user retry ONLY for the documented, rolled-back clock conflict.
    // Any validation, permission, server or transport failure fails immediately.
    expect(response.status(), await response.text()).toBe(409);
    expect((await response.json()).error.code).toBe('CLINICAL_CLOCK_CONFLICT');
    await expect(page.getByRole('alert').filter({ hasText: 'server clock' }).first()).toBeVisible();
    const observed = (
      await fixture.database.pool.query<{ value: string }>(
        'SELECT clock_timestamp()::text AS value',
      )
    ).rows[0]!.value;
    await expect
      .poll(
        async () =>
          (
            await fixture.database.pool.query<{ advanced: boolean }>(
              "SELECT clock_timestamp()>$1::timestamptz+interval '2 seconds' AS advanced",
              [observed],
            )
          ).rows[0]!.advanced,
        { timeout: 10000 },
      )
      .toBe(true);
  }
  throw new Error('Database clock did not stabilize after four explicit clinical retries.');
}
test.beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL must be disposable PostgreSQL.');
  fixture = await createSchedulingFixture(url, origin, (app) => {
    const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    app.use(express.static(webDist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  });
  server = await new Promise<Server>((resolve, reject) => {
    const running = fixture.app.listen(15401, 'localhost', () => resolve(running));
    running.once('error', reject);
  });
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  if (fixture) await fixture.dispose();
});
test('clinician explicitly records, approves and corrects; patient sees approved read-only history', async ({
  browser,
}) => {
  const patientContext = await browser.newContext();
  const dentistContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    const dentist = await dentistContext.newPage();
    for (const [page, email] of [
      [patient, 'patient@example.test'],
      [dentist, 'dentist@example.test'],
    ] as const) {
      await page.goto(`${origin}/login`);
      await page.locator('input[type=email]').fill(email);
      await page.locator('input[type=password]').fill(fixturePassword);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    }
    await patient.getByRole('link', { name: 'Approved clinical history', exact: true }).click();
    await expect(
      patient.getByText('No approved clinical information is available yet.'),
    ).toBeVisible();
    await dentist.getByRole('link', { name: 'Clinical patients', exact: true }).click();
    await dentist.getByLabel('Patient', { exact: true }).selectOption(fixture.patientId);
    await dentist.getByRole('button', { name: 'Start encounter', exact: true }).click();
    let dialog = dentist.getByRole('dialog', { name: 'Start encounter' });
    await dialog.getByLabel('Reason', { exact: true }).fill('Fictional E2E visit');
    await applyClinicalChange(dentist, 'Apply clinical change', '/encounters');
    await expect(dialog).not.toBeVisible();
    await dentist.getByRole('button', { name: 'Add clinical entry' }).click();
    await dentist
      .getByLabel('Clinical note', { exact: true })
      .fill('Fictional initial private note');
    await dentist.getByLabel('Clinical change reason').fill('Fictional initial note');
    await applyClinicalChange(dentist, 'Save draft', '/records');
    await expect(dentist.getByRole('form', { name: 'Clinical entry' })).toHaveCount(0);
    await expect(
      dentist.getByText('Fictional initial private note', { exact: true }).first(),
    ).toBeVisible();
    await patient.getByRole('button', { name: 'Refresh approved records' }).click();
    await expect(
      patient.getByText('No approved clinical information is available yet.'),
    ).toBeVisible();
    await expect(patient.getByText('Fictional initial private note')).toHaveCount(0);
    await dentist.getByRole('button', { name: 'Approve note', exact: true }).click();
    dialog = dentist.getByRole('dialog', { name: 'Approve clinical entry' });
    await dialog.getByLabel('Reason', { exact: true }).fill('Fictional note reviewed');
    await applyClinicalChange(dentist, 'Apply clinical change', '/review');
    await expect(dialog).not.toBeVisible();
    await patient.getByRole('button', { name: 'Refresh approved records' }).click();
    await expect(
      patient.getByText('Fictional initial private note', { exact: true }).first(),
    ).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await expect(patient.getByRole('button', { name: 'Approve note' })).toHaveCount(0);
    let clinicalWrites = 0;
    dentist.on('request', (req) => {
      if (req.url().includes('/api/v1/clinical/') && req.method() === 'POST') clinicalWrites++;
    });
    const tooth = dentist.getByRole('button', { name: 'Tooth 16: unrecorded', exact: true });
    await tooth.focus();
    await dentist.keyboard.press('Enter');
    await expect(dentist.getByLabel('FDI tooth number')).toHaveValue('16');
    expect(clinicalWrites).toBe(0);
    await dentist.getByLabel('Finding action').selectOption('caries');
    await dentist.getByLabel('O', { exact: true }).check();
    await dentist.getByLabel('Clinical change reason').fill('Fictional selected finding');
    await applyClinicalChange(dentist, 'Save draft', '/records');
    await dentist.getByRole('button', { name: 'Approve finding', exact: true }).click();
    dialog = dentist.getByRole('dialog', { name: 'Approve clinical entry' });
    await dialog.getByLabel('Reason', { exact: true }).fill('Fictional finding reviewed');
    await applyClinicalChange(dentist, 'Apply clinical change', '/review');
    await expect(dialog).not.toBeVisible();
    await dentist.getByRole('button', { name: 'Correct or transition note', exact: true }).click();
    await dentist.getByLabel('Clinical note', { exact: true }).fill('Fictional corrected note');
    await dentist.getByLabel('Clinical change reason').fill('Fictional correction explanation');
    await applyClinicalChange(dentist, 'Save draft', '/records');
    await patient.getByRole('button', { name: 'Refresh approved records' }).click();
    await expect(patient.getByText('Fictional corrected note')).toHaveCount(0);
    await expect(
      patient.getByText('Fictional initial private note', { exact: true }).first(),
    ).toBeVisible();
    await dentist.getByRole('button', { name: 'Approve note', exact: true }).click();
    dialog = dentist.getByRole('dialog', { name: 'Approve clinical entry' });
    await dialog.getByLabel('Reason', { exact: true }).fill('Fictional correction reviewed');
    await applyClinicalChange(dentist, 'Apply clinical change', '/review');
    await expect(dialog).not.toBeVisible();
    await patient.getByRole('button', { name: 'Refresh approved records' }).click();
    await expect(
      patient.getByText('Fictional corrected note', { exact: true }).first(),
    ).toBeVisible();
    await patient.getByText(/^Approved version history/).click();
    await expect(
      patient.getByText('Fictional initial private note', { exact: true }),
    ).toBeVisible();
    await expect(patient.getByLabel('Tooth 16: caries', { exact: true })).toBeVisible();
    await dentist.getByRole('button', { name: 'Close and sign encounter' }).click();
    dialog = dentist.getByRole('dialog', { name: 'Close encounter' });
    await dialog.getByLabel('Reason', { exact: true }).fill('Fictional encounter signed');
    await applyClinicalChange(dentist, 'Apply clinical change', '/close');
    await expect(dialog).not.toBeVisible();
    await expect(dentist.getByRole('button', { name: 'Add clinical entry' })).toHaveCount(0);
  } finally {
    await patientContext.close();
    await dentistContext.close();
  }
});
