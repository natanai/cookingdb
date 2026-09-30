import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  getRecipeTitleParts,
  normalizeRecipeEntry,
  normalizeTitleKey,
  splitRecipeTitle,
} from './recipe-model.js';

const recipes = JSON.parse(
  fs.readFileSync(new URL('./built/recipes.json', import.meta.url), 'utf8')
);

assert.ok(recipes.length > 0, 'built cookbook must contain recipes');

for (const recipe of recipes) {
  const normalized = normalizeRecipeEntry(recipe);
  assert.equal(normalized.id, recipe.id, `${recipe.id}: id changed during normalization`);
  assert.equal(normalized.title, recipe.title, `${recipe.id}: title changed during normalization`);
  assert.deepEqual(normalized.token_order, recipe.token_order, `${recipe.id}: token order changed`);
  assert.deepEqual(
    Object.keys(normalized.ingredients),
    Object.keys(recipe.ingredients),
    `${recipe.id}: ingredient token identity changed`
  );
  assert.deepEqual(
    normalized.compatibility_possible,
    recipe.compatibility_possible,
    `${recipe.id}: possible dietary compatibility changed`
  );
  assert.equal(normalized.has_details, true, `${recipe.id}: complete built recipe lost details`);
}

const sample = recipes[0];
for (const envelope of [
  sample,
  { recipe: sample },
  { payload: sample },
  { payload: { title: sample.title, payload: sample } },
  { recipe: { payload: sample } },
]) {
  assert.equal(normalizeRecipeEntry(envelope).id, sample.id, 'supported inbox envelope changed recipe identity');
}

assert.equal(normalizeTitleKey("Lorene's Vegetable Soup"), 'lorene-s-vegetable-soup');
assert.deepEqual(splitRecipeTitle('Blintzes (Aubrey)'), { title: 'Blintzes', name: 'Aubrey' });
assert.deepEqual(getRecipeTitleParts({ title: 'Soup', byline: 'Nana' }), {
  title: 'Soup',
  name: 'Nana',
});

console.log(`Recipe model contract passed for ${recipes.length} built recipes.`);
