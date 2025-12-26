import {
  renderIngredientLines,
  renderStepLines,
  formatAmountForDisplay,
  formatUnitLabel,
  pluralize,
  groupLinesBySection,
  convertUnitAmount,
  recipeDefaultCompatibility,
} from './recipe-utils.js';
import {
  computeBatchTotals,
  deriveDailyTargets,
  estimateServings,
  loadNutritionPolicy,
  loadNutritionSettings,
  normalizeMealFractions,
  saveNutritionSettings,
  scaleNutritionTotals,
} from './nutrition-engine.js';

const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';

const DIETARY_BADGES = [
  { key: 'gluten_free', short: 'GF', name: 'Gluten-free' },
  { key: 'egg_free', short: 'EF', name: 'Egg-free' },
  { key: 'dairy_free', short: 'DF', name: 'Dairy-free' },
];

function formatNumber(value, options = {}) {
  const { maximumFractionDigits = 1 } = options;
  if (!Number.isFinite(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits });
}

function formatKcal(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}`;
}

const state = {
  recipes: [],
  recipeIndex: new Map(),
  selections: new Map(),
  nutritionPolicy: null,
  nutritionSettings: null,
  plan: {
    weeks: 1,
    useCustom: false,
    days: 7,
    mealsPerDay: 3,
  },
};

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeIngredients(raw, tokenOrder = []) {
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

function recipeHasDetails(recipe) {
  if (!recipe || typeof recipe !== 'object') return false;
  const ingredients = normalizeIngredients(recipe.ingredients, recipe.token_order);
  const hasIngredients = ingredients.list.length > 0;
  const hasSteps =
    (typeof recipe.steps_raw === 'string' && recipe.steps_raw.trim().length > 0) ||
    (Array.isArray(recipe.steps) && recipe.steps.length > 0);
  return hasIngredients && hasSteps;
}

function unwrapRecipeEntry(entry) {
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

function normalizeRecipeForPlanner(entry) {
  const maybe = unwrapRecipeEntry(entry);
  if (!maybe || typeof maybe !== 'object') return null;

  const title = maybe.title || entry?.title || '';
  const id = maybe.id || maybe.recipe_id || entry?.id || entry?.recipe_id || normalizeTitleKey(title);
  const ingredients = normalizeIngredients(maybe.ingredients, maybe.token_order);
  const defaultCompatibility = recipeDefaultCompatibility({
    ...maybe,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
  });

  return {
    ...maybe,
    title,
    id,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
    compatibility_default: defaultCompatibility,
    has_details: recipeHasDetails({ ...maybe, ingredients: ingredients.list, token_order: ingredients.order }),
  };
}

function loadStoredInboxRecipes() {
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecipeForPlanner).filter(Boolean);
  } catch (err) {
    console.warn('Unable to read inbox recipes from storage', err);
    return [];
  }
}

async function loadRecipes() {
  const [recipesRes, indexRes] = await Promise.all([
    fetch('./built/recipes.json'),
    fetch('./built/index.json'),
  ]);
  if (!indexRes.ok) {
    throw new Error(`Unable to load built/index.json (${indexRes.status})`);
  }
  const indexRaw = await indexRes.json();
  const indexList = Array.isArray(indexRaw) ? indexRaw : [];
  if (!recipesRes.ok) {
    throw new Error(`Unable to load built/recipes.json (${recipesRes.status})`);
  }
  const builtRaw = await recipesRes.json();
  const built = Array.isArray(builtRaw)
    ? builtRaw.map(normalizeRecipeForPlanner).filter(Boolean)
    : [];
  const inbox = loadStoredInboxRecipes();
  const recipeIndex = new Map(
    indexList
      .filter((entry) => entry && entry.id)
      .map((entry) => [String(entry.id), entry])
  );

  return { recipes: [...built, ...inbox], recipeIndex };
}

function splitRecipeTitle(rawTitle) {
  const title = (rawTitle || '').trim();
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

function getRecipeTitleParts(recipe) {
  const byline = (recipe?.byline || '').trim();
  if (byline) {
    return { title: (recipe?.title || '').trim(), name: byline };
  }
  return splitRecipeTitle(recipe?.title || '');
}

function recipeMatchesQuery(recipe, query) {
  if (!query) return true;
  const ingredientText = Object.values(recipe.ingredients || {})
    .flatMap((tokenData) => tokenData?.options || [])
    .map((opt) => [opt.display, opt.ingredient_id].filter(Boolean).join(' '))
    .join(' ');
  const haystack = [recipe.title, recipe.byline, ...(recipe.categories || []), recipe.family, ingredientText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function buildIngredientKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key || null;
}

function collectRecipeIngredientKeys(recipe) {
  const keys = new Set();
  Object.values(recipe.ingredients || {}).forEach((tokenData) => {
    (tokenData?.options || []).forEach((option) => {
      const key = buildIngredientKey(option?.ingredient_id || option?.display || option?.token);
      if (key) keys.add(key);
    });
  });
  return keys;
}

function collectSelectedIngredientKeys() {
  const keys = new Set();
  state.selections.forEach((selection) => {
    const recipeState = selection.state;
    const recipeId = selection.recipe?.id;
    recipeState.multiplier = selection.batchSize;
    recipeState.restrictions = selection.restrictions;
    const lines = renderIngredientLines(selection.recipe, recipeState);
    lines.forEach((line) => {
      line.entries.forEach((entry) => {
        const key = buildIngredientKey(entry.option?.ingredient_id || entry.option?.display || entry.text);
        if (key) keys.add(key);
      });
    });
  });
  return keys;
}

function recipeSharesIngredients(recipe, selectedIngredients) {
  if (!selectedIngredients.size) return false;
  const keys = collectRecipeIngredientKeys(recipe);
  for (const key of keys) {
    if (selectedIngredients.has(key)) return true;
  }
  return false;
}

function totalMealsNeeded() {
  if (state.plan.useCustom) {
    return Math.max(0, Math.round(state.plan.days * state.plan.mealsPerDay));
  }
  return Math.max(0, Math.round(state.plan.weeks * 7 * 3));
}

function totalMealsPlanned() {
  let total = 0;
  state.selections.forEach((selection) => {
    total += Number(selection.totalServings) || 0;
  });
  return total;
}

function updatePlanSummary() {
  const needed = totalMealsNeeded();
  const planned = totalMealsPlanned();
  const remaining = needed - planned;

  const neededEl = document.getElementById('meals-needed');
  const plannedEl = document.getElementById('meals-planned');
  const remainingEl = document.getElementById('meals-remaining');

  neededEl.textContent = needed.toLocaleString();
  plannedEl.textContent = planned.toLocaleString();
  if (remaining >= 0) {
    remainingEl.textContent = remaining.toLocaleString();
    remainingEl.classList.remove('is-over');
  } else {
    remainingEl.textContent = `+${Math.abs(remaining).toLocaleString()}`;
    remainingEl.classList.add('is-over');
  }
}

function updateMealLabels() {
  const mealsPerDayLabel = document.getElementById('meals-per-day-label');
  if (!mealsPerDayLabel) return;
  mealsPerDayLabel.textContent = state.plan.useCustom
    ? state.plan.mealsPerDay
    : 3;
}

function updateIngredientsSummary() {
  const container = document.getElementById('ingredients-summary');
  container.innerHTML = '';

  if (state.selections.size === 0) {
    const empty = document.createElement('li');
    empty.className = 'planner-empty';
    empty.textContent = 'Select recipes to see your grocery list.';
    container.appendChild(empty);
    return;
  }

  const combined = new Map();
  const extras = new Map();

  state.selections.forEach((selection) => {
    const recipeState = selection.state;
    const recipeId = selection.recipe?.id;
    recipeState.multiplier = selection.batchSize;
    recipeState.restrictions = selection.restrictions;
    const lines = renderIngredientLines(selection.recipe, recipeState);

    lines.forEach((line) => {
      line.entries.forEach((entry) => {
        const display = entry.option?.display || entry.text;
        const ingredientId = entry.option?.ingredient_id || display;
        const baseAmount = entry.display?.baseAmount;
        const baseUnit = entry.display?.baseUnit || 'count';

        if (baseAmount === null || baseAmount === undefined) {
          const key = entry.text.trim();
          if (!key) return;
          extras.set(key, (extras.get(key) || 0) + 1);
          return;
        }

        const ingredientKey = String(ingredientId).toLowerCase();
        let targetKey = `${ingredientKey}::${baseUnit}`;
        if (!combined.has(targetKey)) {
          const existing = [...combined.values()].find((item) => item.ingredientKey === ingredientKey);
          if (existing && existing.unit && baseUnit) {
            const conversion = convertUnitAmount(baseAmount, baseUnit, existing.unit);
            if (conversion) {
              existing.amount += conversion.amount;
              if (recipeId) existing.recipeIds.add(recipeId);
              return;
            }
          }
          combined.set(targetKey, {
            ingredientId,
            ingredientKey,
            display,
            unit: baseUnit,
            amount: 0,
            recipeIds: new Set(recipeId ? [recipeId] : []),
          });
        }
        combined.get(targetKey).amount += baseAmount;
        if (recipeId) combined.get(targetKey).recipeIds.add(recipeId);
      });
    });
  });

  const sorted = [...combined.values()].sort((a, b) => a.display.localeCompare(b.display));
  sorted.forEach((entry) => {
    const li = document.createElement('li');
    const amountStr = formatAmountForDisplay(entry.amount);
    const unitLabel = entry.unit ? ` ${formatUnitLabel(entry.unit, entry.amount)}` : '';
    const displayName = pluralize(entry.display, entry.amount, entry.unit || 'count');
    const main = document.createElement('span');
    main.textContent = `${amountStr}${unitLabel} ${displayName}`.trim();
    li.appendChild(main);
    const recipeCount = entry.recipeIds?.size || 0;
    if (recipeCount > 1) {
      const note = document.createElement('span');
      note.className = 'ingredients-note';
      note.textContent = `combined total — used in ${recipeCount} recipes`;
      li.appendChild(note);
    }
    container.appendChild(li);
  });

  if (extras.size) {
    const divider = document.createElement('li');
    divider.className = 'ingredients-divider';
    divider.textContent = 'Additional items:';
    container.appendChild(divider);

    [...extras.keys()].sort().forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      container.appendChild(li);
    });
  }
}

function computeSelectionNutrition(selection) {
  if (!state.nutritionPolicy || !state.nutritionSettings) return null;
  const recipeState = selection.state;
  recipeState.multiplier = selection.batchSize;
  recipeState.restrictions = selection.restrictions;
  const totals = computeBatchTotals(selection.recipe, recipeState);
  if (!totals.complete) {
    return { totals, estimate: null, perServing: null, plannedTotals: null };
  }
  const estimate = estimateServings(totals, state.nutritionSettings, selection.mealType, state.nutritionPolicy);
  const perServing = estimate?.perServing || null;
  const plannedTotals = perServing && selection.plannedServings
    ? scaleNutritionTotals(perServing, selection.plannedServings)
    : null;
  return { totals, estimate, perServing, plannedTotals };
}

function updateNutritionSummary() {
  const list = document.getElementById('planner-nutrition-metrics');
  if (!list || !state.nutritionPolicy || !state.nutritionSettings) return;
  list.innerHTML = '';

  const dailyTargets = deriveDailyTargets(state.nutritionSettings, state.nutritionPolicy);
  const totals = {
    kcal: 0,
    sodium_mg: 0,
    sat_fat_g: 0,
    sugars_g: 0,
    fiber_g: 0,
  };

  state.selections.forEach((selection) => {
    if (!selection.nutrition?.plannedTotals) return;
    totals.kcal += selection.nutrition.plannedTotals.kcal;
    totals.sodium_mg += selection.nutrition.plannedTotals.sodium_mg;
    totals.sat_fat_g += selection.nutrition.plannedTotals.sat_fat_g;
    totals.sugars_g += selection.nutrition.plannedTotals.sugars_g;
    totals.fiber_g += selection.nutrition.plannedTotals.fiber_g;
  });

  const rows = [
    ['Calories', `${formatKcal(totals.kcal)} kcal`, `Target ${formatKcal(dailyTargets.kcal)} kcal`],
    ['Sodium', `${formatNumber(totals.sodium_mg, { maximumFractionDigits: 0 })} mg`, `≤ ${formatNumber(dailyTargets.sodium_mg, { maximumFractionDigits: 0 })} mg`],
    ['Sat fat', `${formatNumber(totals.sat_fat_g)} g`, `≤ ${formatNumber(dailyTargets.sat_fat_g)} g`],
    ['Sugars', `${formatNumber(totals.sugars_g)} g`, `≤ ${formatNumber(dailyTargets.added_sugar_g)} g`],
    ['Fiber', `${formatNumber(totals.fiber_g)} g`, `≥ ${formatNumber(dailyTargets.fiber_g)} g`],
  ];

  rows.forEach(([label, value, target]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${label}</span><strong>${value}</strong><em>${target}</em>`;
    list.appendChild(li);
  });
}

