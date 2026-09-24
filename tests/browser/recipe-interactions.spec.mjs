import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openDetails, userClick } from './journey-helpers.mjs';

const recipes = JSON.parse(
  fs.readFileSync(new URL('../../docs/built/recipes.json', import.meta.url), 'utf8')
);

function panArea(pan) {
  if (!pan) return null;
  const shape = String(pan.shape || 'rectangle').toLowerCase();
  const width = Number(pan.width);
  if (!Number.isFinite(width) || width <= 0) return null;
  if (shape === 'round') return Math.PI * (width / 2) ** 2;
  if (shape === 'muffin') {
    const cups = Number(pan.cups) || width;
    return Number.isFinite(cups) && cups > 0 ? cups : null;
  }
  const height = Number(pan.height) || (shape === 'square' ? width : null);
  return Number.isFinite(height) && height > 0 ? width * height : null;
}

function findBatchFixture() {
  return recipes.find((recipe) =>
    Object.values(recipe.ingredients || {}).some((entry) =>
      (entry.options || []).some((option) => option?.ratio)
    )
  );
}

function findPanFixture() {
  for (const recipe of recipes) {
    const pans = Array.isArray(recipe.pan_sizes) ? recipe.pan_sizes : [];
    if (!recipe.default_pan || pans.length < 2) continue;
    const base = pans.find((pan) => pan.id === recipe.default_pan) || pans[0];
    const baseArea = panArea(base);
    if (!baseArea) continue;
    const alternative = pans.find((pan) => {
      const area = panArea(pan);
      return pan.id !== base.id && area && Math.abs(area / baseArea - 1) >= 0.01;
    });
    if (alternative) return { recipe, base, alternative };
  }
  return null;
}

function findSwapFixture() {
  for (const recipe of recipes) {
    for (const token of Object.keys(recipe.choices || {})) {
      const options = (recipe.ingredients?.[token]?.options || []).filter((option) => option?.option);
      if (options.length >= 2) return { recipe, token, options };
    }
  }
  return null;
}

function findCarrotCountFixture() {
  for (const recipe of recipes) {
    for (const [token, ingredient] of Object.entries(recipe.ingredients || {})) {
      const option = (ingredient.options || []).find(
        (candidate) => candidate?.ingredient_id === 'carrot' && candidate?.ratio
      );
      if (option) return { recipe, token, option };
    }
  }
  return null;
}

async function openRecipe(page, recipe) {
  await page.goto(`/recipe.html?id=${encodeURIComponent(recipe.id)}`);
  await expect(page.locator('#recipe-title')).not.toHaveText('Recipe');
  await expect(page.locator('#ingredients-list li').first()).toBeVisible();
}

test('batch multiplier updates the visible recipe and the print document together', async ({ page }) => {
  const recipe = findBatchFixture();
  expect(recipe, 'browser fixtures need a scalable published recipe').toBeTruthy();
  await openRecipe(page, recipe);

  const liveIngredient = page.locator('#ingredients-list li:not(.section-header)').first();
  const printIngredient = page.locator('#print-ingredients-list li:not(.print-section-header)').first();
  const beforeLive = await liveIngredient.textContent();
  const beforePrint = await printIngredient.textContent();
  const multiplier = page.locator('#multiplier');
  const initial = Number(await multiplier.inputValue()) || 1;

  await multiplier.fill(String(initial * 2));

  await expect(page.locator('#multiplier-helper')).toBeVisible();
  await expect(page.locator('#multiplier-helper')).toContainText('batch multiplier');
  await expect(liveIngredient).not.toHaveText(beforeLive || '');
  await expect(printIngredient).not.toHaveText(beforePrint || '');
});

