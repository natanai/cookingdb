import {
  DIETARY_TAGS,
  restrictionsActive,
  recipeDefaultCompatibility,
  hasNonCompliantAlternative,
  renderIngredientLines,
  renderStepLines,
  groupLinesBySection,
  selectOptionForToken,
  optionMeetsRestrictions,
  getEffectiveMultiplier,
  unitOptionsFor,
  convertUnitAmount,
} from './recipe-utils.js';
import { estimateServings } from './nutrition-engine.js';
import { bindNutritionSettingsForm, loadNutritionSettings, MEAL_TYPES } from './nutrition-settings.js';

const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';

const DIETARY_BADGES = [
  { key: 'gluten_free', short: 'GF', name: 'Gluten-free' },
  { key: 'egg_free', short: 'EF', name: 'Egg-free' },
  { key: 'dairy_free', short: 'DF', name: 'Dairy-free' },
];

function recipeHasDetails(recipe) {
  if (!recipe || typeof recipe !== 'object') return false;
  const ingredients = normalizeIngredients(recipe.ingredients, recipe.token_order);
  const hasIngredients = ingredients.list.length > 0;
  const hasSteps =
    (typeof recipe.steps_raw === 'string' && recipe.steps_raw.trim().length > 0) ||
    (Array.isArray(recipe.steps) && recipe.steps.length > 0);
  return hasIngredients && hasSteps;
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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

/**
 * Unwrap various possible inbox / db shapes into a recipe-ish object.
 * Supports:
 *  - <recipe>
 *  - { recipe: <recipe> }
 *  - { payload: <recipe> }
 *  - { title, payload: <recipe> }
 *  - { payload: { title, payload: <recipe> } }
 */
function unwrapRecipeEntry(entry) {
  let obj = entry;
  for (let i = 0; i < 4; i += 1) {
    if (!obj || typeof obj !== 'object') break;

    // Common wrappers
    if (obj.recipe && typeof obj.recipe === 'object') {
      obj = obj.recipe;
      continue;
    }

    if (obj.payload && typeof obj.payload === 'object') {
      // If payload itself is an envelope { title, payload: <recipe> }
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

function normalizeRecipeForPage(entry) {
  const maybe = unwrapRecipeEntry(entry);
  if (!maybe || typeof maybe !== 'object') return null;

  const title = maybe.title || entry?.title || '';
  const id = maybe.id || maybe.recipe_id || entry?.id || entry?.recipe_id || normalizeTitleKey(title);

  const ingredients = normalizeIngredients(maybe.ingredients, maybe.token_order);

  // Prefer explicit compatibility_possible, otherwise compute a default
  const compatibility_possible =
    maybe.compatibility_possible && typeof maybe.compatibility_possible === 'object'
      ? maybe.compatibility_possible
      : recipeDefaultCompatibility({ ...maybe, ingredients: ingredients.byToken, token_order: ingredients.order });

  return {
    ...maybe,
    title,
    id,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
    compatibility_possible,
    has_details: recipeHasDetails({ ...maybe, ingredients: ingredients.list, token_order: ingredients.order }),
  };
}

function loadStoredInboxRecipes() {
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecipeForPage)
      .filter(Boolean);
  } catch (err) {
    console.warn('Unable to read inbox recipes from storage', err);
    return [];
  }
}

async function loadRecipes() {
  const [recipesRes, indexRes] = await Promise.all([fetch('./built/recipes.json'), fetch('./built/index.json')]);
  if (!indexRes.ok) {
    throw new Error(`Unable to load built/index.json (${indexRes.status})`);
  }
  const indexRaw = await indexRes.json();
  const indexList = Array.isArray(indexRaw) ? indexRaw : [];
  if (!recipesRes.ok) {
    throw new Error(`Unable to load built/recipes.json (${recipesRes.status})`);
  }
  const builtRaw = await recipesRes.json();
  const built = Array.isArray(builtRaw) ? builtRaw.map(normalizeRecipeForPage).filter(Boolean) : [];
  const inbox = loadStoredInboxRecipes();
  const recipeIndex = new Map(
    indexList
      .filter((entry) => entry && entry.id)
      .map((entry) => [String(entry.id), entry])
  );
  return { recipes: [...built, ...inbox], recipeIndex };
}

async function loadNutritionPolicy() {
  const response = await fetch('./built/nutrition_policy.json');
  if (!response.ok) {
    throw new Error(`Unable to load nutrition policy (${response.status})`);
  }
  return response.json();
}

function getRecipeIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function getDietaryFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const parseParam = (key) => (params.has(key) ? params.get(key) === '1' : undefined);
  return {
    gluten_free: parseParam('gluten_free'),
    egg_free: parseParam('egg_free'),
    dairy_free: parseParam('dairy_free'),
  };
}

function updateQueryFromState(state) {
  const params = new URLSearchParams(window.location.search);
  ['gluten_free', 'egg_free', 'dairy_free'].forEach((key) => {
    const value = state.restrictions?.[key];
    if (value) {
      params.set(key, '1');
    } else {
      params.delete(key);
    }
  });

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', newUrl);
}

function renderDietaryBadges(
  container,
  state,
  defaultCompatibility,
  compatibilityPossible,
  restrictionCanRelax,
  onChange
) {
  container.innerHTML = '';

  DIETARY_BADGES.forEach(({ key, short, name }) => {
    const possible = !!compatibilityPossible[key];
    const ready = !!defaultCompatibility[key];

    const status = !possible ? 'cannot' : ready ? 'ready' : 'can-become';
    const lockedOn = ready && !restrictionCanRelax[key];

    const label = document.createElement('label');
    label.className = `diet-badge diet-badge--${status}`;
    if (!possible) label.classList.add('is-disabled');
    if (lockedOn) label.classList.add('is-locked');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!state.restrictions[key];
    input.disabled = !possible || lockedOn;

    input.addEventListener('change', () => {
      state.restrictions[key] = input.checked;
      if (typeof onChange === 'function') onChange();
      updateQueryFromState(state);
    });

    const text = document.createElement('span');
    text.className = 'diet-badge__text';
    text.textContent = short;

    const icon = document.createElement('span');
    icon.className = 'diet-badge__icon';
    icon.setAttribute('aria-hidden', 'true');

    if (!possible) {
      label.title = `${name}: no known swaps available`;
    } else if (ready) {
      label.title = lockedOn
        ? `${name}: already meets (always)`
        : `${name}: already meets (click to allow non-${name.toLowerCase()})`;
    } else {
      label.title = `${name}: click to apply swaps`;
    }

    label.appendChild(input);
    label.appendChild(text);
    label.appendChild(icon);
    container.appendChild(label);
  });
}

function panArea(pan) {
  if (!pan) return null;
  const shape = (pan.shape || 'rectangle').toLowerCase();
  const width = Number(pan.width);
  if (!Number.isFinite(width) || width <= 0) return null;

  if (shape === 'round') {
    const radius = width / 2;
    return Math.PI * radius * radius;
  }

  const height = Number(pan.height) || (shape === 'square' ? width : null);
  if (!Number.isFinite(height) || height <= 0) return null;
  return width * height;
}

function buildChoiceControls(recipe, state, onChange) {
  const swapList = document.getElementById('swap-list');
  const adjustDetails = document.getElementById('adjust-details');
  const adjustSummary = document.getElementById('adjust-summary');

  if (!swapList || !adjustDetails || !adjustSummary) return;

  const choices = recipe?.choices && typeof recipe.choices === 'object' ? recipe.choices : {};
  const ingredients = recipe?.ingredients && typeof recipe.ingredients === 'object' ? recipe.ingredients : {};

  const choiceEntries = Object.entries(choices).filter(([token]) => {
    const selectable = ingredients[token]?.options?.filter((opt) => opt.option) || [];
    return selectable.length >= 2;
  });

  swapList.innerHTML = '';

  if (!adjustDetails.dataset.initialized) {
    adjustDetails.open = false;
    adjustDetails.dataset.initialized = 'true';
  }

  const createChoiceGroup = ([token, choice]) => {
    const tokenData = ingredients[token];
    const selectable = tokenData?.options?.filter((opt) => opt.option) || [];
    if (selectable.length < 2) return null;

    const row = document.createElement('div');
    row.className = 'swap-row';

    const label = document.createElement('span');
    label.className = 'swap-label';
    label.textContent = `Swap ${choice?.label || token}`;

    const select = document.createElement('select');
    select.dataset.token = token;
    select.title = 'Choose which ingredient to use. This updates ingredients and steps.';

    const preferred = selectOptionForToken(token, recipe, state);

    selectable.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.option;
      optionEl.textContent = opt.display;
      const compatible = optionMeetsRestrictions(opt, state.restrictions);
      optionEl.disabled = restrictionsActive(state.restrictions) && !compatible;
      if (preferred?.option && preferred.option === opt.option) {
        optionEl.selected = true;
      }
      select.appendChild(optionEl);
    });

    select.addEventListener('change', () => {
      state.selectedOptions[token] = select.value;
      onChange();
    });

    if (preferred?.option) {
      state.selectedOptions[token] = preferred.option;
    }

    row.appendChild(label);
    row.appendChild(select);
    return row;
  };

  let renderedGroups = 0;
  choiceEntries.forEach((entry) => {
    const group = createChoiceGroup(entry);
    if (group) {
      renderedGroups += 1;
      swapList.appendChild(group);
    }
  });

  return { hasSwapAdjustments: renderedGroups > 0, swapGroupCount: renderedGroups };
}