function setupNutritionSettings() {
  const dailyInput = document.getElementById('planner-daily-kcal');
  const weightInput = document.getElementById('planner-weight-kg');
  const mealInputs = {
    breakfast: document.getElementById('planner-meal-breakfast'),
    lunch: document.getElementById('planner-meal-lunch'),
    dinner: document.getElementById('planner-meal-dinner'),
    snack: document.getElementById('planner-meal-snack'),
  };

  if (!dailyInput) return;

  const updateInputs = () => {
    dailyInput.value = Number.isFinite(state.nutritionSettings.daily_kcal)
      ? Math.round(state.nutritionSettings.daily_kcal)
      : '';
    if (weightInput) weightInput.value = state.nutritionSettings.weight_kg ?? '';
    const fractions = normalizeMealFractions(state.nutritionSettings.meal_fractions, state.nutritionPolicy);
    Object.entries(mealInputs).forEach(([meal, input]) => {
      if (!input) return;
      input.value = Math.round((fractions[meal] || 0) * 100);
    });
  };

  const updateSettings = () => {
    const daily = Number(dailyInput.value);
    state.nutritionSettings.daily_kcal = Number.isFinite(daily) && daily > 0
      ? daily
      : (state.nutritionPolicy?.default_daily_kcal || state.nutritionSettings.daily_kcal);

    const weight = Number(weightInput?.value);
    state.nutritionSettings.weight_kg = Number.isFinite(weight) && weight > 0 ? weight : null;

    const fractions = { ...state.nutritionSettings.meal_fractions };
    Object.entries(mealInputs).forEach(([meal, input]) => {
      if (!input) return;
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) fractions[meal] = value / 100;
    });
    state.nutritionSettings.meal_fractions = normalizeMealFractions(fractions, state.nutritionPolicy);
    saveNutritionSettings(state.nutritionSettings);
    renderSelections();
    updateNutritionSummary();
  };

  dailyInput.addEventListener('input', updateSettings);
  if (weightInput) weightInput.addEventListener('input', updateSettings);
  Object.values(mealInputs).forEach((input) => {
    if (input) input.addEventListener('input', updateSettings);
  });

  updateInputs();
}

