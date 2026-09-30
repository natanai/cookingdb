import { recipeDefaultCompatibility } from './recipe-utils.js';

export const DIETARY_BADGES = Object.freeze([
  Object.freeze({ key: 'gluten_free', short: 'GF', name: 'Gluten-free' }),
  Object.freeze({ key: 'egg_free', short: 'EF', name: 'Egg-free' }),
  Object.freeze({ key: 'dairy_free', short: 'DF', name: 'Dairy-free' }),
]);

export function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function splitRecipeTitle(rawTitle) {
  const title = String(rawTitle || '').trim();
  if (!title) return { title: '', name: '' };

  const parenMatch = title.match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), name: parenMatch[2].trim() };
  }

  const possessiveMatch = title.match(/^([^–—-]+?)\s*['’]s\s+(.+)$/i);
  if (possessiveMatch) {
    return { title: possessiveMatch[2].trim(), name: possessiveMatch[1].trim() };
  }

  return { title, name: '' };
}

export function getRecipeTitleParts(recipe) {
  const byline = String(recipe?.byline || '').trim();
  if (byline) {
    return { title: String(recipe?.title || '').trim(), name: byline };
  }
  return splitRecipeTitle(recipe?.title || '');
}

export function buildRecipeLink(recipeId) {
  const params = new URLSearchParams({ id: String(recipeId || '') });
  return `recipe.html?${params.toString()}`;
}

export function normalizeIngredients(raw, tokenOrder = []) {
  const list = Array.isArray(raw)
    ? raw.filter(Boolean)
    : raw && typeof raw === 'object'
      ? Object.values(raw).filter(Boolean)
      : [];

  const order = Array.isArray(tokenOrder) && tokenOrder.length
    ? tokenOrder
    : list.map((entry) => entry?.token).filter(Boolean);

  const byToken = {};
  list.forEach((entry) => {
    if (entry?.token) byToken[entry.token] = entry;
  });

  return { list, byToken, order };
}

export function recipeHasDetails(recipe) {
  if (!recipe || typeof recipe !== 'object') return false;
  const ingredients = normalizeIngredients(recipe.ingredients, recipe.token_order);
  const hasIngredients = ingredients.list.length > 0;
  const hasSteps =
    (typeof recipe.steps_raw === 'string' && recipe.steps_raw.trim().length > 0) ||
    (Array.isArray(recipe.steps) && recipe.steps.length > 0);
  return hasIngredients && hasSteps;
}

export function unwrapRecipeEntry(entry) {
  let obj = entry;
  for (let i = 0; i < 4; i += 1) {
    if (!obj || typeof obj !== 'object') break;

    if (obj.recipe && typeof obj.recipe === 'object') {
      obj = obj.recipe;
      continue;
    }

    if (obj.payload && typeof obj.payload === 'object') {
      if (obj.payload.payload && typeof obj.payload.payload === 'object') {
        obj = obj.payload.payload;
        continue;
      }
      obj = obj.payload;
      continue;
    }

    break;
  }
  return obj;
}

/**
 * Convert built, pending-inbox, or legacy envelope shapes into the one browser recipe shape.
 * Both default and possible compatibility are retained because different features need them.
 */
export function normalizeRecipeEntry(entry) {
  const maybe = unwrapRecipeEntry(entry);
  if (!maybe || typeof maybe !== 'object') return null;

  const wrapperTitle = entry?.title || entry?.payload?.title || entry?.recipe?.title || '';
  const title = maybe.title || wrapperTitle || '';
  const id =
    maybe.id ||
    maybe.recipe_id ||
    entry?.id ||
    entry?.recipe_id ||
    normalizeTitleKey(title);

  const ingredients = normalizeIngredients(maybe.ingredients, maybe.token_order);
  const normalizedForCompatibility = {
    ...maybe,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
  };
  const defaultCompatibility = recipeDefaultCompatibility(normalizedForCompatibility);
  const possibleCompatibility =
    maybe.compatibility_possible && typeof maybe.compatibility_possible === 'object'
      ? maybe.compatibility_possible
      : defaultCompatibility;

  return {
    ...maybe,
    title,
    id,
    content_hash: maybe.content_hash || entry?.content_hash,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
    compatibility_default:
      maybe.compatibility_default && typeof maybe.compatibility_default === 'object'
        ? maybe.compatibility_default
        : defaultCompatibility,
    compatibility_possible: possibleCompatibility,
    has_details: recipeHasDetails({
      ...maybe,
      ingredients: ingredients.list,
      token_order: ingredients.order,
    }),
  };
}

export function formatNumber(value, options = {}) {
  const { maximumFractionDigits = 1 } = options;
  if (!Number.isFinite(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits });
}

export function formatKcal(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}`;
}
