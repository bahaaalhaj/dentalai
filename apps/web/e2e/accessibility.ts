import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function accessibilitySmoke(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
}