function renderRecipeList() {
  const list = document.getElementById('planner-recipe-list');
  const query = document.getElementById('planner-search')?.value.trim().toLowerCase() || '';
  const selectedIngredients = collectSelectedIngredientKeys();

  list.innerHTML = '';

  const available = state.recipes
    .filter((recipe) => recipe.has_details)
    .filter((recipe) => recipeMatchesQuery(recipe, query))
    .sort((a, b) => {
      const aTitle = getRecipeTitleParts(a).title;
      const bTitle = getRecipeTitleParts(b).title;
      return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
    });

  if (available.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'planner-empty';
    empty.textContent = 'No recipes match that search.';
    list.appendChild(empty);
    return;
  }

  available.forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-row planner-recipe-row';

    const link = document.createElement('a');
    link.className = 'recipe-row-link';
    link.href = `recipe.html?id=${encodeURIComponent(recipe.id)}`;

    const title = document.createElement('span');
    title.className = 'recipe-row-title';

    const titleText = document.createElement('span');
    titleText.className = 'recipe-row-title-text';
    const { title: cleanTitle, name: titleName } = getRecipeTitleParts(recipe);
    titleText.textContent = cleanTitle;
    title.appendChild(titleText);

    if (titleName) {
      const nameEl = document.createElement('span');
      nameEl.className = 'recipe-row-title-name';
      nameEl.textContent = ` — ${titleName}`;
      title.appendChild(nameEl);
    }

    const compatibility = recipe.compatibility_possible || {};
    const containsGluten = compatibility.gluten_free === false;
    const containsEgg = compatibility.egg_free === false;
    const containsDairy = compatibility.dairy_free === false;
    const flags = [];
    if (!containsGluten) flags.push({ label: 'GF', title: 'Gluten-free' });
    if (!containsEgg) flags.push({ label: 'EF', title: 'Egg-free' });
    if (!containsDairy) flags.push({ label: 'DF', title: 'Dairy-free' });

    const flagContainer = document.createElement('span');
    flagContainer.className = 'recipe-row-flags';
    flagContainer.setAttribute('aria-label', 'Dietary-friendly indicators');
    flags.forEach((flag) => {
      const badge = document.createElement('span');
      badge.className = 'recipe-flag';
      badge.textContent = flag.label;
      badge.title = flag.title;
      badge.setAttribute('aria-label', flag.title);
      flagContainer.appendChild(badge);
    });

    const alreadySelected = state.selections.has(recipe.id);
    const sharesIngredients = !alreadySelected && recipeSharesIngredients(recipe, selectedIngredients);
    if (sharesIngredients) {
      li.classList.add('is-shared-ingredient');
      const sharedBadge = document.createElement('span');
      sharedBadge.className = 'recipe-flag planner-ingredient-flag';
      sharedBadge.textContent = 'Shared';
      sharedBadge.title = 'Shares ingredients with your selected recipes';
      sharedBadge.setAttribute('aria-label', sharedBadge.title);
      flagContainer.prepend(sharedBadge);
    }

    link.appendChild(title);
    link.appendChild(flagContainer);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary button-compact planner-add-button';
    button.textContent = alreadySelected ? 'Added' : 'Add';
    button.disabled = alreadySelected;
    if (!alreadySelected) {
      button.addEventListener('click', () => {
        addRecipeSelection(recipe);
      });
    }

    li.appendChild(button);
    li.appendChild(link);
    list.appendChild(li);
  });
}

