import {
  convertUnitAmount,
  getEffectiveMultiplier,
  normalizeUnit,
  parseRatio,
  selectOptionForToken,
  unitDefinition,
} from './recipe-utils.js';

const SETTINGS_KEY = 'cookingdb-nutrition-settings';

const DEFAULT_POLICY = {
  sodium_day_max_mg: 2300,
  sat_fat_max_pct_kcal: 0.1,
  added_sugar_max_pct_kcal: 0.1,
  fiber_g_per_1000_kcal_min: 14,
  amdr: {
    protein_pct: [0.1, 0.35],
    fat_pct: [0.2, 0.35],
    carb_pct: [0.45, 0.65],
  },
  protein_rda_g_per_kg_day: 0.8,
  default_daily_kcal: 2000,
  default_meals_per_day: 3,
  meal_fractions_default: { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 },
  weights: {
    calories: 1,
    sodium: 1,
    sat_fat: 1,
    added_sugar: 1,
    fiber: 1,
    protein: 1,
  },
};

const DEFAULT_GUIDELINES = {
  daily_calories_default: 2000,
  meals_per_day_default: 3,
  daily_sodium_mg_default: 2300,
  daily_saturated_fat_g_default: 20,
  serving_targets: {
    calories_kcal: 'daily_calories_default / meals_per_day_default',
    sodium_mg: 'daily_sodium_mg_default / meals_per_day_default',
    saturated_fat_g: 'daily_saturated_fat_g_default / meals_per_day_default',
  },
};

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mergePolicy(base, override) {
  if (!override || typeof override !== 'object') return base;
  return {
    ...base,
    ...override,
    amdr: { ...base.amdr, ...(override.amdr || {}) },
    meal_fractions_default: { ...base.meal_fractions_default, ...(override.meal_fractions_default || {}) },
    weights: { ...base.weights, ...(override.weights || {}) },
  };
}

export async function loadNutritionPolicy() {
  try {
    const res = await fetch('./built/nutrition-policy.json');
    if (res.ok) {
      const parsed = await res.json();
      return mergePolicy(DEFAULT_POLICY, parsed);
    }
  } catch (err) {
    console.warn('Unable to load nutrition policy', err);
  }

  try {
    const res = await fetch('./built/nutrition-guidelines.json');
    if (res.ok) {
      const parsed = await res.json();
      const mealTarget = coerceNumber(parsed?.meal_calories_target);
      const dailyKcal = mealTarget ? mealTarget * DEFAULT_POLICY.default_meals_per_day : null;
      return mergePolicy(DEFAULT_POLICY, dailyKcal ? { default_daily_kcal: dailyKcal } : {});
    }
  } catch (err) {
    console.warn('Unable to load nutrition guideline fallback', err);
  }

  return DEFAULT_POLICY;
}

export async function loadNutritionGuidelines() {
  try {
    const res = await fetch('./built/nutrition-guidelines.json');
    if (res.ok) {
      const parsed = await res.json();
      return { ...DEFAULT_GUIDELINES, ...(parsed || {}) };
    }
  } catch (err) {
    console.warn('Unable to load nutrition guidelines', err);
  }
  return DEFAULT_GUIDELINES;
}

export async function loadIngredientPortions() {
  try {
    const res = await fetch('./built/ingredient-portions.json');
    if (res.ok) {
      const parsed = await res.json();
      const map = new Map();
      parsed.forEach((entry) => {
        if (!entry?.ingredient_id || !entry?.unit) return;
        const normalizedUnit = normalizeUnit(entry.unit);
        if (!normalizedUnit) return;
        const grams = Number(entry.grams);
        if (!Number.isFinite(grams)) return;
        map.set(`${entry.ingredient_id}::${normalizedUnit}`, {
          ingredient_id: entry.ingredient_id,
          unit: normalizedUnit,
          grams,
          source: entry.source || '',
          notes: entry.notes || '',
        });
      });
      return map;
    }
  } catch (err) {
    console.warn('Unable to load ingredient portions', err);
  }
  return new Map();
}

