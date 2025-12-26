import { convertUnitAmount, getEffectiveMultiplier, parseRatio, selectOptionForToken } from './recipe-utils.js';

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

function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
}

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
    added_sugar_g: null,
    grams_total: 0,
    coverage: { covered: 0, total: 0 },
    missing: false,
  };

  const multiplier = getEffectiveMultiplier(state);
  const tokens = recipe?.token_order || Object.keys(recipe?.ingredients || {});

  let hasAddedSugar = false;
  let gramsCovered = 0;

  tokens.forEach((token) => {
    const tokenData = recipe.ingredients?.[token];
    if (!tokenData) return;
    const option = selectOptionForToken(token, recipe, state);
    if (!option || !option.unit || !option.ratio) return;

    const amount = ratioToNumber(option.ratio);
    if (!Number.isFinite(amount)) return;

    const nutrition = option.nutrition || null;
    const nutritionUnit = normalizeUnit(nutrition?.unit);
    const inputUnit = normalizeUnit(option.unit);

    totals.coverage.total += 1;

    if (!nutrition || !nutritionUnit || !inputUnit) {
      totals.missing = true;
      return;
    }

    const scaledAmount = amount * multiplier;
    let converted = convertUnitAmount(scaledAmount, inputUnit, nutritionUnit);
    if (!converted && state?.unitSelections?.[token]) {
      const altUnit = normalizeUnit(state.unitSelections[token]);
      if (altUnit) {
        converted = convertUnitAmount(scaledAmount, altUnit, nutritionUnit);
      }
    }

    if (!converted) {
      totals.missing = true;
      return;
    }

    const requiredFields = [
      nutrition.calories_per_unit,
      nutrition.protein_g,
      nutrition.total_fat_g,
      nutrition.saturated_fat_g,
      nutrition.total_carbs_g,
      nutrition.sugars_g,
      nutrition.fiber_g,
      nutrition.sodium_mg,
    ];

    if (requiredFields.some((value) => !Number.isFinite(value))) {
      totals.missing = true;
      return;
    }

    totals.coverage.covered += 1;

    const units = converted.amount;
    totals.kcal += units * nutrition.calories_per_unit;
    totals.protein_g += units * nutrition.protein_g;
    totals.fat_g += units * nutrition.total_fat_g;
    totals.sat_fat_g += units * nutrition.saturated_fat_g;
    totals.carbs_g += units * nutrition.total_carbs_g;
    totals.sugars_g += units * nutrition.sugars_g;
    totals.fiber_g += units * nutrition.fiber_g;
    totals.sodium_mg += units * nutrition.sodium_mg;

    if (Number.isFinite(nutrition.added_sugar_g)) {
      totals.added_sugar_g = (totals.added_sugar_g || 0) + units * nutrition.added_sugar_g;
      hasAddedSugar = true;
    }

    const grams = convertUnitAmount(scaledAmount, inputUnit, 'g');
    if (grams && Number.isFinite(grams.amount)) {
      totals.grams_total += grams.amount;
      gramsCovered += 1;
    }
  });

  if (!hasAddedSugar) {
    totals.added_sugar_g = null;
  }

  if (!gramsCovered) {
    totals.grams_total = null;
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
    grams_total: totals.grams_total === null ? null : totals.grams_total * factor,
    added_sugar_g: totals.added_sugar_g === null ? null : totals.added_sugar_g * factor,
  };
  return scaled;
}

export function estimateServings(totals, settings, mealType, policy = DEFAULT_POLICY) {
  if (!totals || !totals.complete) {
    return { servings_estimate: null, perServing: null, batchTotals: totals, debugTargets: null };
  }

  const fractions = normalizeMealFractions(settings?.meal_fractions, policy);
  const fallbackFraction = 1 / (policy.default_meals_per_day || DEFAULT_POLICY.default_meals_per_day);
  const mealFraction = Number.isFinite(fractions?.[mealType]) ? fractions[mealType] : fallbackFraction;

  const dailyKcal = coerceNumber(settings?.daily_kcal) || policy.default_daily_kcal || DEFAULT_POLICY.default_daily_kcal;
  const sodiumLimitMeal = (policy.sodium_day_max_mg || DEFAULT_POLICY.sodium_day_max_mg) * mealFraction;
  const kcalTargetMeal = dailyKcal * mealFraction;
  const satFatLimitMeal = (kcalTargetMeal * (policy.sat_fat_max_pct_kcal || DEFAULT_POLICY.sat_fat_max_pct_kcal)) / 9;
  const addedSugarLimitMeal = (kcalTargetMeal * (policy.added_sugar_max_pct_kcal || DEFAULT_POLICY.added_sugar_max_pct_kcal)) / 4;
  const fiberTargetMeal =
    (kcalTargetMeal / 1000) * (policy.fiber_g_per_1000_kcal_min || DEFAULT_POLICY.fiber_g_per_1000_kcal_min);
  const weightKg = settings?.weight_lb ? settings.weight_lb / 2.20462 : null;
  const proteinFloorMeal = weightKg
    ? weightKg * (policy.protein_rda_g_per_kg_day || DEFAULT_POLICY.protein_rda_g_per_kg_day) * mealFraction
    : 0;

  const weights = policy.weights || DEFAULT_POLICY.weights;
  let best = { servings: 1, penalty: Number.POSITIVE_INFINITY, perServing: null };

  for (let servings = 1; servings <= 20; servings += 1) {
    const perServing = scaleTotals(totals, 1 / servings);
    const penalty =
      (weights.calories || 0) * Math.abs(perServing.kcal - kcalTargetMeal) +
      (weights.sodium || 0) * Math.max(0, perServing.sodium_mg - sodiumLimitMeal) +
      (weights.sat_fat || 0) * Math.max(0, perServing.sat_fat_g - satFatLimitMeal) +
      (weights.fiber || 0) * Math.max(0, fiberTargetMeal - perServing.fiber_g) +
      (weights.protein || 0) * Math.max(0, proteinFloorMeal - perServing.protein_g);

    const penaltyWithSugar = Number.isFinite(perServing.added_sugar_g)
      ? penalty + (weights.added_sugar || 0) * Math.max(0, perServing.added_sugar_g - addedSugarLimitMeal)
      : penalty;

    if (penaltyWithSugar < best.penalty) {
      best = { servings, penalty: penaltyWithSugar, perServing };
    }
  }

  return {
    servings_estimate: best.servings,
    perServing: best.perServing,
    batchTotals: totals,
    debugTargets: {
      meal_fraction: mealFraction,
      kcal_target_meal: kcalTargetMeal,
      sodium_limit_meal: sodiumLimitMeal,
      sat_fat_limit_g_meal: satFatLimitMeal,
      added_sugar_limit_g_meal: addedSugarLimitMeal,
      fiber_target_g_meal: fiberTargetMeal,
      protein_floor_g_meal: proteinFloorMeal,
    },
  };
}

export function scaleNutritionTotals(totals, factor) {
  return scaleTotals(totals, factor);
}

export const NUTRITION_SETTINGS_KEY = SETTINGS_KEY;
