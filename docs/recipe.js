import {
  DIETARY_TAGS,
  restrictionsActive,
  recipeDefaultCompatibility,
  hasNonCompliantAlternative,
  renderIngredientEntry,
  renderIngredientLines,
  renderStepLines,
  formatStepText,
  selectOptionForToken,
  optionMeetsRestrictions,
  alternativeOptions,
  getEffectiveMultiplier,
} from './recipe-utils.js';

const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';

function loadStoredInboxRecipes() {
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Unable to read inbox recipes from storage', err);
    return [];
  }
}

async function loadRecipes() {
  const res = await fetch('./built/recipes.json');
  const built = res.ok ? await res.json() : [];
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
  container.innerHTML = '';
  Object.entries(recipe.choices).forEach(([token, choice]) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'choice-group';
    const select = document.createElement('select');
    select.dataset.token = token;
    const preferred = selectOptionForToken(token, recipe, state);
    recipe.ingredients[token].options
      .filter((opt) => opt.option)
      .forEach((opt) => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.option;
        optionEl.textContent = opt.display;
        const compatible = optionMeetsRestrictions(opt, state.restrictions);
        optionEl.disabled = restrictionsActive(state.restrictions) && !compatible;
        if (preferred && opt.option === preferred.option) optionEl.selected = true;
        select.appendChild(optionEl);
      });
    select.addEventListener('change', () => {
      state.selectedOptions[token] = select.value;
      onChange();
    });
    const label = document.createElement('span');
    label.textContent = `${choice.label}: `;
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
    if (preferred?.option) {
      state.selectedOptions[token] = preferred.option;
    }
  });
}

function renderIngredientsList(recipe, state) {
  const list = document.getElementById('ingredients-list');
  list.innerHTML = '';

  const multiplier = getEffectiveMultiplier(state);

  const ingredients = recipe && recipe.ingredients ? recipe.ingredients : null;

  // Prefer explicit token_order; otherwise fall back to ingredient keys (stable-ish display),
  // otherwise show a friendly message.
  const order = Array.isArray(recipe?.token_order)
    ? recipe.token_order
    : ingredients
      ? Object.keys(ingredients)
      : [];

  if (!ingredients || order.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'This recipe was imported without full ingredient data.';
    list.appendChild(li);
    return;
  }

  order.forEach((token) => {
    const tokenData = ingredients[token];
    if (!tokenData) return;

    const li = document.createElement('li');

    // Pick the selected option; if missing, skip gracefully.
    const option = selectOptionForToken(token, recipe, state);
    if (!option) return;

    try {
      li.textContent = renderIngredientEntry(option, multiplier);
    } catch (e) {
      // Fallback: show something instead of breaking the whole page.
      li.textContent = String(token);
    }

    let alternatives = [];
    try {
      alternatives = alternativeOptions(tokenData, state, option) || [];
    } catch (e) {
      alternatives = [];
    }

    if (alternatives.length) {
      let altText = '';
      try {
        altText = alternatives
          .map((opt) => renderIngredientEntry(opt, multiplier))
          .filter(Boolean)
          .join(' / ');
      } catch (e) {
        altText = '';
      }

      if (altText) {
        const altSpan = document.createElement('span');
        altSpan.className = 'ingredient-alternatives';
        altSpan.textContent = ` (or ${altText})`;
        li.appendChild(altSpan);
      }
    }

    list.appendChild(li);
  });
}