export async function loadIngredientUnitFactors() {
  try {
    const res = await fetch('./built/ingredient-unit-factors.json');
    if (res.ok) {
      const parsed = await res.json();
      const map = new Map();
      parsed.forEach((entry) => {
        if (!entry?.ingredient_id) return;
        const fromUnit = normalizeUnit(entry.from_unit_norm);
        const toUnit = normalizeUnit(entry.to_unit_norm);
        const factor = Number(entry.factor);
        if (!fromUnit || !toUnit || !Number.isFinite(factor)) return;
        if (!map.has(entry.ingredient_id)) map.set(entry.ingredient_id, []);
        map.get(entry.ingredient_id).push({
          ingredient_id: entry.ingredient_id,
          from_unit_norm: fromUnit,
          to_unit_norm: toUnit,
          factor,
          source: entry.source || '',
          notes: entry.notes || '',
        });
      });
      return map;
    }
  } catch (err) {
    console.warn('Unable to load ingredient unit factors', err);
  }
  return new Map();
}

export async function loadNutritionCoverage() {
  try {
    const res = await fetch('./built/nutrition-coverage.json');
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Unable to load nutrition coverage', err);
  }
  return { missing_count: null, strict: false };
}

export function normalizeMealFractions(fractions, policy = DEFAULT_POLICY) {
  const defaults = policy.meal_fractions_default || DEFAULT_POLICY.meal_fractions_default;
  const merged = { ...defaults };
  if (fractions && typeof fractions === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = coerceNumber(fractions[key]);
      if (Number.isFinite(value)) merged[key] = value;
    });
  }
  const sum = Object.values(merged).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) return { ...defaults };
  const normalized = {};
  Object.entries(merged).forEach(([key, value]) => {
    normalized[key] = (Number.isFinite(value) ? value : 0) / sum;
  });
  return normalized;
}

export function loadNutritionSettings(policy = DEFAULT_POLICY) {
  const defaults = {
    daily_kcal: policy.default_daily_kcal || DEFAULT_POLICY.default_daily_kcal,
    weight_lb: null,
    meal_fractions: normalizeMealFractions(null, policy),
  };

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const mealFractions = normalizeMealFractions(parsed?.meal_fractions, policy);
    const weightLb = coerceNumber(parsed?.weight_lb);
    const weightKg = weightLb === null ? coerceNumber(parsed?.weight_kg) : null;
    const normalizedWeightLb = Number.isFinite(weightLb)
      ? weightLb
      : (Number.isFinite(weightKg) ? weightKg * 2.20462 : null);
    return {
      daily_kcal: coerceNumber(parsed?.daily_kcal) || defaults.daily_kcal,
      weight_lb: normalizedWeightLb,
      meal_fractions: mealFractions,
    };
  } catch (err) {
    console.warn('Unable to read nutrition settings', err);
    return defaults;
  }
}

export function saveNutritionSettings(settings) {
  if (!settings) return;
  const payload = {
    daily_kcal: settings.daily_kcal,
    weight_lb: settings.weight_lb,
    meal_fractions: settings.meal_fractions,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

export function deriveDailyTargets(settings, policy = DEFAULT_POLICY) {
  const dailyKcal = coerceNumber(settings?.daily_kcal) || policy.default_daily_kcal || DEFAULT_POLICY.default_daily_kcal;
  const weightKg = settings?.weight_lb ? settings.weight_lb / 2.20462 : null;
  return {
    kcal: dailyKcal,
    sodium_mg: (policy.sodium_day_max_mg || DEFAULT_POLICY.sodium_day_max_mg),
    sat_fat_g: (dailyKcal * (policy.sat_fat_max_pct_kcal || DEFAULT_POLICY.sat_fat_max_pct_kcal)) / 9,
    added_sugar_g: (dailyKcal * (policy.added_sugar_max_pct_kcal || DEFAULT_POLICY.added_sugar_max_pct_kcal)) / 4,
    fiber_g: (dailyKcal / 1000) * (policy.fiber_g_per_1000_kcal_min || DEFAULT_POLICY.fiber_g_per_1000_kcal_min),
    protein_floor_g: weightKg
      ? (weightKg * (policy.protein_rda_g_per_kg_day || DEFAULT_POLICY.protein_rda_g_per_kg_day))
      : 0,
  };
}

function ratioToNumber(ratio) {
  const frac = parseRatio(ratio);
  if (!frac) return null;
  const value = frac.num / frac.den;
  return Number.isFinite(value) ? value : null;
}

function selectNutritionVariant(variants, normalizedUnit, amount) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { variant: null, convertedAmount: null, convertible: false };
  }
  const exact = variants.find((entry) => entry?.serving_unit_norm === normalizedUnit);
  if (exact) return { variant: exact, convertedAmount: amount, convertible: true };

  for (const entry of variants) {
    const servingUnit = entry?.serving_unit_norm;
    if (!servingUnit) continue;
    const conversion = convertUnitAmount(amount, normalizedUnit, servingUnit);
    if (conversion && Number.isFinite(conversion.amount)) {
      return { variant: entry, convertedAmount: conversion.amount, convertible: true };
    }
  }

  return { variant: null, convertedAmount: null, convertible: false };
}