test('Use what I have exposes the carrot count estimate and scales deterministically', async ({ page }) => {
  const fixture = findCarrotCountFixture();
  expect(fixture, 'browser fixtures need a published recipe containing carrots').toBeTruthy();
  await openRecipe(page, fixture.recipe);

  const multiplier = page.locator('#multiplier');
  const initial = await multiplier.inputValue();

  await userClick(page.locator('#available-scale-toggle'), 'Use what I have');
  await expect(page.locator('#available-scale-panel')).toBeVisible();

  await page.locator('#available-scale-ingredient').selectOption(fixture.token);
  await expect(page.locator('#available-scale-unit option[value="count"]')).toHaveCount(1);
  await page.locator('#available-scale-unit').selectOption('count');
  await expect(page.locator('#available-scale-note')).toContainText('Count uses the stored kitchen estimate.');

  await page.locator('#available-scale-amount').fill('2');
  await userClick(page.getByRole('button', { name: 'Scale recipe', exact: true }), 'Scale recipe');

  await expect(page.locator('#available-scale-panel')).toBeHidden();
  await expect(page.locator('#available-scale-active')).toBeVisible();
  await expect(page.locator('#available-scale-active-text')).toContainText('carrot');
  await expect(multiplier).not.toHaveValue(initial);

  await userClick(page.getByRole('button', { name: 'Reset', exact: true }), 'Reset available-ingredient scaling');
  await expect(page.locator('#available-scale-active')).toBeHidden();
  await expect(multiplier).toHaveValue(initial);
});

test('pan scaling is reachable through Adjust recipe and propagates to print', async ({ page }) => {
  const fixture = findPanFixture();
  expect(fixture, 'browser fixtures need a recipe with at least two meaningfully different pans').toBeTruthy();

  await page.addInitScript(() => {
    window.__cookingdbPrintCalls = 0;
    window.print = () => {
      window.__cookingdbPrintCalls += 1;
    };
  });
  await openRecipe(page, fixture.recipe);

  const liveIngredient = page.locator('#ingredients-list li:not(.section-header)').first();
  const printIngredient = page.locator('#print-ingredients-list li:not(.print-section-header)').first();
  const beforeLive = await liveIngredient.textContent();
  const beforePrint = await printIngredient.textContent();

  await userClick(page.locator('#adjust-summary'), 'Adjust recipe');
  await expect(page.locator('#pan-controls')).toBeVisible();
  await expect(page.locator('#pan-select')).toHaveValue(fixture.base.id);
  await page.locator('#pan-select').selectOption(fixture.alternative.id);

  await expect(page.locator('#pan-note')).toContainText('Scaling from');
  await expect(page.locator('#multiplier-helper')).toContainText('pan scaling');
  await expect(liveIngredient).not.toHaveText(beforeLive || '');
  await expect(printIngredient).not.toHaveText(beforePrint || '');

  await openDetails(page, 'Recipe details');
  await userClick(page.getByRole('button', { name: 'Print recipe', exact: true }), 'Print recipe');
  await expect
    .poll(() => page.evaluate(() => window.__cookingdbPrintCalls))
    .toBe(1);
});

test('published substitution choices can be reached and change the rendered ingredient', async ({ page }) => {
  const fixture = findSwapFixture();
  expect(fixture, 'browser fixtures need a published recipe with a multi-option substitution').toBeTruthy();
  await openRecipe(page, fixture.recipe);

  await userClick(page.locator('#adjust-summary'), 'Adjust recipe');
  const select = page.locator(`#swap-list select[data-token="${fixture.token}"]`);
  await expect(select).toBeVisible();

  const initial = await select.inputValue();
  const alternativeValue = await select
    .locator('option:not(:checked):not(:disabled)')
    .first()
    .getAttribute('value');
  expect(alternativeValue, 'substitution control needs another enabled option').toBeTruthy();

  const before = await page.locator('#ingredients-list').textContent();
  await select.selectOption(alternativeValue);

  await expect(select).toHaveValue(alternativeValue);
  await expect(page.locator('#ingredients-list')).not.toHaveText(before || '');

  const chosen = fixture.options.find((option) => option.option === alternativeValue);
  if (chosen?.display) {
    await expect(page.locator('#ingredients-list')).toContainText(chosen.display);
  }
  expect(initial).not.toBe(alternativeValue);
});
