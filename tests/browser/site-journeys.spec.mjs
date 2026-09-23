import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const builtIndex = JSON.parse(fs.readFileSync(new URL('../../docs/built/index.json', import.meta.url), 'utf8'));
const savedCategory = builtIndex.flatMap((recipe) => recipe.categories || []).find(Boolean) || 'Dinner';
const DRAFT_KEY = 'cookingdb:add-recipe:draft:v2';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectPageShell(page, pageName) {
  await expect(page.locator(`body[data-site-page="${pageName}"]`)).toBeVisible();
  await expect(page.locator('[data-site-nav]')).toBeVisible();
}

test.describe('six-page browser smoke journeys', () => {
  test('Cookbook renders searchable recipe rows', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/index.html');
    await expectPageShell(page, 'home');
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#recipe-list li').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Add Recipe opens as a blank composer, not an admin review', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/add.html');
    await expectPageShell(page, 'add');
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#admin-edit-banner')).toBeHidden();
    await expect(page.locator('#ingredient-rows .ingredient-row').first()).toBeVisible();
    await expect(page.locator('#steps-list .step-row').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Recipe page reveals a complete recipe card', async ({ page }) => {
    const errors = collectPageErrors(page);
    const recipeId = builtIndex.find((recipe) => recipe?.id)?.id;
    expect(recipeId).toBeTruthy();
    await page.goto(`/recipe.html?id=${encodeURIComponent(recipeId)}`);
    await expectPageShell(page, 'recipe');
    await expect(page.locator('#recipe-title')).not.toHaveText('Recipe');
    await expect(page.locator('#ingredients-list li').first()).toBeVisible();
    await expect(page.locator('#steps-list li').first()).toBeVisible();
    await expect(page.locator('#available-scale-toggle')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Meal Prep loads the recipe picker', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/planner.html');
    await expectPageShell(page, 'planner');
    await expect(page.locator('#planner-search')).toBeVisible();
    await expect(page.locator('#planner-recipe-list li').first()).toBeVisible();
    await expect(page.locator('#planner-progress')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Bread Maker keeps both default recipes and the personal journal reachable', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/bread-maker.html');
    await expectPageShell(page, 'bread');
    await expect(page.locator('#bread-default-list li').first()).toBeVisible();
    await expect(page.locator('#personal-recipe-form')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Admin inbox requires authentication before exposing pending controls', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/admin.html');
    await expectPageShell(page, 'admin');
    await expect(page.locator('#admin-token')).toBeVisible();
    await expect(page.locator('#load-pending-btn')).toBeVisible();
    await expect(page.locator('#pending-section')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('Add Recipe failure resilience', () => {
  test('a saved pan and category survive helper failures while categories become usable from the first successful source', async ({ page }) => {
    await page.addInitScript(
      ({ key, category }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            title: 'Resilient draft',
            servings: '4',
            family: '',
            byline: '',
            default_base: '1',
            default_pan: 'sq_8',
            notes: '',
            categories: [category],
            ingredients: [],
            steps: [],
            saved_at: Date.now(),
          })
        );
      },
      { key: DRAFT_KEY, category: savedCategory }
    );

    await page.route('**/built/pan-sizes.json*', (route) => route.abort('failed'));
    await page.route('**/built/authoring-options.json*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });

    await page.goto('/add.html');

    await expect(page.locator('#categories')).toBeEnabled({ timeout: 1200 });
    await expect(page.locator('#category-summary')).toContainText(savedCategory, { timeout: 1200 });

    // Pan scaling is intentionally nested under Recipe details > More recipe options.
    // Open both disclosures in the same sequence a user must follow before checking recovery.
    await page.locator('#recipe-details-heading').click();
    await expect(page.locator('#recipe-options > summary')).toBeVisible();
    await page.locator('#recipe-options > summary').click();
    await expect(page.getByRole('button', { name: 'Retry pan sizes' })).toBeVisible();

    await page.locator('#title').fill('Resilient draft edited');
    await expect(page.locator('#draft-status')).toHaveText('Saved');

    const savedDraft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DRAFT_KEY);
    expect(savedDraft.default_pan).toBe('sq_8');
    expect(savedDraft.categories).toContain(savedCategory);
  });
});