function addRecipeSelection(recipe) {
  if (state.selections.has(recipe.id)) return;
  const servingsFromRecipe = Number(recipe.servings_per_batch);
  const servingsFromEstimate = Number(recipe.nutrition_estimate?.servings_estimate);
  const servingsPerBatch =
    (Number.isFinite(servingsFromRecipe) && servingsFromRecipe > 0 ? servingsFromRecipe : null) ||
    (Number.isFinite(servingsFromEstimate) && servingsFromEstimate > 0 ? servingsFromEstimate : null) ||
    4;
  const batchSize = 1;
  const defaultCompatibility = recipe.compatibility_default || recipeDefaultCompatibility(recipe);
  const mealTypes = Object.keys(state.nutritionPolicy?.meal_fractions_default || {});
  const defaultMealType = mealTypes.includes('dinner') ? 'dinner' : (mealTypes[0] || 'dinner');
  const selection = {
    recipe,
    batchSize,
    servingsPerBatch,
    totalServings: batchSize * servingsPerBatch,
    mealType: defaultMealType,
    plannedServings: 1,
    nutrition: null,
    defaultCompatibility,
    restrictions: { ...defaultCompatibility },
    state: {
      multiplier: batchSize,
      panMultiplier: 1,
      restrictions: { ...defaultCompatibility },
      selectedOptions: {},
      unitSelections: {},
      recipeIndex: state.recipeIndex,
    },
  };
  state.selections.set(recipe.id, selection);
  renderSelections();
  renderRecipeList();
  updatePlanSummary();
  updateIngredientsSummary();
  updateNutritionSummary();
}

