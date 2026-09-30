import { test, expect } from '@playwright/test';
import { openDetails, userClick } from './journey-helpers.mjs';

test('Add Recipe advanced authoring controls are reachable through visible user actions', async ({ page }) => {
  await page.goto('/add.html');

  const row = page.locator('#ingredient-rows .ingredient-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.ingredient-advanced')).toBeHidden();

  await userClick(row.getByRole('button', { name: 'Ingredient options', exact: true }), 'Ingredient options');
  await expect(row.locator('.ingredient-advanced')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Start section here', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Add substitution', exact: true })).toBeVisible();
  await expect(row.getByText('Prep note', { exact: true })).toBeVisible();

  const choiceToggle = row.getByRole('checkbox', { name: 'Part of a substitution group', exact: true });
  await expect(row.locator('.choice-fields')).toBeHidden();
  await userClick(choiceToggle, 'Part of a substitution group');
  await expect(row.locator('.choice-fields')).toBeVisible();
  await expect(row.getByText('Group', { exact: true })).toBeVisible();
  await expect(row.getByText('Shown to readers as', { exact: true })).toBeVisible();
  await expect(row.getByText('Option name', { exact: true })).toBeVisible();

  const conditionalToggle = row.getByRole('checkbox', {
    name: 'Only include this ingredient sometimes',
    exact: true,
  });
  await expect(row.locator('.conditional-fields')).toBeHidden();
  await userClick(conditionalToggle, 'Only include this ingredient sometimes');
  await expect(row.locator('.conditional-fields')).toBeVisible();
  await expect(row.getByText('When', { exact: true })).toBeVisible();
  await expect(row.getByText('Is set to', { exact: true })).toBeVisible();

  await userClick(conditionalToggle, 'Only include this ingredient sometimes');
  await expect(row.locator('.conditional-fields')).toBeHidden();
  await userClick(choiceToggle, 'Part of a substitution group');
  await expect(row.locator('.choice-fields')).toBeHidden();

  await openDetails(page.locator('.recipe-details-section'), 'Recipe details');
  await openDetails(page.locator('#recipe-options'), 'More recipe options');
  await expect(page.locator('#byline')).toBeVisible();
  await expect(page.locator('#default-base')).toBeVisible();
  await expect(page.locator('#default-pan')).toBeVisible();
  await expect(page.locator('#default-pan')).toBeEnabled();

  await userClick(page.getByRole('button', { name: 'Review recipe', exact: true }), 'Review recipe');
  await expect(page.locator('#review-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to editing', exact: true })).toBeVisible();

  await userClick(page.getByRole('button', { name: 'Back to editing', exact: true }), 'Back to editing');
  await expect(page.locator('#review-panel')).toBeHidden();
  await expect(page.locator('#title')).toBeVisible();
});