function selectVariantWithFactor(ingredientId, amount, normalizedUnit, variants, unitFactors) {
  if (!ingredientId || !unitFactors) return null;
  const factors = unitFactors.get(ingredientId) || [];
  for (const factor of factors) {
    let bridgedAmount = null;
    if (normalizedUnit === factor.from_unit_norm) {
      bridgedAmount = amount * factor.factor;
    } else {
      const fromConversion = convertUnitAmount(amount, normalizedUnit, factor.from_unit_norm);
      if (!fromConversion || !Number.isFinite(fromConversion.amount)) continue;
      bridgedAmount = fromConversion.amount * factor.factor;
    }
    const match = selectNutritionVariant(variants, factor.to_unit_norm, bridgedAmount);
    if (match?.variant && Number.isFinite(match.convertedAmount)) {
      return { variant: match.variant, convertedAmount: match.convertedAmount, bridge: factor };
    }
  }
  return null;
}

function hasNumericNutrients(variant) {
  if (!variant) return false;
  const required = [
    variant.calories_kcal,
    variant.protein_g,
    variant.total_fat_g,
    variant.saturated_fat_g,
    variant.total_carbs_g,
    variant.sugars_g,
    variant.fiber_g,
    variant.sodium_mg,
    variant.calcium_mg,
    variant.iron_mg,
    variant.potassium_mg,
    variant.vitamin_c_mg,
  ];
  return required.every((value) => Number.isFinite(value));
}

