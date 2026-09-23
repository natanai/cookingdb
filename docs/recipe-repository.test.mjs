import assert from 'node:assert/strict';
import {
  INBOX_STORAGE_KEY,
  buildRecipeIndex,
  loadStoredInboxRecipes,
  normalizeRecipeListResult,
  storeInboxRecipes,
} from './recipe-repository.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const wrapped = {
  title: 'Grandma’s Soup',
  payload: {
    payload: {
      id: 'grandmas-soup',
      title: 'Grandma’s Soup',
      ingredients: {
        broth: {
          token: 'broth',
          options: [{ ingredient_id: 'broth', display: 'broth', ratio: 1 }],
        },
      },
      token_order: ['broth'],
      steps_raw: 'Warm the broth.',
    },
  },
};

const normalized = normalizeRecipeListResult({ rows: [wrapped] });
assert.equal(normalized.length, 1);
assert.equal(normalized[0].id, 'grandmas-soup');
assert.equal(normalized[0].has_details, true);

const storage = memoryStorage();
const stored = storeInboxRecipes([wrapped], { storage });
assert.equal(stored.length, 1);
assert.match(storage.getItem(INBOX_STORAGE_KEY), /grandmas-soup/);

const restored = loadStoredInboxRecipes({ storage });
assert.equal(restored.length, 1);
assert.equal(restored[0].id, 'grandmas-soup');
assert.equal(restored[0].ingredients.broth.token, 'broth');

const recipeIndex = buildRecipeIndex([
  { id: 'one', title: 'One' },
  { id: 'two', title: 'Two' },
  { id: 'one', title: 'One override' },
]);
assert.equal(recipeIndex.size, 2);
assert.equal(recipeIndex.get('one').title, 'One override');

console.log('Recipe repository tests passed.');
