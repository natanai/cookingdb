import {
  DIETARY_TAGS,
  restrictionsActive,
  recipeDefaultCompatibility,
  hasNonCompliantAlternative,
  renderIngredientEntry,
  ingredientDisplay,
  formatStepText,
  selectOptionForToken,
  optionMeetsRestrictions,
  alternativeOptions,
  getEffectiveMultiplier,
  unitOptionsFor,
  convertUnitAmount,
} from './recipe-utils.js';

const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';

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
  const res = await fetch('./built/recipes.json');
  if (!res.ok) {
    throw new Error(`Unable to load built/recipes.json (${res.status})`);
  }
  const builtRaw = await res.json();
  const built = Array.isArray(builtRaw) ? builtRaw.map(normalizeRecipeForPage).filter(Boolean) : [];
  const inbox = loadStoredInboxRecipes();
  return [...built, ...inbox];
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

function createMetadataPill(labels, value) {
  const pill = document.createElement('span');
  pill.className = value ? 'pill' : 'pill neutral';
  pill.textContent = value ? labels.positive : labels.negative;
  return pill;
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
  const container = document.getElementById('choices-container');
  if (!container) return;

  container.innerHTML = '';

  const choices = recipe?.choices && typeof recipe.choices === 'object' ? recipe.choices : {};
  const ingredients = recipe?.ingredients && typeof recipe.ingredients === 'object' ? recipe.ingredients : {};

  Object.entries(choices).forEach(([token, choice]) => {
    const tokenData = ingredients[token];
    if (!tokenData?.options) return;

    const wrapper = document.createElement('label');
    wrapper.className = 'choice-group';

    const select = document.createElement('select');
    select.dataset.token = token;

    const preferred = selectOptionForToken(token, recipe, state);

    tokenData.options
      .filter((opt) => opt.option)
      .forEach((opt) => {
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

    const label = document.createElement('span');
    label.textContent = `${choice?.label || token}: `;
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);

    if (preferred?.option) {
      state.selectedOptions[token] = preferred.option;
    }
  });
}

function renderIngredientsList(recipe, state, onUnitChange) {
  const list = document.getElementById('ingredients-list');
  if (!list) return;

  list.innerHTML = '';

  const multiplier = getEffectiveMultiplier(state);
  const ingredients = recipe?.ingredients && typeof recipe.ingredients === 'object' ? recipe.ingredients : null;
  const unitSelections = state.unitSelections || (state.unitSelections = {});

  const order = Array.isArray(recipe?.token_order)
    ? recipe.token_order
    : ingredients
      ? Object.keys(ingredients)
      : [];

  if (!ingredients || order.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<em>This recipe was imported without full ingredient data.</em>';
    list.appendChild(li);
    return;
  }

  order.forEach((token) => {
    const tokenData = ingredients[token];
    if (!tokenData) return;

    const option = selectOptionForToken(token, recipe, state);
    if (!option) return;

    const li = document.createElement('li');
    const textSpan = document.createElement('span');

    const selectedUnit = unitSelections[token];
    let display = null;
    try {
      display = ingredientDisplay(option, multiplier, selectedUnit);
      textSpan.textContent = display.text;
    } catch (e) {
      textSpan.textContent = String(token);
    }

    let alternatives = [];
    try {
      alternatives = alternativeOptions(tokenData, state, option) || [];
    } catch (e) {
      alternatives = [];
    }

    if (alternatives.length) {
      const altText = alternatives
        .map((opt) => {
          try {
            return renderIngredientEntry(opt, multiplier);
          } catch {
            return '';
          }
        })
        .filter(Boolean)
        .join(' / ');

      if (altText) {
        const altSpan = document.createElement('span');
        altSpan.className = 'ingredient-alternatives';
        altSpan.textContent = ` (or ${altText})`;
        li.appendChild(textSpan);
        li.appendChild(altSpan);
      }
    }

      if (!li.contains(textSpan)) {
        li.appendChild(textSpan);
      }

      const unitOptions = unitOptionsFor(option.unit);
      if (unitOptions.length > 1 && option.ratio) {
        const unitSelect = document.createElement('select');
        unitSelect.className = 'unit-select';
        const currentUnit = selectedUnit || option.unit;
        unitOptions.forEach((unit) => {
          const opt = document.createElement('option');
          opt.value = unit.id;
          opt.textContent = unit.label;
          if (unit.id === currentUnit) opt.selected = true;
          unitSelect.appendChild(opt);
        });

        if (!unitSelections[token]) {
          unitSelections[token] = currentUnit;
        }

        unitSelect.addEventListener('change', () => {
          unitSelections[token] = unitSelect.value;
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

      list.appendChild(li);
    });
}

function renderSteps(recipe, state) {
  const steps = document.getElementById('steps-list');
  if (!steps) return;

  steps.innerHTML = '';

  const raw =
    recipe && typeof recipe.steps_raw === 'string'
      ? recipe.steps_raw
      : Array.isArray(recipe?.steps)
        ? recipe.steps.map(String).join('\n')
        : '';

  const stepLines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  if (stepLines.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<em>This recipe was imported without step text.</em>';
    steps.appendChild(li);
    return;
  }

  stepLines.forEach((line) => {
    const li = document.createElement('li');
    const cleaned = line.replace(/^\s*\d+\s*[\.\)]\s*/, '');

    try {
      li.textContent = formatStepText(cleaned, recipe, state);
    } catch (e) {
      li.textContent = cleaned;
    }

    steps.appendChild(li);
  });
}

function setupPanControls(recipe, state, rerender) {
  const panControls = document.getElementById('pan-controls');
  const panSelect = document.getElementById('pan-select');
  const panNote = document.getElementById('pan-note');

  if (!panControls || !panSelect || !panNote || !recipe?.pan_sizes?.length) {
    state.panMultiplier = 1;
    if (panControls) {
      panControls.remove();
    }
    return;
  }

  panControls.hidden = false;
  panSelect.innerHTML = '';

  recipe.pan_sizes.forEach((pan) => {
    const optionEl = document.createElement('option');
    optionEl.value = pan.id;
    optionEl.textContent = pan.label || pan.id;
    if (pan.id === recipe.default_pan) optionEl.selected = true;
    panSelect.appendChild(optionEl);
  });

  const basePan = recipe.pan_sizes.find((p) => p.id === recipe.default_pan) || recipe.pan_sizes[0];
  const baseArea = panArea(basePan);

  const updatePanMultiplier = () => {
    const selectedId = panSelect.value;
    state.selectedPanId = selectedId;

    const selectedPan = recipe.pan_sizes.find((p) => p.id === selectedId);
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
}

function renderRecipe(recipeInput) {
  const recipe = normalizeRecipeForPage(recipeInput) || recipeInput;

  const titleEl = document.getElementById('recipe-title');
  const notesEl = document.getElementById('notes');
  const metadataEl = document.getElementById('metadata');
  const categoryRow = document.getElementById('category-row');
  const multiplierInput = document.getElementById('multiplier');
  const multiplierHelper = document.getElementById('multiplier-helper');
  const prefGluten = document.getElementById('pref-gluten');
  const prefEgg = document.getElementById('pref-egg');
  const prefDairy = document.getElementById('pref-dairy');
  const ingredientsHeading = document.getElementById('ingredients-heading');
  const heroContent = document.querySelector('.hero-content');

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
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? resolveRestriction('gluten_free') : false,
      egg_free: compatibilityPossible.egg_free ? resolveRestriction('egg_free') : false,
      dairy_free: compatibilityPossible.dairy_free ? resolveRestriction('dairy_free') : false,
    },
  };

  if (multiplierInput) multiplierInput.value = state.multiplier;
  if (prefGluten) prefGluten.checked = state.restrictions.gluten_free;
  if (prefEgg) prefEgg.checked = state.restrictions.egg_free;
  if (prefDairy) prefDairy.checked = state.restrictions.dairy_free;

  if (prefGluten) {
    prefGluten.disabled =
      !compatibilityPossible.gluten_free || (defaultCompatibility.gluten_free && !restrictionCanRelax.gluten_free);
  }
  if (prefEgg) {
    prefEgg.disabled = !compatibilityPossible.egg_free || (defaultCompatibility.egg_free && !restrictionCanRelax.egg_free);
  }
  if (prefDairy) {
    prefDairy.disabled =
      !compatibilityPossible.dairy_free || (defaultCompatibility.dairy_free && !restrictionCanRelax.dairy_free);
  }

  if (ingredientsHeading) {
    ingredientsHeading.textContent = hasDetails ? 'Ingredients' : 'Ingredients (pending)';
  }

  if (notesEl) {
    notesEl.textContent = recipe.notes || 'Notes for this dish will go here soon.';
  }

  if (!hasDetails && heroContent) {
    const warning = document.createElement('div');
    warning.className = 'callout warning';
    warning.textContent =
      'This inbox recipe is missing ingredients or steps. Pull the inbox again later to load the full details.';
    heroContent.prepend(warning);
  }

  if (metadataEl) {
    metadataEl.innerHTML = '';
    metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.gluten_free, !!compatibilityPossible.gluten_free));
    metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.egg_free, !!compatibilityPossible.egg_free));
    metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.dairy_free, !!compatibilityPossible.dairy_free));
  }

  if (categoryRow) {
    categoryRow.innerHTML = '';
    (recipe.categories || []).forEach((cat) => {
      const chip = document.createElement('span');
      chip.className = 'category-chip';
      chip.textContent = cat;
      categoryRow.appendChild(chip);
    });
  }

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
    if (prefGluten) state.restrictions.gluten_free = prefGluten.checked;
    if (prefEgg) state.restrictions.egg_free = prefEgg.checked;
    if (prefDairy) state.restrictions.dairy_free = prefDairy.checked;
    syncSelections();
    buildChoiceControls(recipe, state, rerender);
    rerender();
  };

  setupPanControls(recipe, state, rerender);
  syncSelections();
  buildChoiceControls(recipe, state, rerender);

  if (multiplierInput) multiplierInput.addEventListener('input', rerender);
  if (prefGluten) prefGluten.addEventListener('change', handleRestrictionChange);
  if (prefEgg) prefEgg.addEventListener('change', handleRestrictionChange);
  if (prefDairy) prefDairy.addEventListener('change', handleRestrictionChange);

  rerender();

  if (titleEl) titleEl.textContent = recipe.title || 'Recipe';

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

  const recipes = await loadRecipes();

  const recipe = recipes.find((r) => String(r?.id) === String(recipeId));
  if (!recipe) {
    document.body.innerHTML = '<p>Recipe not found</p>';
    return;
  }

  renderRecipe(recipe);
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p>${err?.message || 'Failed to load recipe'}</p>`;
});