export function computeBatchTotals(recipe, state) {
  const totals = {
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    sat_fat_g: 0,
    carbs_g: 0,
    sugars_g: 0,
    fiber_g: 0,
    sodium_mg: 0,
    calcium_mg: 0,
    iron_mg: 0,
    potassium_mg: 0,
    vitamin_c_mg: 0,
    added_sugar_g: null,
    coverage: { covered: 0, total: 0 },
    missing_details: [],
    missing: false,
  };

  const multiplier = getEffectiveMultiplier(state);
  const tokens = recipe?.token_order || Object.keys(recipe?.ingredients || {});

  let hasAddedSugar = false;

  tokens.forEach((token) => {
    const tokenData = recipe.ingredients?.[token];
    if (!tokenData) return;
    const option = selectOptionForToken(token, recipe, state);
    if (!option || !option.unit || !option.ratio) return;

    const amount = ratioToNumber(option.ratio);
    if (!Number.isFinite(amount)) return;

    const scaledAmount = amount * multiplier;
    const nutritionVariants = Array.isArray(option.nutrition) ? option.nutrition : (option.nutrition ? [option.nutrition] : []);
    const unitFactors = state?.ingredientUnitFactors || null;
    const selectedUnit = state?.unitSelections?.[token] || option.unit;
    const normalizedUnit = normalizeUnit(selectedUnit);

    totals.coverage.total += 1;

    if (normalizedUnit === 'recipe' && state?.recipeIndex?.has(option.ingredient_id)) {
      const referenced = state.recipeIndex.get(option.ingredient_id);
      const stack = state.recipeStack || new Set();
      if (stack.has(option.ingredient_id)) {
        totals.missing = true;
        totals.missing_details.push({
          ingredient_id: option.ingredient_id,
          unit: normalizedUnit,
          reason: 'recipe-reference-needed',
        });
        return;
      }
      const nextStack = new Set(stack);
      nextStack.add(option.ingredient_id);
      const referenceState = {
        ...state,
        recipeStack: nextStack,
      };
      const referenceTotals = computeBatchTotals(referenced, referenceState);
      if (!referenceTotals.complete) {
        totals.missing = true;
        totals.missing_details.push({
          ingredient_id: option.ingredient_id,
          unit: normalizedUnit,
          reason: 'recipe-reference-needed',
        });
        return;
      }
      totals.coverage.covered += 1;
      const factor = scaledAmount;
      totals.kcal += referenceTotals.kcal * factor;
      totals.protein_g += referenceTotals.protein_g * factor;
      totals.fat_g += referenceTotals.fat_g * factor;
      totals.sat_fat_g += referenceTotals.sat_fat_g * factor;
      totals.carbs_g += referenceTotals.carbs_g * factor;
      totals.sugars_g += referenceTotals.sugars_g * factor;
      totals.fiber_g += referenceTotals.fiber_g * factor;
      totals.sodium_mg += referenceTotals.sodium_mg * factor;
      totals.calcium_mg += referenceTotals.calcium_mg * factor;
      totals.iron_mg += referenceTotals.iron_mg * factor;
      totals.potassium_mg += referenceTotals.potassium_mg * factor;
      totals.vitamin_c_mg += referenceTotals.vitamin_c_mg * factor;
      if (Number.isFinite(referenceTotals.added_sugar_g)) {
        totals.added_sugar_g = (totals.added_sugar_g || 0) + referenceTotals.added_sugar_g * factor;
        hasAddedSugar = true;
      }
      return;
    }
    if (normalizedUnit === 'recipe') {
      totals.missing = true;
      totals.missing_details.push({
        ingredient_id: option.ingredient_id,
        unit: normalizedUnit,
        reason: 'recipe-reference-needed',
      });
      return;
    }

    const { variant, convertedAmount } = selectNutritionVariant(
      nutritionVariants,
      normalizedUnit,
      scaledAmount
    );
    let selectedVariant = variant;
    let selectedAmount = convertedAmount;
    if (!selectedVariant) {
      const factorMatch = selectVariantWithFactor(
        option.ingredient_id,
        scaledAmount,
        normalizedUnit,
        nutritionVariants,
        unitFactors
      );
      selectedVariant = factorMatch?.variant || null;
      selectedAmount = factorMatch?.convertedAmount ?? null;
    }

    if (!selectedVariant || !Number.isFinite(selectedAmount)) {
      totals.missing = true;
      const unitGroup = normalizedUnit ? unitDefinition(normalizedUnit)?.group : null;
      const hasSameGroup = nutritionVariants.some((entry) => {
        const servingGroup = unitDefinition(entry?.serving_unit_norm)?.group;
        return servingGroup && unitGroup && servingGroup === unitGroup;
      });
      totals.missing_details.push({
        ingredient_id: option.ingredient_id,
        unit: normalizedUnit || selectedUnit,
        reason: normalizedUnit === 'recipe'
          ? 'recipe-reference-needed'
          : (nutritionVariants.length === 0 ? 'missing-nutrition-row'
            : (hasSameGroup ? 'no-convertible-variant' : 'missing-cross-factor')),
      });
      return;
    }

    if (!hasNumericNutrients(selectedVariant)) {
      totals.missing = true;
      totals.missing_details.push({
        ingredient_id: option.ingredient_id,
        unit: normalizedUnit || selectedUnit,
        reason: 'non-numeric-fields',
      });
      return;
    }

    totals.coverage.covered += 1;

    const servingQty = Number.isFinite(selectedVariant.serving_qty) ? selectedVariant.serving_qty : 1;
    const servingMultiplier = servingQty ? selectedAmount / servingQty : 0;
    totals.kcal += servingMultiplier * selectedVariant.calories_kcal;
    totals.protein_g += servingMultiplier * selectedVariant.protein_g;
    totals.fat_g += servingMultiplier * selectedVariant.total_fat_g;
    totals.sat_fat_g += servingMultiplier * selectedVariant.saturated_fat_g;
    totals.carbs_g += servingMultiplier * selectedVariant.total_carbs_g;
    totals.sugars_g += servingMultiplier * selectedVariant.sugars_g;
    totals.fiber_g += servingMultiplier * selectedVariant.fiber_g;
    totals.sodium_mg += servingMultiplier * selectedVariant.sodium_mg;
    totals.calcium_mg += servingMultiplier * selectedVariant.calcium_mg;
    totals.iron_mg += servingMultiplier * selectedVariant.iron_mg;
    totals.potassium_mg += servingMultiplier * selectedVariant.potassium_mg;
    totals.vitamin_c_mg += servingMultiplier * selectedVariant.vitamin_c_mg;
  });

  if (!hasAddedSugar) {
    totals.added_sugar_g = null;
  }

  return { ...totals, complete: !totals.missing && totals.coverage.total > 0 };
}

