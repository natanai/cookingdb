async function loadRecipes() {
  const res = await fetch('./built/recipes.json');
  if (!res.ok) throw new Error('Unable to load recipes');
  return res.json();
}

function getRecipeIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function getDietaryFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    gluten_free: params.get('gluten_free') === '1',
    egg_free: params.get('egg_free') === '1',
    dairy_free: params.get('dairy_free') === '1',
  };
}

const DIETARY_TAGS = {
  gluten_free: { positive: 'Gluten-free ready', negative: 'Contains gluten' },
  egg_free: { positive: 'Egg-free friendly', negative: 'Contains egg' },
  dairy_free: { positive: 'Dairy-free ready', negative: 'Contains dairy' },
};

function restrictionsActive(prefs) {
  return prefs.gluten_free || prefs.egg_free || prefs.dairy_free;
}

function parseRatio(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  let whole = 0;
  let fracPart = trimmed;
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(' ');
    whole = Number(parts[0]);
    fracPart = parts[1];
  }
  let num;
  let den;
  if (fracPart.includes('/')) {
    const [n, d] = fracPart.split('/');
    num = Number(n);
    den = Number(d);
  } else {
    num = Number(fracPart);
    den = 1;
  }
  if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  const totalNum = whole * den + num;
  return simplify({ num: totalNum, den });
}

function simplify(frac) {
  const gcd = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
    return b === 0 ? a : gcd(b, a % b);
  };
  const g = gcd(Math.abs(frac.num), Math.abs(frac.den));
  return { num: frac.num / g, den: frac.den / g };
}

function decimalToFraction(value, maxDen = 16) {
  const den = maxDen;
  const num = Math.round(value * den);
  return simplify({ num, den });
}

function multiplyFraction(frac, multiplier) {
  if (!frac) return null;
  const multFrac = decimalToFraction(multiplier);
  return simplify({ num: frac.num * multFrac.num, den: frac.den * multFrac.den });
}

function formatFraction(frac) {
  if (!frac) return '';
  const whole = Math.trunc(frac.num / frac.den);
  const remainder = Math.abs(frac.num % frac.den);
  if (remainder === 0) return `${whole}`;
  if (whole === 0) return `${frac.num}/${frac.den}`;
  return `${whole} ${remainder}/${frac.den}`;
}

function pluralize(display, amount, unit) {
  if (unit === 'count') {
    if (Math.abs(amount - 1) < 1e-9) return display;
    if (display.endsWith('s')) return display;
    return `${display}s`;
  }
  return display;
}

function createMetadataPill(labels, value) {
  const pill = document.createElement('span');
  pill.className = value ? 'pill' : 'pill neutral';
  pill.textContent = value ? labels.positive : labels.negative;
  return pill;
}