function renderSteps(recipe, state) {
  const steps = document.getElementById('steps-list');
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
    li.textContent = 'This recipe was imported without step text.';
    steps.appendChild(li);
    return;
  }

  stepLines.forEach((line) => {
    const li = document.createElement('li');

    // Remove leading "1. " / "1) " etc.
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

  if (!panControls || !panSelect || !panNote || !recipe.pan_sizes?.length) {
    state.panMultiplier = 1;
    if (panControls) {
      panControls.remove();
    }
    return;
  }

  panControls.hidden = false;
  panSelect.innerHTML = '';

  const basePan = recipe.pan_sizes.find((p) => p.id === recipe.default_pan) || recipe.pan_sizes[0];
  const baseArea = panArea(basePan);
  const baseLabel = basePan?.label || 'default pan';

  recipe.pan_sizes.forEach((pan) => {
    const option = document.createElement('option');
    option.value = pan.id;
    option.textContent = pan.label || pan.id;
    panSelect.appendChild(option);
  });

  state.selectedPanId = state.selectedPanId || basePan?.id;
  if (state.selectedPanId) {
    panSelect.value = state.selectedPanId;
  }

  const applySelection = () => {
    state.selectedPanId = panSelect.value;
    const selected = recipe.pan_sizes.find((pan) => pan.id === state.selectedPanId) || basePan;
    const selectedArea = panArea(selected);
    const ratio = selectedArea && baseArea ? selectedArea / baseArea : 1;
    state.panMultiplier = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    panNote.textContent =
      Math.abs(state.panMultiplier - 1) < 1e-3
        ? `Using ${selected.label || selected.id} as written.`
        : `Scaled for ${selected.label || selected.id}: ×${state.panMultiplier.toFixed(2)} vs ${baseLabel}.`;
    rerender();
  };

  applySelection();
  panSelect.addEventListener('change', applySelection);
}

function renderRecipe(recipe) {
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
  const defaultCompatibility = recipeDefaultCompatibility(recipe);
  const compatibilityPossible = recipe.compatibility_possible || {};
  const queryRestrictions = getDietaryFromQuery();
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
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? resolveRestriction('gluten_free') : false,
      egg_free: compatibilityPossible.egg_free ? resolveRestriction('egg_free') : false,
      dairy_free: compatibilityPossible.dairy_free ? resolveRestriction('dairy_free') : false,
    },
  };
  multiplierInput.value = state.multiplier;
  prefGluten.checked = state.restrictions.gluten_free;
  prefEgg.checked = state.restrictions.egg_free;
  prefDairy.checked = state.restrictions.dairy_free;
  prefGluten.disabled =
    !compatibilityPossible.gluten_free || (defaultCompatibility.gluten_free && !restrictionCanRelax.gluten_free);
  prefEgg.disabled =
    !compatibilityPossible.egg_free || (defaultCompatibility.egg_free && !restrictionCanRelax.egg_free);
  prefDairy.disabled =
    !compatibilityPossible.dairy_free || (defaultCompatibility.dairy_free && !restrictionCanRelax.dairy_free);
  if (ingredientsHeading) {
    ingredientsHeading.textContent = 'Ingredients';
  }
  notesEl.textContent = recipe.notes || 'Notes for this dish will go here soon.';
  metadataEl.innerHTML = '';
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.gluten_free, recipe.compatibility_possible.gluten_free));
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.egg_free, recipe.compatibility_possible.egg_free));
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.dairy_free, recipe.compatibility_possible.dairy_free));
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
    state.multiplier = Number(multiplierInput.value) || recipe.default_base;
    renderIngredientsList(recipe, state);
    renderSteps(recipe, state);
    updateMultiplierHelper();
  };
  const syncSelections = () => {
    Object.keys(recipe.choices).forEach((token) => selectOptionForToken(token, recipe, state));
  };
  const handleRestrictionChange = () => {
    state.restrictions.gluten_free = prefGluten.checked;
    state.restrictions.egg_free = prefEgg.checked;
    state.restrictions.dairy_free = prefDairy.checked;
    syncSelections();
    buildChoiceControls(recipe, state, rerender);
    rerender();
  };
  setupPanControls(recipe, state, rerender);
  syncSelections();
  buildChoiceControls(recipe, state, rerender);
  multiplierInput.addEventListener('input', rerender);
  prefGluten.addEventListener('change', handleRestrictionChange);
  prefEgg.addEventListener('change', handleRestrictionChange);
  prefDairy.addEventListener('change', handleRestrictionChange);
  rerender();
  titleEl.textContent = recipe.title;
  document.getElementById('print-btn').addEventListener('click', () => window.print());
}

async function main() {
  const recipeId = getRecipeIdFromQuery();
  const recipes = await loadRecipes();
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    document.body.innerHTML = '<p>Recipe not found</p>';
    return;
  }
  renderRecipe(recipe);
}

main().catch((err) => {
  document.body.innerHTML = `<p>${err.message || 'Failed to load recipe'}</p>`;
});
