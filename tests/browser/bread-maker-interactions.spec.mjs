import { test, expect } from '@playwright/test';
import { userClick } from './journey-helpers.mjs';

const STORAGE_KEY = 'cookingdb-bread-maker-recipes';

test('Bread Maker personal journal can save, persist notes, reload, and delete a recipe', async ({ page }) => {
  await page.goto('/bread-maker.html');

  await expect(page.locator('#bread-default-list li').first()).toBeVisible();
  await expect(page.locator('#bread-personal-list')).toContainText('No personal bread recipes yet');

  await page.locator('#personal-title').fill('Browser test loaf');
  await page.locator('#personal-loaf').fill('1.5 lb, Program 5');
  await page.locator('#personal-ingredients').fill('1 cup water\n3 cups flour\n1 tsp yeast');
  await page.locator('#personal-steps').fill('Add ingredients in order\nRun Program 5');
  await page.locator('#personal-notes').fill('First bake');
  await userClick(page.getByRole('button', { name: 'Save recipe', exact: true }), 'Save personal bread recipe');

  const card = page.locator('.personal-recipe-card').filter({ hasText: 'Browser test loaf' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.personal-recipe-title')).toHaveText('Browser test loaf');
  await expect(card.locator('.personal-recipe-meta')).toHaveText('1.5 lb, Program 5');
  await expect(card.locator('.personal-recipe-list').first()).toContainText('3 cups flour');
  await expect(card.locator('.personal-recipe-list').nth(1)).toContainText('Run Program 5');
  await expect(page.locator('#personal-title')).toHaveValue('');

  const notes = card.locator('textarea');
  await notes.fill('Second bake: reduce water slightly');
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]')[0]?.notes, STORAGE_KEY))
    .toBe('Second bake: reduce water slightly');

  await page.reload();
  const reloadedCard = page.locator('.personal-recipe-card').filter({ hasText: 'Browser test loaf' });
  await expect(reloadedCard).toHaveCount(1);
  await expect(reloadedCard.locator('textarea')).toHaveValue('Second bake: reduce water slightly');

  await userClick(reloadedCard.getByRole('button', { name: 'Delete', exact: true }), 'Delete personal bread recipe');
  await expect(page.locator('.personal-recipe-card')).toHaveCount(0);
  await expect(page.locator('#bread-personal-list')).toContainText('No personal bread recipes yet');
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, STORAGE_KEY))
    .toBe(0);
});