function renderIngredientsList(recipe, state, onUnitChange) {
  const list = document.getElementById('ingredients-list');
  if (!list) return;

  list.innerHTML = '';

  const lines = renderIngredientLines(recipe, { ...state, recipe });

  if (!lines.length) {
    const li = document.createElement('li');
    li.innerHTML = '<em>This recipe was imported without full ingredient data.</em>';
    list.appendChild(li);
    return;
  }

  const sections = groupLinesBySection(lines, recipe.ingredient_sections || []);

  sections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      list.appendChild(header);
    }

    section.lines.forEach((line) => {
      const li = document.createElement('li');

      line.entries.forEach((entry, idx) => {
        const textSpan = document.createElement('span');
        textSpan.textContent = entry.text;
        li.appendChild(textSpan);

        const unitOptions = unitOptionsFor(entry.option?.unit);
        const unitSelections = state.unitSelections || (state.unitSelections = {});
        const selectedUnit = unitSelections[entry.token];
        const display = entry.display;

        if (unitOptions.length > 1 && entry.option?.ratio) {
          const unitSelect = document.createElement('select');
          unitSelect.className = 'unit-select';
          const currentUnit = selectedUnit || entry.option.unit;
          unitOptions.forEach((unit) => {
            const opt = document.createElement('option');
            opt.value = unit.id;
            opt.textContent = unit.label;
            if (unit.id === currentUnit) opt.selected = true;
            unitSelect.appendChild(opt);
          });

          if (!unitSelections[entry.token]) {
            unitSelections[entry.token] = currentUnit;
          }

          unitSelect.addEventListener('change', () => {
            unitSelections[entry.token] = unitSelect.value;
            if (typeof onUnitChange === 'function') onUnitChange();
          });

          li.appendChild(unitSelect);

          if (
            display &&
            display.baseAmount !== null &&
            display.baseUnit &&
            display.displayUnit &&
            display.displayUnit !== display.baseUnit
          ) {
            const factorConversion = convertUnitAmount(1, display.baseUnit, display.displayUnit);
            const factor = factorConversion ? factorConversion.amount : display.conversionFactor;
            const factorStr = Number.isFinite(factor)
              ? factor
                  .toFixed(3)
                  .replace(/\.0+$/, '')
                  .replace(/(\.\d*[1-9])0+$/, '$1')
              : null;

            const parts = [
              `Base: ${display.baseAmountStr} ${display.baseUnitLabel}`.trim(),
              `Converted: ${display.amountStr} ${display.convertedUnitLabel}`.trim(),
            ];

            if (factorStr) {
              parts.push(`1 ${display.baseUnitLabel} = ${factorStr} ${display.convertedUnitLabel}`.trim());
            }

            const note = document.createElement('div');
            note.className = 'conversion-note';
            note.textContent = parts.join(' · ');
            textSpan.title = parts.join(' | ');
            li.appendChild(note);
          }
        }

        if (idx < line.entries.length - 1) {
          const joiner = document.createElement('span');
          joiner.className = 'ingredient-joiner';
          joiner.textContent = ' + ';
          li.appendChild(joiner);
        }
      });

      const altText = Array.from(new Set((line.alternatives || []).filter(Boolean))).join(' / ');
      if (altText) {
        const altSpan = document.createElement('span');
        altSpan.className = 'ingredient-alternatives';
        altSpan.textContent = ` (or ${altText})`;
        li.appendChild(altSpan);
      }

      list.appendChild(li);
    });
  });
}

