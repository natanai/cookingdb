import { fetchBuiltJson } from './built-data.js';
import { normalizeRecipeEntry } from './recipe-model.js';

export function buildRecipeIndex(recipes) {
  return new Map(
    (recipes || [])
      .filter((entry) => entry?.id)
      .map((entry) => [String(entry.id), entry])
  );
}

export async function loadRecipeSummaries({ label = 'Cookbook index' } = {}) {
  const indexRaw = await fetchBuiltJson('index.json', { label });
  return Array.isArray(indexRaw) ? indexRaw : [];
}

export async function loadBuiltRecipes({ label = 'Recipe box' } = {}) {
  const builtRaw = await fetchBuiltJson('recipes.json', { label });
  return Array.isArray(builtRaw)
    ? builtRaw.map((entry) => normalizeRecipeEntry(entry)).filter(Boolean)
    : [];
}

export async function loadRecipeCollection({ label = 'Recipe box' } = {}) {
  const recipes = await loadBuiltRecipes({ label });
  return {
    built: recipes,
    recipes,
    recipeIndex: buildRecipeIndex(recipes),
  };
}
