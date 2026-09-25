import { test, expect } from '@playwright/test';
import { openDetails, userClick } from './journey-helpers.mjs';

test('Meal Prep add, scale, customize, and remove flow stays reachable as one user journey', async ({ page }) => {
  await page.goto('/planner.html');

  await expect(page.locator('#planner-recipe-list .planner-add-button').first()).toBeVisible();
  await expect(page.locator('#planner-selected-section')).toBeHidden();
  await expect(page.locator('#planner-ingredients-section')).toBeHidden();
  await expect(page.locator('#meals-planned')).toHaveText('0');

  const addButton = page.locator('#planner-recipe-list .planner-add-button:not([disabled])').first();
  const addLabel = await addButton.getAttribute('aria-label');
  expect(addLabel).toMatch(/^Add .+ to your plan$/);
  await userClick(addButton, addLabel || 'Add recipe to plan');

  await expect(page.locator('#planner-selected-section')).toBeVisible();
  await expect(page.locator('#planner-ingredients-section')).toBeVisible();
  await expect(page.locator('#selected-recipes .planner-selected-row')).toHaveCount(1);
  await expect(page.locator('#ingredients-summary li').first()).toBeVisible();

  const mealsAfterAdd = Number((await page.locator('#meals-planned').textContent())?.replace(/,/g, ''));
  expect(mealsAfterAdd).toBeGreaterThan(0);

  const groceryBefore = await page.locator('#ingredients-summary').textContent();
  const selectedRow = page.locator('#selected-recipes .planner-selected-row').first();
  await userClick(selectedRow.locator('summary'), 'selected recipe details');
  await expect(selectedRow.locator('.planner-selected-body')).toBeVisible();

  const batchInput = selectedRow.getByLabel('Batch size', { exact: true });
  await expect(batchInput).toHaveValue('1');
  await batchInput.fill('2');

  await expect
    .poll(async () => Number((await page.locator('#meals-planned').textContent())?.replace(/,/g, '')))
    .toBeGreaterThan(mealsAfterAdd);
  await expect(page.locator('#ingredients-summary')).not.toHaveText(groceryBefore || '');

  await openDetails(page, 'Customize plan');
  const customToggle = page.getByRole('checkbox', { name: 'Use a custom day or meal count', exact: true });
  await userClick(customToggle, 'Use a custom day or meal count');
  await expect(page.locator('#custom-fields')).toBeVisible();

  await page.locator('#days-input').fill('2');
  await page.locator('#meals-per-day-input').fill('2');
  await expect(page.locator('#meals-needed')).toHaveText('4');
  await expect(page.locator('#planner-progress')).toHaveAttribute('aria-valuemax', '4');

  const removeButton = selectedRow.getByRole('button', { name: /^Remove / });
  await userClick(removeButton, 'Remove selected recipe');
  await expect(page.locator('#planner-selected-section')).toBeHidden();
  await expect(page.locator('#planner-ingredients-section')).toBeHidden();
  await expect(page.locator('#meals-planned')).toHaveText('0');
  await expect(page.locator('#planner-recipe-list .planner-add-button:not([disabled])').first()).toBeVisible();
});