function renderSteps(recipe, state) {
  const steps = document.getElementById('steps-list');
  if (!steps) return;

  steps.innerHTML = '';

  const stepLines = renderStepLines(recipe, { ...state, recipe });

  if (stepLines.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<em>This recipe was imported without step text.</em>';
    steps.appendChild(li);
    return;
  }

  const sections = groupLinesBySection(stepLines, recipe.step_sections || []);

  sections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      steps.appendChild(header);
    }

    section.lines.forEach((line) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.innerHTML = `<span class="step-text">${line.text}</span>`;
      steps.appendChild(li);
    });
  });
}

function setupPanControls(recipe, state, rerender) {
  const panControls = document.getElementById('pan-controls');
  const panSelect = document.getElementById('pan-select');
  const panNote = document.getElementById('pan-note');

  if (!panControls || !panSelect || !panNote) {
    state.panMultiplier = 1;
    return false;
  }

  const panSizes = Array.isArray(recipe?.pan_sizes) ? recipe.pan_sizes : [];
  const validPans = panSizes.filter((pan) => panArea(pan) != null);

  const basePan = validPans.find((p) => p.id === recipe.default_pan) || validPans[0] || null;
  const baseArea = basePan ? panArea(basePan) : null;
  const meaningful =
    validPans.length >= 2 &&
    baseArea &&
    validPans.some((p) => {
      const area = panArea(p);
      return area && Math.abs(area / baseArea - 1) >= 0.01;
    });

  if (panSizes.length && validPans.length === 0) {
    console.warn('Pan sizes ignored: missing dimensions for scaling');
  }

  if (!meaningful || !basePan || !baseArea) {
    state.panMultiplier = 1;
    state.selectedPanId = recipe?.default_pan || null;
    panControls.remove();
    return false;
  }

  panControls.hidden = false;
  panSelect.innerHTML = '';

  const initialPanId = validPans.some((pan) => pan.id === state.selectedPanId)
    ? state.selectedPanId
    : basePan.id;

  validPans.forEach((pan) => {
    const optionEl = document.createElement('option');
    optionEl.value = pan.id;
    optionEl.textContent = pan.label || pan.id;
    if (pan.id === initialPanId) optionEl.selected = true;
    panSelect.appendChild(optionEl);
  });

  const updatePanMultiplier = () => {
    const selectedId = panSelect.value || basePan.id;
    state.selectedPanId = selectedId;

    const selectedPan = validPans.find((p) => p.id === selectedId);
    const selectedArea = panArea(selectedPan);

    if (!baseArea || !selectedArea) {
      state.panMultiplier = 1;
      panNote.textContent = 'Pan scaling is unavailable for this recipe.';
      rerender();
      return;
    }

    state.panMultiplier = selectedArea / baseArea;

    const baseLabel = basePan?.label || basePan?.id || 'default pan';
    const selectedLabel = selectedPan?.label || selectedPan?.id || 'selected pan';
    panNote.textContent = `Scaling from ${baseLabel} to ${selectedLabel}.`;

    rerender();
  };

  panSelect.addEventListener('change', updatePanMultiplier);
  updatePanMultiplier();

  return true;
}