function removeRecipeSelection(recipeId) {
  state.selections.delete(recipeId);
  renderSelections();
  renderRecipeList();
  updatePlanSummary();
  updateIngredientsSummary();
  updateNutritionSummary();
}

function renderSelections() {
  const container = document.getElementById('selected-recipes');
  container.innerHTML = '';

  if (state.selections.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'planner-empty-card';
    empty.textContent = 'No recipes selected yet. Add recipes from the list to start planning.';
    container.appendChild(empty);
    updateNutritionSummary();
    return;
  }

  state.selections.forEach((selection) => {
    const card = document.createElement('div');
    card.className = 'planner-selected-card';

    const header = document.createElement('div');
    header.className = 'planner-selected-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = selection.recipe.title;
    titleWrap.appendChild(title);

    if (selection.recipe.byline) {
      const byline = document.createElement('p');
      byline.className = 'planner-selected-byline';
      byline.textContent = selection.recipe.byline;
      titleWrap.appendChild(byline);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-button remove-button';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${selection.recipe.title}`);
    removeBtn.addEventListener('click', () => removeRecipeSelection(selection.recipe.id));

    header.appendChild(titleWrap);
    header.appendChild(removeBtn);

    const controls = document.createElement('div');
    controls.className = 'planner-selected-controls';

    const batchLabel = document.createElement('label');
    batchLabel.className = 'planner-field';
    batchLabel.textContent = 'Batch size';
    const batchInput = document.createElement('input');
    batchInput.type = 'number';
    batchInput.min = '0.25';
    batchInput.step = '0.25';
    batchInput.value = selection.batchSize;
    batchLabel.appendChild(batchInput);

    const servingsPerBatchLabel = document.createElement('label');
    servingsPerBatchLabel.className = 'planner-field';
    servingsPerBatchLabel.textContent = 'Servings per batch';
    const servingsPerBatchInput = document.createElement('input');
    servingsPerBatchInput.type = 'number';
    servingsPerBatchInput.min = '1';
    servingsPerBatchInput.step = '0.5';
    servingsPerBatchInput.value = selection.servingsPerBatch;
    servingsPerBatchLabel.appendChild(servingsPerBatchInput);

    const servingsLabel = document.createElement('label');
    servingsLabel.className = 'planner-field';
    servingsLabel.textContent = 'Total servings';
    const servingsInput = document.createElement('input');
    servingsInput.type = 'number';
    servingsInput.min = '0.25';
    servingsInput.step = '0.25';
    servingsInput.value = selection.totalServings;
    servingsLabel.appendChild(servingsInput);

    const servingSummary = document.createElement('p');
    servingSummary.className = 'planner-serving-summary';
    const updateServingSummary = () => {
      servingSummary.textContent = `Serving ${selection.totalServings.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')} meals.`;
    };
    updateServingSummary();

    batchInput.addEventListener('input', () => {
      const value = Number(batchInput.value) || selection.servingsPerBatch;
      selection.batchSize = Math.max(0.25, value);
      selection.totalServings = selection.batchSize * selection.servingsPerBatch;
      servingsInput.value = selection.totalServings.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
      updateServingSummary();
      updatePlanSummary();
      updateIngredientsSummary();
      updateNutritionDisplay();
    });

    servingsPerBatchInput.addEventListener('input', () => {
      const value = Number(servingsPerBatchInput.value) || selection.servingsPerBatch;
      selection.servingsPerBatch = Math.max(0.25, value);
      selection.totalServings = selection.batchSize * selection.servingsPerBatch;
      servingsInput.value = selection.totalServings.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
      updateServingSummary();
      updatePlanSummary();
      updateIngredientsSummary();
      updateNutritionDisplay();
    });

    servingsInput.addEventListener('input', () => {
      const value = Number(servingsInput.value) || selection.servingsPerBatch;
      selection.totalServings = Math.max(0.25, value);
      selection.batchSize = selection.servingsPerBatch ? selection.totalServings / selection.servingsPerBatch : 1;
      batchInput.value = selection.batchSize.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
      updateServingSummary();
      updatePlanSummary();
      updateIngredientsSummary();
      updateNutritionDisplay();
    });

    controls.appendChild(batchLabel);
    controls.appendChild(servingsPerBatchLabel);
    controls.appendChild(servingsLabel);

    const nutritionBlock = document.createElement('div');
    nutritionBlock.className = 'planner-nutrition-block';

    const nutritionWarning = document.createElement('p');
    nutritionWarning.className = 'planner-note planner-nutrition-warning';

    const nutritionControls = document.createElement('div');
    nutritionControls.className = 'planner-nutrition-controls';

    const mealTypeLabel = document.createElement('label');
    mealTypeLabel.className = 'planner-field';
    mealTypeLabel.textContent = 'Meal type';
    const mealTypeSelect = document.createElement('select');
    const mealTypes = Object.keys(state.nutritionPolicy?.meal_fractions_default || {});
    mealTypes.forEach((meal) => {
      const option = document.createElement('option');
      option.value = meal;
      option.textContent = meal.charAt(0).toUpperCase() + meal.slice(1);
      mealTypeSelect.appendChild(option);
    });
    mealTypeSelect.value = selection.mealType;
    mealTypeLabel.appendChild(mealTypeSelect);

    const plannedServingsLabel = document.createElement('label');
    plannedServingsLabel.className = 'planner-field';
    plannedServingsLabel.textContent = 'Planned servings';
    const plannedServingsInput = document.createElement('input');
    plannedServingsInput.type = 'number';
    plannedServingsInput.min = '0.25';
    plannedServingsInput.step = '0.25';
    plannedServingsInput.value = selection.plannedServings;
    plannedServingsLabel.appendChild(plannedServingsInput);

    nutritionControls.appendChild(mealTypeLabel);
    nutritionControls.appendChild(plannedServingsLabel);

    const estimateLine = document.createElement('p');
    estimateLine.className = 'planner-note';

    const perServingList = document.createElement('ul');
    perServingList.className = 'planner-nutrition-metrics';

    const plannedTotalsList = document.createElement('ul');
    plannedTotalsList.className = 'planner-nutrition-metrics';

    const updateNutritionDisplay = () => {
      selection.nutrition = computeSelectionNutrition(selection);
      const nutrition = selection.nutrition;
      if (!nutrition || !nutrition.totals?.complete) {
        const coverage = nutrition?.totals?.coverage?.total
          ? Math.round((nutrition.totals.coverage.covered / nutrition.totals.coverage.total) * 100)
          : 0;
        nutritionWarning.textContent = `Nutrition incomplete: ${nutrition?.totals?.coverage?.covered || 0}/${nutrition?.totals?.coverage?.total || 0} ingredients (${coverage}%) have nutrition data.`;
        nutritionWarning.style.display = '';
        estimateLine.textContent = 'Nutrition estimate unavailable for this recipe.';
        perServingList.innerHTML = '';
        plannedTotalsList.innerHTML = '';
        updateNutritionSummary();
        return;
      }

      nutritionWarning.style.display = 'none';
      estimateLine.textContent = `Estimated servings (${selection.mealType}): ${nutrition.estimate.servings_estimate}`;

      const renderMetrics = (target, label) => {
        target.innerHTML = '';
        if (!label) return;
        const heading = document.createElement('li');
        heading.className = 'planner-nutrition-heading';
        heading.textContent = label;
        target.appendChild(heading);
      };

      const addMetrics = (target, totals) => {
        const metrics = [
          ['Calories', `${formatKcal(totals.kcal)} kcal`],
          ['Protein', `${formatNumber(totals.protein_g)} g`],
          ['Fat', `${formatNumber(totals.fat_g)} g`],
          ['Carbs', `${formatNumber(totals.carbs_g)} g`],
          ['Fiber', `${formatNumber(totals.fiber_g)} g`],
          ['Sodium', `${formatNumber(totals.sodium_mg, { maximumFractionDigits: 0 })} mg`],
        ];
        metrics.forEach(([label, value]) => {
          const li = document.createElement('li');
          li.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
          target.appendChild(li);
        });
      };

      renderMetrics(perServingList, 'Per serving');
      addMetrics(perServingList, nutrition.perServing);

      renderMetrics(plannedTotalsList, 'Planned totals');
      if (nutrition.plannedTotals) {
        addMetrics(plannedTotalsList, nutrition.plannedTotals);
      }

      updateNutritionSummary();
    };

    mealTypeSelect.addEventListener('change', () => {
      selection.mealType = mealTypeSelect.value;
      updateNutritionDisplay();
    });

    plannedServingsInput.addEventListener('input', () => {
      const value = Number(plannedServingsInput.value);
      selection.plannedServings = Number.isFinite(value) && value > 0 ? value : 1;
      plannedServingsInput.value = selection.plannedServings;
      updateNutritionDisplay();
    });

    const dietary = document.createElement('div');
    dietary.className = 'planner-dietary';
    const dietaryLabel = document.createElement('p');
    dietaryLabel.className = 'planner-note';
    dietaryLabel.textContent = 'Dietary adjustments';
    dietary.appendChild(dietaryLabel);

    const defaultCompatibility = selection.defaultCompatibility || {};
    const defaultNotes = DIETARY_BADGES.filter((tag) => defaultCompatibility[tag.key]);
    if (defaultNotes.length) {
      const note = document.createElement('p');
      note.className = 'planner-note';
      note.textContent = defaultNotes
        .map((tag) => `Already ${tag.name.toLowerCase()} by default`)
        .join(' • ');
      dietary.appendChild(note);
    }

    const dietaryOptions = document.createElement('div');
    dietaryOptions.className = 'planner-dietary-options';

    DIETARY_BADGES.forEach((tag) => {
      const label = document.createElement('label');
      label.className = 'planner-dietary-pill';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selection.restrictions[tag.key];
      const compatibility = selection.recipe.compatibility_possible?.[tag.key];
      if (compatibility === false) {
        input.disabled = true;
        label.classList.add('is-disabled');
        label.title = 'No alternative available for this restriction.';
      }
      input.addEventListener('change', () => {
        selection.restrictions[tag.key] = input.checked;
        selection.state.restrictions = selection.restrictions;
        selection.state.selectedOptions = {};
        updateIngredientsSummary();
        renderRecipeList();
        updateNutritionDisplay();
      });
      label.appendChild(input);
      const span = document.createElement('span');
      span.textContent = tag.short;
      label.appendChild(span);
      dietaryOptions.appendChild(label);
    });

    dietary.appendChild(dietaryOptions);

    nutritionBlock.appendChild(nutritionWarning);
    nutritionBlock.appendChild(nutritionControls);
    nutritionBlock.appendChild(estimateLine);
    nutritionBlock.appendChild(perServingList);
    nutritionBlock.appendChild(plannedTotalsList);

    updateNutritionDisplay();

    card.appendChild(header);
    card.appendChild(controls);
    card.appendChild(nutritionBlock);
    card.appendChild(dietary);
    card.appendChild(servingSummary);

    container.appendChild(card);
  });
}

function updateCustomFieldsVisibility() {
  const fields = document.getElementById('custom-fields');
  if (fields) {
    fields.hidden = !state.plan.useCustom;
  }
}

function setupPlanControls() {
  const weeksInput = document.getElementById('weeks-input');
  const daysInput = document.getElementById('days-input');
  const mealsInput = document.getElementById('meals-per-day-input');
  const toggle = document.getElementById('customize-toggle');

  weeksInput.addEventListener('input', () => {
    state.plan.weeks = Math.max(1, Number(weeksInput.value) || 1);
    weeksInput.value = state.plan.weeks;
    if (!state.plan.useCustom) {
      state.plan.days = state.plan.weeks * 7;
      daysInput.value = state.plan.days;
    }
    updatePlanSummary();
  });

  daysInput.addEventListener('input', () => {
    state.plan.days = Math.max(1, Number(daysInput.value) || state.plan.days);
    daysInput.value = state.plan.days;
    updatePlanSummary();
  });

  mealsInput.addEventListener('input', () => {
    state.plan.mealsPerDay = Math.max(1, Number(mealsInput.value) || state.plan.mealsPerDay);
    mealsInput.value = state.plan.mealsPerDay;
    updateMealLabels();
    updatePlanSummary();
  });

  toggle.addEventListener('change', () => {
    state.plan.useCustom = toggle.checked;
    updateMealLabels();
    updateCustomFieldsVisibility();
    updatePlanSummary();
  });
}

function setupSearch() {
  const input = document.getElementById('planner-search');
  input.addEventListener('input', () => {
    renderRecipeList();
  });
}

function buildIngredientListForPrint() {
  const combined = new Map();
  const extras = new Map();

  state.selections.forEach((selection) => {
    const recipeState = selection.state;
    const recipeId = selection.recipe?.id;
    recipeState.multiplier = selection.batchSize;
    recipeState.restrictions = selection.restrictions;
    const lines = renderIngredientLines(selection.recipe, recipeState);
    lines.forEach((line) => {
      line.entries.forEach((entry) => {
        const display = entry.option?.display || entry.text;
        const ingredientId = entry.option?.ingredient_id || display;
        const baseAmount = entry.display?.baseAmount;
        const baseUnit = entry.display?.baseUnit || 'count';

        if (baseAmount === null || baseAmount === undefined) {
          const key = entry.text.trim();
          if (!key) return;
          extras.set(key, (extras.get(key) || 0) + 1);
          return;
        }

        const ingredientKey = String(ingredientId).toLowerCase();
        let targetKey = `${ingredientKey}::${baseUnit}`;
        if (!combined.has(targetKey)) {
          const existing = [...combined.values()].find((item) => item.ingredientKey === ingredientKey);
          if (existing && existing.unit && baseUnit) {
            const conversion = convertUnitAmount(baseAmount, baseUnit, existing.unit);
            if (conversion) {
              existing.amount += conversion.amount;
              if (recipeId) existing.recipeIds.add(recipeId);
              return;
            }
          }
          combined.set(targetKey, {
            ingredientId,
            ingredientKey,
            display,
            unit: baseUnit,
            amount: 0,
            recipeIds: new Set(recipeId ? [recipeId] : []),
          });
        }
        combined.get(targetKey).amount += baseAmount;
        if (recipeId) combined.get(targetKey).recipeIds.add(recipeId);
      });
    });
  });

  const sorted = [...combined.values()].sort((a, b) => a.display.localeCompare(b.display));
  const lines = sorted.map((entry) => {
    const amountStr = formatAmountForDisplay(entry.amount);
    const unitLabel = entry.unit ? ` ${formatUnitLabel(entry.unit, entry.amount)}` : '';
    const displayName = pluralize(entry.display, entry.amount, entry.unit || 'count');
    const combinedNote = entry.recipeIds?.size > 1
      ? ` (combined total — used in ${entry.recipeIds.size} recipes)`
      : '';
    return `${amountStr}${unitLabel} ${displayName}${combinedNote}`.trim();
  });

  if (extras.size) {
    lines.push('');
    lines.push('Additional items:');
    [...extras.keys()].sort().forEach((item) => lines.push(`• ${item}`));
  }

  return lines.join('\n');
}

function buildRecipesForPrint() {
  const sections = [];

  state.selections.forEach((selection) => {
    const recipeState = selection.state;
    recipeState.multiplier = selection.batchSize;
    recipeState.restrictions = selection.restrictions;

    const ingredientLines = renderIngredientLines(selection.recipe, recipeState)
      .map((line) => ({ section: line.section || null, text: line.text }));
    const groupedIngredients = groupLinesBySection(
      ingredientLines,
      selection.recipe.ingredient_sections || []
    );

    const stepLines = renderStepLines(selection.recipe, recipeState);
    const groupedSteps = groupLinesBySection(
      stepLines,
      selection.recipe.step_sections || []
    );

    const servingsLine = `Batch size: ${selection.batchSize} • Servings: ${selection.totalServings}`;

    let ingredientsHtml = '';
    groupedIngredients.forEach((group) => {
      const heading = group.section ? `<h4>${group.section}</h4>` : '';
      const list = group.lines
        .map((line) => `<li>${line.text}</li>`)
        .join('');
      ingredientsHtml += `${heading}<ul>${list}</ul>`;
    });

    let stepsHtml = '';
    groupedSteps.forEach((group) => {
      const heading = group.section ? `<h4>${group.section}</h4>` : '';
      const list = group.lines
        .map((line) => `<li>${line.text}</li>`)
        .join('');
      stepsHtml += `${heading}<ol>${list}</ol>`;
    });

    sections.push(`
      <section>
        <h3>${selection.recipe.title}</h3>
        <p class="print-subtitle">${servingsLine}</p>
        <div class="print-block">
          <h4>Ingredients</h4>
          ${ingredientsHtml}
        </div>
        <div class="print-block">
          <h4>Steps</h4>
          ${stepsHtml}
        </div>
      </section>
    `);
  });

  return sections.join('');
}

function openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) return;

  win.document.write(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { font-family: 'Source Sans 3', Arial, sans-serif; padding: 2rem; color: #1e120b; }
          h1 { font-family: 'Source Serif 4', Georgia, serif; margin-top: 0; }
          h3 { margin-top: 2rem; }
          h4 { margin-top: 1.4rem; }
          ul, ol { margin: 0.4rem 0 0.8rem 1.2rem; }
          .print-subtitle { margin: 0.4rem 0 1rem; color: #5e5147; }
          .print-block { margin-bottom: 1rem; }
          pre { background: #fff7ea; padding: 1rem; border-radius: 8px; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${bodyHtml}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function setupPrintButtons() {
  const ingredientsBtn = document.getElementById('print-ingredients');
  const recipesBtn = document.getElementById('print-recipes');

  ingredientsBtn.addEventListener('click', () => {
    const content = buildIngredientListForPrint();
    if (!content.trim()) return;
    openPrintWindow('Meal prep ingredients', `<pre>${content}</pre>`);
  });

  recipesBtn.addEventListener('click', () => {
    if (state.selections.size === 0) return;
    const content = buildRecipesForPrint();
    openPrintWindow('Meal prep recipes', content);
  });
}

async function startPlanner() {
  const [recipesPayload, nutritionPolicy] = await Promise.all([
    loadRecipes(),
    loadNutritionPolicy(),
  ]);
  const { recipes, recipeIndex } = recipesPayload;
  state.recipes = recipes;
  state.recipeIndex = recipeIndex;
  state.nutritionPolicy = nutritionPolicy;
  state.nutritionSettings = loadNutritionSettings(nutritionPolicy);

  setupPlanControls();
  setupSearch();
  setupPrintButtons();
  setupNutritionSettings();
  updateCustomFieldsVisibility();
  updateMealLabels();
  updatePlanSummary();
  renderRecipeList();
  renderSelections();
  updateIngredientsSummary();
  updateNutritionSummary();
}

startPlanner();
