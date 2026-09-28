import { test, expect } from '@playwright/test';
import { userClick } from './journey-helpers.mjs';

test('stalled ingredient lookup exposes retry and recovers without losing typed work', async ({ page }) => {
  test.setTimeout(45000);
  let release;
  let recover = false;
  let requests = 0;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/built/ingredient-autocomplete.json*', async route => {
    requests++;
    if (recover) return route.continue();
    await held;
    await route.abort().catch(() => {});
  });

  try {
    await page.goto('/add.html');
    await page.locator('#title').fill('Draft preserved through a lookup timeout');
    const row = page.locator('#ingredient-rows .ingredient-row').first();
    const name = row.locator('.ingredient-name');
    await name.fill('Acorn squash');
    await expect(row.getByText('Loading ingredients…', { exact: true })).toBeVisible();
    // Do not refocus or retype: the open menu must update on its own.
    const retry = row.getByRole('button', { name: 'Retry ingredient lookup', exact: true });
    await expect(retry).toBeVisible({ timeout: 25000 });
    expect(requests).toBe(2); // Initial attempt and one cache-bypassing retry.
    await expect(name).toHaveValue('Acorn squash');
    await expect(page.locator('#title')).toHaveValue('Draft preserved through a lookup timeout');

    recover = true;
    release();
    await userClick(retry, 'Retry ingredient lookup');
    const option = row.getByRole('option').filter({ hasText: 'Acorn squash' }).first();
    await userClick(option, 'recovered Acorn squash suggestion');
    await expect(row.locator('.ingredient-id')).toHaveValue('acorn-squash');
    await expect(page.locator('#title')).toHaveValue('Draft preserved through a lookup timeout');
    expect(requests).toBe(3);
  } finally {
    release();
  }
});