function scaleTotals(totals, factor) {
  if (!totals) return null;
  const scaled = {
    kcal: totals.kcal * factor,
    protein_g: totals.protein_g * factor,
    fat_g: totals.fat_g * factor,
    sat_fat_g: totals.sat_fat_g * factor,
    carbs_g: totals.carbs_g * factor,
    sugars_g: totals.sugars_g * factor,
    fiber_g: totals.fiber_g * factor,
    sodium_mg: totals.sodium_mg * factor,
    calcium_mg: totals.calcium_mg * factor,
    iron_mg: totals.iron_mg * factor,
    potassium_mg: totals.potassium_mg * factor,
    vitamin_c_mg: totals.vitamin_c_mg * factor,
    added_sugar_g: totals.added_sugar_g === null ? null : totals.added_sugar_g * factor,
  };
  return scaled;
}

export function deriveServingTargets(settings, guidelines = DEFAULT_GUIDELINES) {
  const dailyCalories = coerceNumber(settings?.daily_kcal)
    || coerceNumber(guidelines?.daily_calories_default)
    || DEFAULT_GUIDELINES.daily_calories_default;
  const mealsPerDay = coerceNumber(guidelines?.meals_per_day_default)
    || DEFAULT_GUIDELINES.meals_per_day_default;
  const sodiumDaily = coerceNumber(guidelines?.daily_sodium_mg_default)
    || DEFAULT_GUIDELINES.daily_sodium_mg_default;
  const satFatDaily = coerceNumber(guidelines?.daily_saturated_fat_g_default)
    || DEFAULT_GUIDELINES.daily_saturated_fat_g_default;
  const meals = mealsPerDay > 0 ? mealsPerDay : DEFAULT_GUIDELINES.meals_per_day_default;
  return {
    calories_kcal: dailyCalories / meals,
    sodium_mg: sodiumDaily / meals,
    saturated_fat_g: satFatDaily / meals,
  };
}

export function suggestServings(totals, settings, guidelines = DEFAULT_GUIDELINES) {
  if (!totals || !totals.complete) {
    return { suggested_servings: null, perServing: null, batchTotals: totals, targets: null };
  }
  const targets = deriveServingTargets(settings, guidelines);
  const candidates = [];
  if (Number.isFinite(totals.kcal) && Number.isFinite(targets.calories_kcal)) {
    candidates.push(Math.ceil(totals.kcal / targets.calories_kcal));
  }
  if (Number.isFinite(totals.sodium_mg) && totals.sodium_mg > 0 && Number.isFinite(targets.sodium_mg)) {
    candidates.push(Math.ceil(totals.sodium_mg / targets.sodium_mg));
  }
  if (Number.isFinite(totals.sat_fat_g) && totals.sat_fat_g > 0 && Number.isFinite(targets.saturated_fat_g)) {
    candidates.push(Math.ceil(totals.sat_fat_g / targets.saturated_fat_g));
  }
  const servings = Math.max(1, ...candidates.filter((value) => Number.isFinite(value) && value > 0));
  return {
    suggested_servings: servings,
    perServing: scaleTotals(totals, 1 / servings),
    batchTotals: totals,
    targets,
  };
}

export function scaleNutritionTotals(totals, factor) {
  return scaleTotals(totals, factor);
}

export const NUTRITION_SETTINGS_KEY = SETTINGS_KEY;