function renderRecipe(recipeInput, nutritionPolicy) {
  const recipe = normalizeRecipeForPage(recipeInput) || recipeInput;

  const titleEl = document.getElementById('recipe-title');
  const notesEl = document.getElementById('notes');
  const familyInline = document.getElementById('family-inline');
  const categoryInline = document.getElementById('category-inline');
  const dietaryBadges = document.getElementById('dietary-badges');
  const multiplierInput = document.getElementById('multiplier');
  const multiplierHelper = document.getElementById('multiplier-helper');
  const ingredientsHeading = document.getElementById('ingredients-heading');
  const heroContent = document.querySelector('.hero-content');
  const recipeNoteDetails = document.querySelector('.recipe-note');
  const nutritionEl = document.getElementById('recipe-nutrition');
  const nutritionDetails = document.getElementById('recipe-nutrition-details');
  const nutritionFootnote = document.getElementById('recipe-nutrition-footnote');
  const nutritionTargets = document.getElementById('recipe-nutrition-targets');
  const nutritionList = document.getElementById('recipe-nutrition-list');
  const nutritionIncomplete = document.getElementById('nutrition-incomplete');
  const nutritionSettingsForm = document.querySelector('[data-nutrition-settings]');
  const mealTypeSelect = document.getElementById('meal-type-select');

  const defaultCompatibility = recipeDefaultCompatibility(recipe);
  const compatibilityPossible = recipe.compatibility_possible || {};
  const queryRestrictions = getDietaryFromQuery();

  const hasDetails = recipeHasDetails(recipe);

  const restrictionCanRelax = {
    gluten_free: hasNonCompliantAlternative(recipe, 'gluten_free'),
    egg_free: hasNonCompliantAlternative(recipe, 'egg_free'),
    dairy_free: hasNonCompliantAlternative(recipe, 'dairy_free'),
  };

  const resolveRestriction = (restrictionKey) => {
    if (defaultCompatibility[restrictionKey] && !restrictionCanRelax[restrictionKey]) return true;
    const queryValue = queryRestrictions[restrictionKey];
    if (queryValue !== undefined) return queryValue;
    return defaultCompatibility[restrictionKey];
  };

  const state = {
    multiplier: Number(recipe.default_base) || 1,
    panMultiplier: 1,
    selectedPanId: recipe.default_pan || null,
    selectedOptions: {},
    unitSelections: {},
    recipeIndex: recipe.recipeIndex || null,
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? resolveRestriction('gluten_free') : false,
      egg_free: compatibilityPossible.egg_free ? resolveRestriction('egg_free') : false,
      dairy_free: compatibilityPossible.dairy_free ? resolveRestriction('dairy_free') : false,
    },
  };

  if (multiplierInput) multiplierInput.value = state.multiplier;

  if (ingredientsHeading) {
    ingredientsHeading.textContent = hasDetails ? 'Ingredients' : 'Ingredients (pending)';
  }

  const noteText = typeof recipe.notes === 'string' ? recipe.notes.trim() : '';
  if (recipeNoteDetails) {
    if (noteText) {
      recipeNoteDetails.style.display = '';
      if (notesEl) notesEl.textContent = recipe.notes;
    } else {
      recipeNoteDetails.style.display = 'none';
    }
  }

  if (!hasDetails && heroContent) {
    const warning = document.createElement('div');
    warning.className = 'callout warning';
    warning.textContent =
      'This inbox recipe is missing ingredients or steps. Pull the inbox again later to load the full details.';
    heroContent.prepend(warning);
  }

  if (familyInline) {
    const familyName = (recipe.family || '').trim();
    if (familyName) {
      familyInline.textContent = `Family: ${familyName}`;
      familyInline.style.display = '';
    } else {
      familyInline.style.display = 'none';
    }
  }

  if (categoryInline) {
    const categories = Array.isArray(recipe.categories) ? recipe.categories.filter(Boolean) : [];
    categoryInline.textContent = categories.join(' • ');
  }

  const formatValue = (value, decimals = 0) => {
    if (!Number.isFinite(value)) return '—';
    const fixed = value.toFixed(decimals);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  };

  const updateNutrition = (settings) => {
    if (!nutritionEl) return;
    const estimateData = recipe.nutrition_estimate || null;
    const batchTotals = estimateData?.batch_totals || null;
    const isComplete = estimateData?.is_complete !== false;

    if (!batchTotals) {
      nutritionEl.hidden = true;
      return;
    }

    if (nutritionIncomplete) {
      nutritionIncomplete.hidden = isComplete;
    }

    if (!isComplete) {
      if (nutritionDetails) {
        nutritionDetails.textContent = 'Nutrition estimate unavailable (missing ingredient data).';
      }
      if (nutritionList) nutritionList.innerHTML = '';
      if (nutritionTargets) nutritionTargets.textContent = '';
      if (nutritionFootnote) {
        const coverage = estimateData.total_ingredients
          ? Math.round((estimateData.coverage_ratio || 0) * 100)
          : 0;
        nutritionFootnote.textContent =
          `Coverage: ${estimateData.covered_ingredients}/${estimateData.total_ingredients} ingredients (${coverage}%).`;
      }
      nutritionEl.hidden = false;
      return;
    }

    const mealType = mealTypeSelect?.value || 'dinner';
    const estimate = estimateServings(batchTotals, settings, nutritionPolicy, mealType);
    if (!estimate) {
      nutritionDetails.textContent = 'Nutrition estimate unavailable (missing ingredient data).';
      nutritionEl.hidden = false;
      return;
    }

    if (nutritionDetails) {
      nutritionDetails.textContent = `Estimated servings (meal-sized): ${estimate.servings_estimate}`;
    }
    if (nutritionList) {
      const perServing = estimate.perServing || {};
      nutritionList.innerHTML = '';
      const items = [
        ['kcal', formatValue(perServing.kcal), 'kcal'],
        ['Protein', formatValue(perServing.protein_g), 'g'],
        ['Fat', formatValue(perServing.fat_g), 'g'],
        ['Sat fat', formatValue(perServing.sat_fat_g), 'g'],
        ['Carbs', formatValue(perServing.carbs_g), 'g'],
        ['Sugars', formatValue(perServing.sugars_g), 'g'],
        ['Fiber', formatValue(perServing.fiber_g), 'g'],
        ['Sodium', formatValue(perServing.sodium_mg), 'mg'],
      ];
      items.forEach(([label, value, unit]) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${label}:</span> ${value} ${unit}`;
        nutritionList.appendChild(li);
      });
    }
    if (nutritionTargets) {
      const targets = estimate.debugTargets || {};
      nutritionTargets.textContent =
        `Based on your targets: ~${formatValue(targets.kcal_target_meal)} kcal/meal, ` +
        `sodium ≤ ${formatValue(targets.sodium_limit_meal)} mg/meal, ` +
        `sat fat ≤ ${formatValue(targets.sat_fat_limit_g_meal, 1)} g/meal, ` +
        `fiber ≥ ${formatValue(targets.fiber_target_g_meal, 1)} g/meal.`;
    }
    if (nutritionFootnote) {
      const coverage = estimateData.total_ingredients
        ? Math.round((estimateData.coverage_ratio || 0) * 100)
        : 0;
      nutritionFootnote.textContent =
        `Coverage: ${estimateData.covered_ingredients}/${estimateData.total_ingredients} ingredients (${coverage}%).`;
    }
    nutritionEl.hidden = false;
  };

  let nutritionSettings = loadNutritionSettings(nutritionPolicy);
  bindNutritionSettingsForm(nutritionSettingsForm, nutritionPolicy, (updated) => {
    nutritionSettings = updated;
    updateNutrition(nutritionSettings);
  });

  if (mealTypeSelect) {
    mealTypeSelect.addEventListener('change', () => updateNutrition(nutritionSettings));
    if (!MEAL_TYPES.includes(mealTypeSelect.value)) {
      mealTypeSelect.value = 'dinner';
    }
  }

  updateNutrition(nutritionSettings);

  const updateMultiplierHelper = () => {
    if (!multiplierHelper) return;
    const effective = getEffectiveMultiplier(state);
    const panActive = Math.abs(state.panMultiplier - 1) > 1e-3;
    const baseActive = Math.abs(Number(state.multiplier) - (Number(recipe.default_base) || 1)) > 1e-3;
    const parts = [];
    if (panActive) parts.push(`pan scaling ×${state.panMultiplier.toFixed(2)}`);
    if (baseActive) parts.push(`batch multiplier ×${Number(state.multiplier).toFixed(2)}`);
    multiplierHelper.textContent = parts.length
      ? `Total scaling ×${effective.toFixed(2)} (${parts.join(' · ')}).`
      : `Using recipe as written (×${effective.toFixed(2)}).`;
  };

  const rerender = () => {
    const base = Number(recipe.default_base) || 1;
    state.multiplier = multiplierInput ? Number(multiplierInput.value) || base : base;
    renderIngredientsList(recipe, state, rerender);
    renderSteps(recipe, state);
    updateMultiplierHelper();
  };

  const syncSelections = () => {
    const choices = recipe?.choices && typeof recipe.choices === 'object' ? recipe.choices : {};
    Object.keys(choices).forEach((token) => selectOptionForToken(token, recipe, state));
  };

  const handleRestrictionChange = () => {
    syncSelections();
    buildChoiceControls(recipe, state, rerender);
    rerender();
  };

  const refreshDietaryBadges = () => {
    if (!dietaryBadges) return;
    renderDietaryBadges(
      dietaryBadges,
      state,
      defaultCompatibility,
      compatibilityPossible,
      restrictionCanRelax,
      () => {
        handleRestrictionChange();
        refreshDietaryBadges();
      }
    );
  };

  const hasPanAdjustments = setupPanControls(recipe, state, rerender);
  syncSelections();
  const swapResult = buildChoiceControls(recipe, state, rerender) || {
    hasSwapAdjustments: false,
    swapGroupCount: 0,
  };
  refreshDietaryBadges();

  const dietaryToggleEnabled = (key) => {
    const possible = !!compatibilityPossible[key];
    const ready = !!defaultCompatibility[key];
    const lockedOn = ready && !restrictionCanRelax[key];
    return possible && !lockedOn;
  };

  const hasSelectableDietaryAdjustments = DIETARY_BADGES.some(({ key }) => dietaryToggleEnabled(key));

  const adjustSummary = document.getElementById('adjust-summary');
  const adjustDetails = document.getElementById('adjust-details');
  const adjustDivider = document.getElementById('adjust-divider');

  const adjustmentCount = [hasPanAdjustments, swapResult.hasSwapAdjustments, hasSelectableDietaryAdjustments]
    .filter(Boolean)
    .length;

  const hasAnyAdjustments = adjustmentCount > 0;

  if (!hasAnyAdjustments) {
    if (adjustDetails) adjustDetails.remove();
  } else {
    if (adjustSummary) {
      adjustSummary.textContent = adjustmentCount ? `Adjust recipe (${adjustmentCount})` : 'Adjust recipe';
    }

    if (adjustDetails && !adjustDetails.dataset.initialized) {
      adjustDetails.open = false;
      adjustDetails.dataset.initialized = 'true';
    }

    if (adjustDivider) {
      adjustDivider.hidden = !(hasPanAdjustments && swapResult.hasSwapAdjustments);
    }
  }

  if (multiplierInput) multiplierInput.addEventListener('input', rerender);

  rerender();

  if (titleEl) {
    const { title, name } = getRecipeTitleParts(recipe);
    titleEl.textContent = '';
    const titleText = document.createElement('span');
    titleText.textContent = title || 'Recipe';
    titleEl.appendChild(titleText);
    if (name) {
      const nameEl = document.createElement('span');
      nameEl.className = 'recipe-row-title-name';
      nameEl.textContent = ` — ${name}`;
      titleEl.appendChild(nameEl);
    }
  }

  const printBtn = document.getElementById('print-btn');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }
}

async function main() {
  const recipeId = getRecipeIdFromQuery();
  if (!recipeId) {
    document.body.innerHTML = '<p>Missing recipe id.</p>';
    return;
  }

  const [{ recipes, recipeIndex }, nutritionPolicy] = await Promise.all([
    loadRecipes(),
    loadNutritionPolicy(),
  ]);

  const recipe = recipes.find((r) => String(r?.id) === String(recipeId));
  if (!recipe) {
    document.body.innerHTML = '<p>Recipe not found</p>';
    return;
  }

  recipe.recipeIndex = recipeIndex;
  renderRecipe(recipe, nutritionPolicy);
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p>${err?.message || 'Failed to load recipe'}</p>`;
});
