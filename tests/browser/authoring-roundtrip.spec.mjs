import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { importInbox } from '../../scripts/import-inbox.mjs';
import { userClick } from './journey-helpers.mjs';

const builtIndex = JSON.parse(
  fs.readFileSync(new URL('../../docs/built/index.json', import.meta.url), 'utf8')
);
const ingredientAutocomplete = JSON.parse(
  fs.readFileSync(new URL('../../docs/built/ingredient-autocomplete.json', import.meta.url), 'utf8')
);

const category = builtIndex.flatMap((recipe) => recipe.categories || []).find(Boolean) || 'Dinner';
const ingredient = ingredientAutocomplete.find(
  (entry) => entry?.ingredient_id && /^[A-Za-z][A-Za-z ]+$/.test(entry.label || '')
);

const WORKER_BASE = 'https://cookingdb-inbox.natanai.workers.dev';
const FAMILY_PASSWORD = 'browser-family-password';
const ADMIN_TOKEN = 'browser-admin-token';

function jsonResponse(route, status, payload) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installFakeInbox(page) {
  const state = {
    items: [],
    nextId: 1,
    clock: 0,
    lastUpdateRequest: null,
  };

  const nextTimestamp = () => {
    state.clock += 1;
    return `2026-09-23T18:00:${String(state.clock).padStart(2, '0')}Z`;
  };

  await page.route(`${WORKER_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const body = request.postDataJSON() || {};

    if (url.pathname === '/api/add') {
      if (headers['x-recipe-password'] !== FAMILY_PASSWORD) {
        return jsonResponse(route, 401, { ok: false, error: 'Bad family password' });
      }

      const now = nextTimestamp();
      const item = {
        id: state.nextId,
        title: body.title || body.payload?.title || '',
        payload: body.payload || {},
        created_at: now,
        updated_at: now,
      };
      state.nextId += 1;
      state.items.push(item);
      return jsonResponse(route, 200, { ok: true, id: item.id });
    }

    if (url.pathname === '/admin/export') {
      if (headers['x-admin-token'] !== ADMIN_TOKEN) {
        return jsonResponse(route, 401, { ok: false, error: 'Bad admin token' });
      }
      return jsonResponse(route, 200, { ok: true, items: state.items });
    }

    if (url.pathname === '/admin/update-pending') {
      if (headers['x-admin-token'] !== ADMIN_TOKEN) {
        return jsonResponse(route, 401, { ok: false, error: 'Bad admin token' });
      }

      const item = state.items.find((candidate) => Number(candidate.id) === Number(body.id));
      if (!item) {
        return jsonResponse(route, 404, { ok: false, error: 'Pending recipe not found' });
      }
      if ((body.expected_updated_at || '') !== (item.updated_at || '')) {
        return jsonResponse(route, 409, {
          ok: false,
          error: 'Pending recipe changed since it was opened',
        });
      }

      state.lastUpdateRequest = body;
      item.payload = body.payload || {};
      item.title = item.payload.title || item.title;
      item.updated_at = nextTimestamp();
      return jsonResponse(route, 200, { ok: true, item });
    }

    return jsonResponse(route, 404, { ok: false, error: `Unhandled fake inbox path: ${url.pathname}` });
  });

  return state;
}

async function chooseCategory(page) {
  await expect(page.locator('#categories')).toBeEnabled();
  await userClick(page.locator('#category-menu > summary'), 'category picker');
  const checkbox = page.getByRole('checkbox', { name: category, exact: true });
  await userClick(checkbox, `category ${category}`);
  await userClick(page.getByRole('button', { name: 'Done', exact: true }), 'finish category selection');
  await expect(page.locator('#category-summary')).toContainText(category);
}

async function chooseIngredient(page) {
  expect(ingredient, 'browser fixture needs at least one simple catalog ingredient').toBeTruthy();

  const row = page.locator('#ingredient-rows .ingredient-row').first();
  const name = row.locator('.ingredient-name');
  await name.fill(ingredient.label);

  const option = page
    .getByRole('option')
    .filter({ hasText: ingredient.label })
    .first();
  await userClick(option, `ingredient suggestion ${ingredient.label}`);

  await row.locator('.ingredient-amount').fill('1');
  const unit = row.locator('.ingredient-unit');
  if (!(await unit.inputValue())) {
    const firstUsableUnit = await unit.locator('option:not([disabled])').first().getAttribute('value');
    expect(firstUsableUnit, 'ingredient editor should expose at least one usable unit').toBeTruthy();
    await unit.selectOption(firstUsableUnit);
  }

  await expect(row.locator('.ingredient-id')).toHaveValue(ingredient.ingredient_id);
  return ingredient.label;
}

function verifyPublishImport(inbox, ingredientLabel) {
  expect(inbox.items).toHaveLength(1);
  const pendingItem = inbox.items[0];
  const recipeId = String(pendingItem.payload?.id || '').trim();
  expect(recipeId, 'reviewed pending recipe must retain a publishable recipe id').toMatch(/^[a-z0-9_-]+$/);

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookingdb-roundtrip-'));
  try {
    fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'recipes'), { recursive: true });
    fs.copyFileSync(
      new URL('../../data/ingredient_catalog.csv', import.meta.url),
      path.join(rootDir, 'data', 'ingredient_catalog.csv')
    );

    const exportPath = path.join(rootDir, 'pending-export.json');
    fs.writeFileSync(exportPath, `${JSON.stringify({ items: inbox.items }, null, 2)}\n`);

    const report = importInbox({ inputPath: exportPath, rootDir });
    expect(report.processed).toBe(1);
    expect(report.inbox_ids).toEqual([pendingItem.id]);
    expect(report.created_recipe_ids).toEqual([recipeId]);

    const recipeDir = path.join(rootDir, 'recipes', recipeId);
    const meta = fs.readFileSync(path.join(recipeDir, 'meta.csv'), 'utf8');
    const ingredients = fs.readFileSync(path.join(recipeDir, 'ingredients.csv'), 'utf8');
    const steps = fs.readFileSync(path.join(recipeDir, 'steps.csv'), 'utf8');

    expect(meta).toContain('Browser round trip soup revised');
    expect(meta).toContain(category);
    expect(ingredients).toContain(ingredient.ingredient_id);
    expect(ingredients).toContain(ingredientLabel);
    expect(steps).toContain(`Add ${ingredientLabel} and stir.`);

    const secondPass = importInbox({ inputPath: exportPath, rootDir, dryRun: true });
    expect(secondPass.created_recipe_ids).toEqual([]);
    expect(secondPass.already_present_recipe_ids).toEqual([recipeId]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test('Add Recipe -> Recipe inbox -> Review / edit -> publish import follows the real user path', async ({ page }) => {
  const inbox = await installFakeInbox(page);

  await page.addInitScript(
    ({ familyPassword, adminToken }) => {
      localStorage.setItem('cookingdb-family-password', familyPassword);
      localStorage.setItem('cookingdb-admin-password', adminToken);
    },
    { familyPassword: FAMILY_PASSWORD, adminToken: ADMIN_TOKEN }
  );

  await page.goto('/add.html');
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#admin-edit-banner')).toBeHidden();

  await page.locator('#title').fill('Browser round trip soup');
  await chooseCategory(page);
  const ingredientLabel = await chooseIngredient(page);
  await page.locator('#steps-list .step-text').first().fill(`Add ${ingredientLabel} and stir.`);

  // Submission deliberately confirms the family password even when a remembered value
  // is available. Exercise that real dialog instead of bypassing the user-facing gate.
  const familyDialogPromise = page.waitForEvent('dialog');
  const submitPromise = userClick(
    page.getByRole('button', { name: 'Submit recipe', exact: true }),
    'Submit recipe'
  );
  const familyDialog = await familyDialogPromise;
  expect(familyDialog.type()).toBe('prompt');
  expect(familyDialog.message()).toBe('Family inbox password');
  expect(familyDialog.defaultValue()).toBe(FAMILY_PASSWORD);
  await familyDialog.accept(FAMILY_PASSWORD);
  await submitPromise;

  await expect(page.locator('#form-status')).toContainText('Success: submitted with id 1.');
  expect(inbox.items).toHaveLength(1);
  expect(inbox.items[0].payload.title).toBe('Browser round trip soup');

  await page.goto('/admin.html');
  await expect(page.locator('#pending-section')).toBeVisible();
  await expect(page.locator('.pending-recipe-row')).toHaveCount(1);
  await expect(page.locator('.pending-recipe-title')).toHaveText('Browser round trip soup');

  const reviewLink = page.getByRole('link', { name: 'Review / edit', exact: true });
  await Promise.all([
    page.waitForURL(/add\.html\?adminEdit=1&review=1$/),
    userClick(reviewLink, 'Review / edit pending recipe'),
  ]);

  await expect(page.locator('#admin-edit-banner')).toBeVisible();
  await expect(page.locator('#form-status')).toContainText('Pending recipe loaded for review.');
  await expect(page.locator('#title')).toHaveValue('Browser round trip soup');
  await expect(page.getByRole('button', { name: 'Save pending recipe', exact: true })).toBeEnabled();

  if (await page.locator('#review-panel').isVisible()) {
    await userClick(page.getByRole('button', { name: 'Back to editing', exact: true }), 'Back to editing');
  }

  await page.locator('#title').fill('Browser round trip soup revised');
  await userClick(
    page.getByRole('button', { name: 'Save pending recipe', exact: true }),
    'Save pending recipe'
  );

  await expect(page.locator('#form-status')).toContainText('Saved. This recipe is still pending');
  expect(inbox.lastUpdateRequest).toBeTruthy();
  expect(inbox.lastUpdateRequest.expected_updated_at).toBe('2026-09-23T18:00:01Z');
  expect(inbox.items[0].payload.title).toBe('Browser round trip soup revised');

  await page.goto('/admin.html');
  await expect(page.locator('.pending-recipe-title')).toHaveText('Browser round trip soup revised');

  verifyPublishImport(inbox, ingredientLabel);
});
