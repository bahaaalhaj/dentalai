import { expect, type Page } from '@playwright/test';
export async function navigateWorkspace(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(page.locator('.app-shell')).toBeVisible();
  if (await menu.isVisible()) {
    await menu.click();
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name, exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
  } else await page.locator('.ui-desktop-sidebar').getByRole('link', { name, exact: true }).click();
}
