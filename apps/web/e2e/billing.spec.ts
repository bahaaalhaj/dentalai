import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Server } from 'node:http';
import {
  createSchedulingFixture,
  fixturePassword,
} from '../../api/test/support/scheduling-fixture.js';
const origin = 'http://localhost:15402';
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>, server: Server;
test.beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Disposable PostgreSQL DATABASE_URL required.');
  fixture = await createSchedulingFixture(url, origin, (app) => {
    const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    app.use(express.static(webDist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  });
  server = await new Promise<Server>((resolve, reject) => {
    const running = fixture.app.listen(15402, 'localhost', () => resolve(running));
    running.once('error', reject);
  });
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  if (fixture) await fixture.dispose();
});
async function login(page: Page, role: string) {
  await page.goto(`${origin}/login`);
  await page.locator('input[type=email]').fill(`${role}@example.test`);
  await page.locator('input[type=password]').fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page
    .getByRole('link', {
      name: role === 'patient' ? 'Your invoices and receipts' : 'Clinic billing',
      exact: true,
    })
    .click();
}
async function confirm(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByLabel('Financial change reason').fill('Fictional browser test');
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/billing/invoices/'),
  );
  await dialog.getByRole('button', { name: 'Confirm financial action' }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
  await expect(dialog).not.toBeVisible();
}
test('owner issues a snapshot, staff records payment, owner refunds, patient reads own receipts', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext(),
    staffContext = await browser.newContext(),
    patientContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage(),
      staff = await staffContext.newPage(),
      patient = await patientContext.newPage();
    await login(owner, 'clinic_owner');
    await owner.getByLabel('Service code').fill('FICTIONAL');
    await owner.getByLabel('Service name').fill('Fictional E2E service');
    await owner.getByLabel('Pricing reason').fill('Fictional pricing');
    await owner.getByRole('button', { name: 'Create service', exact: true }).click();
    await owner.getByLabel('Price for Fictional E2E service').fill('100.00');
    await owner.getByLabel('Price list name').fill('Fictional E2E prices');
    await owner.getByRole('button', { name: 'Publish price snapshot' }).click();
    await expect(owner.getByText('Fictional E2E prices · USD', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'New invoice', exact: true }).click();
    await owner.getByLabel('Invoice patient', { exact: true }).selectOption(fixture.patientId);
    await owner
      .getByLabel('Price list', { exact: true })
      .selectOption({ label: 'Fictional E2E prices · USD' });
    await owner
      .getByLabel('Line 1 service', { exact: true })
      .selectOption({ label: 'Fictional E2E service · $100.00' });
    await owner.getByLabel('Draft change reason').fill('Fictional invoice');
    await owner.getByRole('button', { name: 'Save invoice draft' }).click();
    const option = owner.getByRole('option').filter({ hasText: /INV-.*Draft/ });
    await expect(option).toHaveCount(1);
    const invoiceId = await option.getAttribute('value');
    expect(invoiceId).toBeTruthy();
    await owner.getByLabel('Invoice', { exact: true }).selectOption(invoiceId!);
    await owner.getByRole('button', { name: 'Issue invoice', exact: true }).click();
    await confirm(owner, 'Issue invoice');
    await login(staff, 'receptionist');
    await staff.getByLabel('Invoice', { exact: true }).selectOption(invoiceId!);
    await staff.getByRole('button', { name: 'Record payment', exact: true }).click();
    await staff.getByRole('dialog').getByLabel('Amount in USD').fill('25.00');
    await confirm(staff, 'Payment invoice');
    await expect(staff.getByText(/Recorded receipt: REC-/)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Refund payment' })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Refresh billing', exact: true }).click();
    await expect(owner.getByText(/Remaining \$75.00/)).toBeVisible();
    await owner.getByRole('button', { name: 'Refund payment', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'Refund invoice' });
    await dialog.getByLabel('Amount in USD').fill('5.00');
    const paymentOption = dialog.getByRole('option').filter({ hasText: /REC-/ });
    await expect(paymentOption).toHaveCount(1);
    await dialog
      .getByLabel('Original payment')
      .selectOption((await paymentOption.getAttribute('value'))!);
    await confirm(owner, 'Refund invoice');
    await expect(owner.getByText(/Recorded receipt: REF-/)).toBeVisible();
    await login(patient, 'patient');
    await patient.getByLabel('Invoice', { exact: true }).selectOption(invoiceId!);
    await expect(patient.getByText(/Remaining \$80.00/)).toBeVisible();
    await patient.getByText('Financial history and receipts', { exact: true }).click();
    await expect(patient.getByText(/REC-/).first()).toBeVisible();
    await expect(patient.getByText(/REF-/).first()).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await expect(patient.getByRole('button', { name: 'Adjust invoice' })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await staffContext.close();
    await patientContext.close();
  }
});
