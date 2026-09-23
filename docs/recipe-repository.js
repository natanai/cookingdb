import { fetchBuiltJson } from './built-data.js';
import { normalizeRecipeEntry } from './recipe-model.js';

export const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function normalizeRecipeListResult(result) {
  if (!result) return [];
  const maybeList = Array.isArray(result)
    ? result
    : result.rows || result.pending || result.recipes || result.items;

  if (!Array.isArray(maybeList)) return [];
  return maybeList.map((entry) => normalizeRecipeEntry(entry)).filter(Boolean);
}

export function loadStoredInboxRecipes({ storage } = {}) {
  const target = resolveStorage(storage);
  if (!target) return [];

  try {
    const raw = target.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => normalizeRecipeEntry(entry)).filter(Boolean);
  } catch (err) {
    console.warn('Unable to read inbox recipes from storage', err);
    return [];
  }
}

export function storeInboxRecipes(recipes, { storage } = {}) {
  const target = resolveStorage(storage);
  const normalized = Array.isArray(recipes)
    ? recipes.map((entry) => normalizeRecipeEntry(entry)).filter(Boolean)
    : [];

  if (!target) return normalized;

  target.setItem(INBOX_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

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

export async function loadRecipeCollection({
  label = 'Recipe box',
  includeInbox = true,
  storage,
} = {}) {
  const built = await loadBuiltRecipes({ label });
  const inbox = includeInbox ? loadStoredInboxRecipes({ storage }) : [];
  const recipes = [...built, ...inbox];
  return {
    built,
    inbox,
    recipes,
    recipeIndex: buildRecipeIndex(recipes),
  };
}
