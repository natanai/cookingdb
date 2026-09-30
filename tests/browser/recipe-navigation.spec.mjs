import { test, expect } from '@playwright/test';
import { userClick } from './journey-helpers.mjs';

test('a stalled background preload cannot trap a recipe click on the cookbook', async ({ page }) => {
  let releaseWarmup;
  let warmupStalled = false;
  const heldWarmup = new Promise(resolve => { releaseWarmup = resolve; });

  await page.route('**/built/nutrition-coverage.json*', async route => {
    if (new URL(page.url()).pathname.endsWith('/index.html')) {
      warmupStalled = true;
      await heldWarmup;
      await route.abort().catch(() => {}); // Navigation may already have cancelled it.
    } else {
      await route.continue();
    }
  });

  try {
    await page.goto('/index.html');
    const recipe = page.locator('#recipe-list a[href*="recipe.html?"]').first();
    await expect(recipe).toBeVisible();
    await expect.poll(() => warmupStalled).toBe(true);
    // Keep the preload unresolved until AFTER navigation and rendering. A
    // regression that awaits all warm resources cannot pass this test.
    await userClick(recipe, 'first cookbook recipe');
    await expect(page).toHaveURL(/\/recipe\.html\?id=/, { timeout: 2500 });
    await expect(page.locator('#ingredients-list li').first()).toBeVisible();
    await expect(page.locator('#steps-list li').first()).toBeVisible();
  } finally {
    releaseWarmup();
  }
});
