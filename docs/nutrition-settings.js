const STORAGE_KEY = 'cookingdb-nutrition-settings';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function normalizeMealFractions(fractions, policy) {
  const defaults = policy?.meal_fractions_default || {};
  const keys = Object.keys(defaults).length ? Object.keys(defaults) : MEAL_TYPES;
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

export function loadNutritionSettings(policy) {
  const defaults = {
    daily_kcal: policy?.default_daily_kcal || 2000,
    weight_kg: null,
    meal_fractions: normalizeMealFractions(policy?.meal_fractions_default || {}, policy),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const daily = Number(parsed?.daily_kcal);
    const weight = Number(parsed?.weight_kg);
    return {
      daily_kcal: Number.isFinite(daily) && daily > 0 ? daily : defaults.daily_kcal,
      weight_kg: Number.isFinite(weight) && weight > 0 ? weight : null,
      meal_fractions: normalizeMealFractions(parsed?.meal_fractions || {}, policy),
    };
  } catch (err) {
    console.warn('Unable to read nutrition settings from storage', err);
    return defaults;
  }
}

export function saveNutritionSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Unable to store nutrition settings', err);
  }
}

export function bindNutritionSettingsForm(formEl, policy, onChange) {
  if (!formEl) return null;
  let current = loadNutritionSettings(policy);

  const dailyInput = formEl.querySelector('[data-nutrition-field="daily_kcal"]');
  const weightInput = formEl.querySelector('[data-nutrition-field="weight_kg"]');
  const fractionInputs = new Map();
  formEl.querySelectorAll('[data-meal-fraction]').forEach((input) => {
    const key = input.dataset.mealFraction;
    if (key) fractionInputs.set(key, input);
  });

  const syncInputs = () => {
    if (dailyInput) dailyInput.value = current.daily_kcal;
    if (weightInput) weightInput.value = current.weight_kg || '';
    fractionInputs.forEach((input, key) => {
      const value = current.meal_fractions?.[key];
      input.value = Number.isFinite(value) ? Math.round(value * 1000) / 10 : '';
    });
  };

  const updateFromInputs = () => {
    const dailyValue = dailyInput ? Number(dailyInput.value) : current.daily_kcal;
    const weightValue = weightInput ? Number(weightInput.value) : current.weight_kg;
    const fractions = {};
    fractionInputs.forEach((input, key) => {
      const raw = Number(input.value);
      fractions[key] = Number.isFinite(raw) && raw > 0 ? raw / 100 : 0;
    });
    const normalized = normalizeMealFractions(fractions, policy);
    current = {
      daily_kcal: Number.isFinite(dailyValue) && dailyValue > 0 ? dailyValue : current.daily_kcal,
      weight_kg: Number.isFinite(weightValue) && weightValue > 0 ? weightValue : null,
      meal_fractions: normalized,
    };
    saveNutritionSettings(current);
    syncInputs();
    if (onChange) onChange(current);
  };

  if (dailyInput) dailyInput.addEventListener('change', updateFromInputs);
  if (weightInput) weightInput.addEventListener('change', updateFromInputs);
  fractionInputs.forEach((input) => {
    input.addEventListener('change', updateFromInputs);
  });

  syncInputs();
  return current;
}
