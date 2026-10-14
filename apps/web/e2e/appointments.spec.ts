import { navigateWorkspace } from './navigation.js';
import { test, expect } from '@playwright/test';
import { accessibilitySmoke } from './accessibility.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Server } from 'node:http';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
import { addCalendarDays, clinicToday, localDateWindow } from '@dentalai/domain';

const origin = 'http://localhost:15400';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>;
let server: Server;
test.beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url)
    throw new Error('DATABASE_URL must point to disposable PostgreSQL for real browser E2E tests.');
  fixture = await createSchedulingFixture(url, origin, (app) => {
    const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    app.use(express.static(webDist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_request, response) =>
      response.sendFile(path.join(webDist, 'index.html')),
    );
  });
  server = await new Promise<Server>((resolve, reject) => {
    const running = fixture.app.listen(15400, 'localhost', () => resolve(running));
    running.once('error', reject);
  });
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (fixture) await fixture.dispose();
});

test('patient books; staff confirms; patient sees confirmation and cancels with retained history', async ({
  browser,
}) => {
  const patient = await browser.newContext();
  const page = await patient.newPage();
  await page.goto(`${origin}/login`);
  await page.locator('input[type=email]').fill('patient@example.test');
  await page.locator('input[type=password]').fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await navigateWorkspace(page, 'Appointments and calendar');
  await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Book appointment' });
  await expect(dialog).toBeVisible();
  await accessibilitySmoke(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await expect(dialog).toBeVisible();
  const date = addCalendarDays(clinicToday('Asia/Baghdad'), 1);
  await dialog.getByLabel('Booking date').fill(date);
  const closureWindow = localDateWindow(date, 'Asia/Baghdad');
  const closure = await fixture.database.pool.query<{ id: string }>(
    "INSERT INTO clinic_closures(clinic_id,location_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4,'Fictional browser-test closure') RETURNING id",
    [fixture.clinicId, fixture.locationId, closureWindow.startsAt, closureWindow.endsAt],
  );
  await dialog.getByRole('button', { name: 'Search availability' }).click();
  await expect(dialog.getByRole('status')).toContainText('No available slots');
  await fixture.database.pool.query('UPDATE clinic_closures SET active=false WHERE id=$1', [
    closure.rows[0]!.id,
  ]);
  await dialog.getByRole('button', { name: 'Search availability' }).click();
  await dialog.getByRole('radio').first().check();
  await dialog.getByRole('button', { name: 'Book selected time' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staff.goto(`${origin}/login`);
  await staff.locator('input[type=email]').fill('dentist@example.test');
  await staff.locator('input[type=password]').fill(fixturePassword);
  await staff.getByRole('button', { name: 'Sign In', exact: true }).click();
  await navigateWorkspace(staff, 'Appointments and calendar');
  await expect(staff.getByRole('heading', { name: 'Clinic calendar' })).toBeVisible();
  await staff.getByLabel('Calendar date').fill(date);
  await staff.getByRole('button', { name: 'Confirm', exact: true }).click();
  const confirmation = staff.getByRole('dialog', { name: 'Confirm appointment' });
  await confirmation.getByRole('button', { name: 'Apply change' }).click();
  await expect(staff.getByText('Confirmed', { exact: true })).toBeVisible();
  await accessibilitySmoke(staff);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancellation = page.getByRole('dialog', { name: 'Cancel appointment' });
  await cancellation.getByLabel('Reason').fill('Fictional patient cancellation');
  await cancellation.getByRole('button', { name: 'Apply change' }).click();
  await expect(cancellation).not.toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Audit trail' }).click();
  await expect(
    page.getByRole('dialog').getByText('appointment.confirmed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('appointment.cancelled', { exact: true }),
  ).toBeVisible();
  await patient.close();
  await staffContext.close();
});