function getEffectiveMultiplier(state) {
  return (Number(state.multiplier) || 1) * (Number(state.panMultiplier) || 1);
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

function optionMeetsRestrictions(option, restrictions) {
  if (!option || !option.dietary) return true;
  if (restrictions.gluten_free && !option.dietary.gluten_free) return false;
  if (restrictions.egg_free && !option.dietary.egg_free) return false;
  if (restrictions.dairy_free && !option.dietary.dairy_free) return false;
  return true;
}

function alternativeOptions(tokenData, state, selectedOption) {
  if (!tokenData?.isChoice) return [];
  const choiceOptions = tokenData.options.filter((opt) => opt.option);
  const compatible = restrictionsActive(state.restrictions)
    ? choiceOptions.filter((opt) => optionMeetsRestrictions(opt, state.restrictions))
    : choiceOptions;
  return compatible.filter((opt) => opt.option !== selectedOption?.option);
}

function renderIngredientEntry(option, multiplier) {
  if (!option.ratio) return option.display;
  const baseFraction = parseRatio(option.ratio);
  if (!baseFraction) return option.display;
  const scaled = multiplyFraction(baseFraction, multiplier);
  const amountNumber = scaled ? scaled.num / scaled.den : null;
  const amountStr = scaled ? formatFraction(scaled) : '';
  const displayName = pluralize(option.display, amountNumber ?? 0, option.unit);
  const unit = option.unit ? ` ${option.unit}` : '';
  return `${amountStr}${unit ? unit : ''} ${displayName}`.trim();
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

function formatStepText(stepText, recipe, state) {
  const multiplier = getEffectiveMultiplier(state);
  return stepText.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (match, token) => {
    const option = selectOptionForToken(token, recipe, state);
    return renderIngredientEntry(option, multiplier);
  });
}

function selectOptionForToken(token, recipe, state) {
  const tokenData = recipe.ingredients[token];
  if (!tokenData.isChoice) return tokenData.options[0];

  const selectedKey = state.selectedOptions[token] || recipe.choices[token]?.default_option;
  const options = tokenData.options.filter((opt) => opt.option);
  let selected = options.find((opt) => opt.option === selectedKey) || options[0];

  const compatibleOptions = options.filter((opt) => optionMeetsRestrictions(opt, state.restrictions));
  if (restrictionsActive(state.restrictions) && compatibleOptions.length > 0) {
    if (!optionMeetsRestrictions(selected, state.restrictions)) {
      selected =
        compatibleOptions.find((opt) => opt.option === state.selectedOptions[token]) ||
        compatibleOptions.find((opt) => opt.option === recipe.choices[token]?.default_option) ||
        compatibleOptions[0];
    }
  }

  if (selected && selected.option && state.selectedOptions[token] !== selected.option) {
    state.selectedOptions[token] = selected.option;
  }

  return selected || tokenData.options[0];
}

function renderIngredientsList(recipe, state) {
  const list = document.getElementById('ingredients-list');
  list.innerHTML = '';
  const multiplier = getEffectiveMultiplier(state);
  recipe.token_order.forEach((token) => {
    const tokenData = recipe.ingredients[token];
    const option = selectOptionForToken(token, recipe, state);
    const li = document.createElement('li');
    li.textContent = renderIngredientEntry(option, multiplier);
    const alternatives = alternativeOptions(tokenData, state, option);
    if (alternatives.length) {
      const altText = alternatives.map((opt) => renderIngredientEntry(opt, multiplier)).join(' / ');
      const altSpan = document.createElement('span');
      altSpan.className = 'ingredient-alternatives';
      altSpan.textContent = ` (or ${altText})`;
      li.appendChild(altSpan);
    }
    list.appendChild(li);
  });
}

function renderSteps(recipe, state) {
  const steps = document.getElementById('steps-list');
  steps.innerHTML = '';
  const stepLines = recipe.steps_raw.split(/\n/).filter((line) => line.trim() !== '');
  stepLines.forEach((line) => {
    const li = document.createElement('li');
    li.textContent = formatStepText(line.replace(/^\d+\.\s*/, ''), recipe, state);
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
  const heroTitleEl = document.getElementById('recipe-title-duplicate');
  const notesEl = document.getElementById('notes');
  const metadataEl = document.getElementById('metadata');
  const categoryRow = document.getElementById('category-row');
  const multiplierInput = document.getElementById('multiplier');
  const multiplierHelper = document.getElementById('multiplier-helper');
  const prefGluten = document.getElementById('pref-gluten');
  const prefEgg = document.getElementById('pref-egg');
  const prefDairy = document.getElementById('pref-dairy');
  const state = {
    multiplier: Number(recipe.default_base) || 1,
    panMultiplier: 1,
    selectedPanId: recipe.default_pan || null,
    selectedOptions: {},
    restrictions: {
      gluten_free: false,
      egg_free: false,
      dairy_free: false,
      ...getDietaryFromQuery(),
    },
  };
  multiplierInput.value = state.multiplier;
  prefGluten.checked = state.restrictions.gluten_free;
  prefEgg.checked = state.restrictions.egg_free;
  prefDairy.checked = state.restrictions.dairy_free;
  notesEl.textContent = recipe.notes || 'A family note for this dish will go here soon.';
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
  heroTitleEl.textContent = recipe.title;
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
