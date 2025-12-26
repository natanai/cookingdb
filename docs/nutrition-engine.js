import { selectOptionForToken } from './recipe-utils.js';
import { UNIT_CONVERSIONS } from './unit-conversions.js';

const UNIT_ALIASES = new Map([
  ['cloves', 'clove'],
  ['medium', 'count'],
  ['large', 'count'],
  ['small', 'count'],
  ['piece', 'count'],
  ['package', 'count'],
  ['bag', 'count'],
  ['bunch', 'count'],
  ['sprig', 'count'],
  ['can', 'count'],
  ['dash', 'tsp'],
  ['drop', 'tsp'],
]);

const REQUIRED_NUTRIENTS = [
  'kcal',
  'protein_g',
  'fat_g',
  'sat_fat_g',
  'carbs_g',
  'sugars_g',
  'fiber_g',
  'sodium_mg',
];

const DEFAULT_WEIGHTS = {
  kcal: 1,
  sodium: 1,
  sat_fat: 1,
  added_sugar: 1,
  fiber: 1,
  protein: 1,
};

export function parseRatioToNumber(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(' ');
  let whole = 0;
  let frac = parts[0];
  if (parts.length === 2) {
    whole = Number(parts[0]);
    frac = parts[1];
  }
  let num;
  let den;
  if (frac.includes('/')) {
    const [n, d] = frac.split('/');
    num = Number(n);
    den = Number(d);
  } else {
    num = Number(frac);
    den = 1;
  }
  if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return whole + num / den;
}

export function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
}

function unitDefinition(unitId) {
  if (!unitId) return null;
  const normalized = String(unitId).toLowerCase();
  for (const [groupName, group] of Object.entries(UNIT_CONVERSIONS)) {
    const def = group.units[normalized];
    if (def) return { ...def, id: normalized, group: groupName };
  }
  return null;
}

function convertUnitAmount(amount, fromUnit, toUnit) {
  if (!Number.isFinite(amount)) return null;
  const fromDef = unitDefinition(fromUnit);
  const toDef = unitDefinition(toUnit);
  if (!fromDef || !toDef || fromDef.group !== toDef.group) return null;
  const amountInBase = amount * fromDef.to_base;
  const converted = amountInBase / toDef.to_base;
  return { amount: converted, unit: toDef.id };
}

export function buildNutritionIndex(nutritionCatalog) {
  const index = new Map();
  for (const entry of nutritionCatalog.values()) {
    if (!entry?.ingredient_id) continue;
    if (!index.has(entry.ingredient_id)) {
      index.set(entry.ingredient_id, []);
    }
    index.get(entry.ingredient_id).push(entry);
  }
  return index;
}

function findNutritionEntry(ingredientId, amount, unit, nutritionCatalog, nutritionIndex) {
  const direct = nutritionCatalog.get(`${ingredientId}::${unit}`);
  if (direct) {
    return { entry: direct, amountInEntryUnit: amount };
  }
  const entries = nutritionIndex.get(ingredientId) || [];
  for (const entry of entries) {
    const conversion = convertUnitAmount(amount, unit, entry.unit);
    if (!conversion) continue;
    return { entry, amountInEntryUnit: conversion.amount };
  }
  return null;
}

function initTotals() {
  return {
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    sat_fat_g: 0,
    carbs_g: 0,
    sugars_g: 0,
    fiber_g: 0,
    sodium_mg: 0,
    added_sugar_g: 0,
    grams_total: 0,
  };
}

export function computeBatchTotals(recipe, state) {
  const nutritionCatalog = state?.nutritionCatalog || new Map();
  const nutritionIndex = state?.nutritionIndex || buildNutritionIndex(nutritionCatalog);
  const totals = initTotals();
  const totalsMissing = new Set();
  const tokens = Object.keys(recipe?.ingredients || {});
  let covered = 0;
  let missing = 0;
  let gramsCovered = 0;

  tokens.forEach((token) => {
    const tokenData = recipe.ingredients[token];
    const option = selectOptionForToken(token, recipe, state);
    if (!option || !option.ratio || !option.unit) {
      missing += 1;
      return;
    }
    const amount = parseRatioToNumber(option.ratio);
    if (!Number.isFinite(amount)) {
      missing += 1;
      return;
    }
    const normalizedUnit = normalizeUnit(option.unit);
    if (!normalizedUnit) {
      missing += 1;
      return;
    }
    const found = findNutritionEntry(option.ingredient_id, amount, normalizedUnit, nutritionCatalog, nutritionIndex);
    if (!found) {
      missing += 1;
      return;
    }

    const { entry, amountInEntryUnit } = found;
    let ingredientComplete = true;
    REQUIRED_NUTRIENTS.forEach((nutrientKey) => {
      const value = entry[nutrientKey];
      if (Number.isFinite(value)) {
        totals[nutrientKey] += amountInEntryUnit * value;
      } else {
        ingredientComplete = false;
        totalsMissing.add(nutrientKey);
      }
    });

    if (Number.isFinite(entry.added_sugar_g)) {
      totals.added_sugar_g += amountInEntryUnit * entry.added_sugar_g;
    } else if (entry.added_sugar_g !== undefined && entry.added_sugar_g !== null) {
      totalsMissing.add('added_sugar_g');
    }

    if (Number.isFinite(entry.grams_per_unit)) {
      totals.grams_total += amountInEntryUnit * entry.grams_per_unit;
      gramsCovered += 1;
    } else {
      const gramsConversion = convertUnitAmount(amountInEntryUnit, entry.unit, 'g');
      if (gramsConversion) {
        totals.grams_total += gramsConversion.amount;
        gramsCovered += 1;
      }
    }

    if (ingredientComplete) {
      covered += 1;
    } else {
      missing += 1;
    }
  });

  const totalsOutput = { ...totals };
  totalsMissing.forEach((nutrientKey) => {
    if (nutrientKey in totalsOutput) {
      totalsOutput[nutrientKey] = null;
    }
  });
  if (gramsCovered === 0) {
    totalsOutput.grams_total = null;
  }

  return {
    totals: totalsOutput,
    covered_ingredients: covered,
    total_ingredients: tokens.length,
    coverage_ratio: tokens.length ? covered / tokens.length : 0,
    is_complete: missing === 0 && totalsMissing.size === 0,
    missing_ingredients: missing,
  };
}

function clampNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeMealFractions(fractions, policy) {
  const defaults = policy?.meal_fractions_default || {};
  const keys = Object.keys(defaults).length ? Object.keys(defaults) : ['breakfast', 'lunch', 'dinner', 'snack'];
  const normalized = {};
  let sum = 0;
  keys.forEach((key) => {
    const raw = fractions?.[key];
    const value = Number(raw);
    const safe = Number.isFinite(value) && value > 0 ? value : Number(defaults[key]) || 0;
    normalized[key] = safe;
    sum += safe;
  });
  if (sum <= 0) {
    const equal = 1 / keys.length;
    keys.forEach((key) => {
      normalized[key] = equal;
    });
    sum = 1;
  }
  keys.forEach((key) => {
    normalized[key] = normalized[key] / sum;
  });
  return normalized;
}

function ensureWeights(policy) {
  return {
    ...DEFAULT_WEIGHTS,
    ...(policy?.penalty_weights || {}),
  };
}

export function estimateServings(totals, userSettings, policy, mealType) {
  if (!totals || !Number.isFinite(totals.kcal) || totals.kcal <= 0) return null;

  const dailyKcal = clampNumber(userSettings?.daily_kcal, policy?.default_daily_kcal || 2000);
  const fractions = normalizeMealFractions(userSettings?.meal_fractions, policy);
  const fraction = clampNumber(fractions[mealType], 1 / (policy?.default_meals_per_day || 3));
  const kcalTargetMeal = dailyKcal * fraction;

  const sodiumLimitMeal = clampNumber(policy?.sodium_day_max_mg, 2300) * fraction;
  const satFatLimitMeal = clampNumber(policy?.sat_fat_max_pct_kcal, 0.1) * kcalTargetMeal / 9;
  const addedSugarLimitMeal = clampNumber(policy?.added_sugar_max_pct_kcal, 0.1) * kcalTargetMeal / 4;
  const fiberTargetMeal = clampNumber(policy?.fiber_g_per_1000_kcal_min, 14) * (kcalTargetMeal / 1000);

  const weightKg = Number(userSettings?.weight_kg);
  const proteinFloorMeal = Number.isFinite(weightKg) && weightKg > 0
    ? clampNumber(policy?.protein_rda_g_per_kg_day, 0.8) * weightKg * fraction
    : 0;

  const weights = ensureWeights(policy);

  let best = null;
  for (let servings = 1; servings <= 20; servings += 1) {
    const perServing = {
      kcal: totals.kcal / servings,
      protein_g: totals.protein_g / servings,
      fat_g: totals.fat_g / servings,
      sat_fat_g: totals.sat_fat_g / servings,
      carbs_g: totals.carbs_g / servings,
      sugars_g: totals.sugars_g / servings,
      fiber_g: totals.fiber_g / servings,
      sodium_mg: totals.sodium_mg / servings,
    };
    if (Number.isFinite(totals.added_sugar_g)) {
      perServing.added_sugar_g = totals.added_sugar_g / servings;
    }
    if (Number.isFinite(totals.grams_total)) {
      perServing.grams_total = totals.grams_total / servings;
    }

    let penalty = 0;
    penalty += weights.kcal * Math.abs(perServing.kcal - kcalTargetMeal);
    penalty += weights.sodium * Math.max(0, perServing.sodium_mg - sodiumLimitMeal);
    penalty += weights.sat_fat * Math.max(0, perServing.sat_fat_g - satFatLimitMeal);
    if (Number.isFinite(perServing.added_sugar_g)) {
      penalty += weights.added_sugar * Math.max(0, perServing.added_sugar_g - addedSugarLimitMeal);
    }
    penalty += weights.fiber * Math.max(0, fiberTargetMeal - perServing.fiber_g);
    if (proteinFloorMeal > 0) {
      penalty += weights.protein * Math.max(0, proteinFloorMeal - perServing.protein_g);
    }

    if (!best || penalty < best.penalty || (penalty === best.penalty && servings < best.servings)) {
      best = { servings, penalty, perServing };
    }
  }

  if (!best) return null;

  return {
    servings_estimate: best.servings,
    perServing: best.perServing,
    batchTotals: totals,
    debugTargets: {
      kcal_target_meal: kcalTargetMeal,
      sodium_limit_meal: sodiumLimitMeal,
      sat_fat_limit_g_meal: satFatLimitMeal,
      added_sugar_limit_g_meal: addedSugarLimitMeal,
      fiber_target_g_meal: fiberTargetMeal,
      protein_floor_g_meal: proteinFloorMeal,
      meal_fraction: fraction,
    },
  };
}
