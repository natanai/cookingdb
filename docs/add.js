import {
  familySubmitRecipe,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';
import {
  renderIngredientLines,
  renderStepLines,
  groupLinesBySection,
  recipeDefaultCompatibility,
  selectOptionForToken,
  optionMeetsRestrictions,
  restrictionsActive,
} from './recipe-utils.js';
import { UNIT_CONVERSIONS } from './unit-conversions.js';

const ingredientRowsEl = document.getElementById('ingredient-rows');
const stepsListEl = document.getElementById('steps-list');
const ingredientSuggestionsEl = document.getElementById('ingredient-suggestions');
const dependencySuggestionsEl = document.getElementById('dependency-suggestions');
const sectionSuggestionsEl = document.getElementById('section-suggestions');
const categorySelectEl = document.getElementById('categories');
// Remove required attribute from slug input as it's auto-generated
const slugInputField = document.getElementById('slug');
if (slugInputField) slugInputField.removeAttribute('required');

const statusEl = document.getElementById('form-status');

const HELP_TEXT = {
  title: 'Type the full recipe name just like you would tell a friend. This is the big heading on the saved card.',
  slug: 'This short ID keeps the recipe organized. Use lowercase letters, numbers, and dashes only—we fill it from the title for you.',
  notes: 'Add friendly reminders like storage tips, serving suggestions, or special equipment. You can leave this blank if there is nothing extra to share.',
  categories:
    'Pick the cookbook sections that fit. Hold Control (or Command on a Mac) to highlight more than one so the family can find it easily.',
  batch: 'Leave this as 1 for a normal batch. Change it if the written recipe already makes two pans or another multiplier so scaling works correctly.',
  ingredients:
    'Enter every ingredient line with an amount and unit. Use a section label like "Sauce" or "Filling" when the recipe has parts, and open “More options” for substitutions or conditional items if needed.',
  steps:
    'Write the steps in the order you cook them. For each step, click the ingredients it uses so the preview stays accurate. Add step sections like "Prep" or "Bake" when grouping instructions helps.',
  showWhen:
    '“Show when” hides this ingredient unless someone picks a matching choice from the ingredient options (token and option come from the ingredient choices). Use it for optional toppings or flavor variations.',
  inlineGroup:
    'Inline group keeps certain ingredients on the same printed line. Give related items the same short key, like putting "sauce" on both “1 c sauce” and “1/2 c water” to show them together.',
  amount:
    'Type the quantity exactly as written. Fractions like "1/2" or "1 1/2" are okay, and you can add words like "scant" before the number if that is how the card is written.',
  sectionLabel:
    'Section label adds a small heading above related ingredients, such as "Dough" or "Topping." Leave it blank if the recipe is a single part.',
  altNote:
    'Alternative note explains a swap or option for this ingredient, like "use almonds instead" or "skip for nut-free." It shows right next to the ingredient in the preview.',
  optionValue:
    'Option value must match the exact choice someone clicks from ingredient options, like "extra cheese" or "no nuts." When that choice is picked, this ingredient will show (or stay hidden).',
  choiceLabel:
    'Choice label is the friendly text shown above the swap selector, such as "Milk type" or "Pick a crust." Keep it short and clear—usually the ingredient name works great.',
  choiceDefault:
    'Default option is the version that should load automatically when the recipe opens. Pick the option that matches the written card so the preview mirrors the intended base recipe.',
  choiceOptions:
    'Use options to list every version of this ingredient that someone can pick. Give each option a clear display name, fill in the exact amount and unit for that version, and set the option value slug used by steps or show-when rules.',
  optionDisplay:
    'Option name is what cooks will read, like "whole milk" or "oat milk." Use the wording from the card so it is recognizable in the preview and printed recipe.',
};

function attachHelpTrigger(button, key) {
  if (!button || !key || !HELP_TEXT[key]) return;
  button.addEventListener('click', () => {
    window.alert(HELP_TEXT[key]);
  });
}

const ingredientNameSet = new Set();
const categorySet = new Set();
const unitSet = new Set();
const unitSelects = new Set();
const sectionSet = new Set();
const unitFrequency = new Map();
const previewSelections = { selectedOptions: {} };

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function touchSlugFromTitle() {
  const titleInput = document.getElementById('title');
  const slugInput = document.getElementById('slug');
  if (!slugInput.dataset.userEdited || slugInput.dataset.userEdited === 'false') {
    slugInput.value = slugify(titleInput.value || '');
  }
}

function clearValidationHighlights() {
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
}

function markInvalid(el) {
  if (el) {
    el.classList.add('invalid');
  }
}

function addOptionToDatalist(datalistEl, value) {
  if (!value || datalistEl.querySelector(`option[value="${value}"]`)) return;
  const opt = document.createElement('option');
  opt.value = value;
  datalistEl.appendChild(opt);
}

function updateIngredientSuggestions() {
  ingredientSuggestionsEl.innerHTML = '';
  ingredientNameSet.forEach((name) => addOptionToDatalist(ingredientSuggestionsEl, name));
}

function updateSectionSuggestions() {
  sectionSuggestionsEl.innerHTML = '';
  sectionSet.forEach((section) => addOptionToDatalist(sectionSuggestionsEl, section));
}

function updateDependencySuggestions() {
  dependencySuggestionsEl.innerHTML = '';
  ingredientChoices().forEach(({ token }) => addOptionToDatalist(dependencySuggestionsEl, token));
}

function loadUnitsFromConversions() {
  Object.values(UNIT_CONVERSIONS).forEach((group) => {
    Object.keys(group.units || {}).forEach((unit) => unitSet.add(unit));
  });
  syncUnitSelects();
}

function syncCategoryOptions() {
  if (!categorySelectEl) return;
  const previousSelection = new Set([...categorySelectEl.selectedOptions].map((opt) => opt.value));
  categorySelectEl.innerHTML = '';
  const sortedCategories = [...categorySet].sort((a, b) => a.localeCompare(b));
  if (sortedCategories.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.disabled = true;
    placeholder.textContent = 'Loading categories…';
    categorySelectEl.appendChild(placeholder);
    return;
  }

  sortedCategories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    opt.selected = previousSelection.has(cat);
    categorySelectEl.appendChild(opt);
  });
}

function syncUnitSelect(selectEl, preferredValue = '') {
  if (!selectEl) return;
  const targetValue = preferredValue || selectEl.value;
  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select unit';
  placeholder.disabled = true;
  placeholder.hidden = false;
  placeholder.selected = !targetValue;
  fragment.appendChild(placeholder);

  let valueMatched = false;
  [...unitSet]
    .sort((a, b) => a.localeCompare(b))
    .forEach((unit) => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = unit;
      if (unit === targetValue) {
        opt.selected = true;
        valueMatched = true;
      }
      fragment.appendChild(opt);
    });

  selectEl.innerHTML = '';
  selectEl.appendChild(fragment);
  if (!valueMatched && targetValue) {
    selectEl.value = '';
  }
}

function syncUnitSelects() {
  unitSelects.forEach((select) => syncUnitSelect(select));
}

function recordUnitFrequency(token, unit) {
  if (!token || !unit) return;
  if (!unitFrequency.has(token)) {
    unitFrequency.set(token, new Map());
  }
  const counter = unitFrequency.get(token);
  counter.set(unit, (counter.get(unit) || 0) + 1);
}

function commonUnitForToken(token) {
  const counts = unitFrequency.get(token);
  if (!counts) return '';
  let topUnit = '';
  let topCount = 0;
  counts.forEach((count, unit) => {
    if (count > topCount) {
      topUnit = unit;
      topCount = count;
    }
  });
  return topUnit;
}

function normalizeIngredientsForSuggestions(recipe) {
  if (!recipe || typeof recipe !== 'object') return [];
  if (Array.isArray(recipe.ingredients)) return recipe.ingredients.filter(Boolean);
  if (recipe.ingredients && typeof recipe.ingredients === 'object') {
    return Object.values(recipe.ingredients).filter(Boolean);
  }
  return [];
}

async function loadExistingRecipes() {
  try {
    const res = await fetch('./built/recipes.json');
    if (res.ok) {
      const recipes = await res.json();
      recipes.forEach((recipe) => {
        (recipe.categories || []).forEach((cat) => categorySet.add(cat));
        normalizeIngredientsForSuggestions(recipe).forEach((tokenData) => {
          const tokenFromData = tokenData.token || tokenData.options?.[0]?.ingredient_id || '';
          const token = slugify(tokenFromData);
          tokenData.options.forEach((opt) => {
            if (opt.display) ingredientNameSet.add(opt.display);
            if (opt.unit) {
              unitSet.add(opt.unit);
              recordUnitFrequency(token, opt.unit);
            }
            if (opt.section) sectionSet.add(opt.section);
          });
          if (tokenData.section) sectionSet.add(tokenData.section);
        });
      });
      syncCategoryOptions();
      syncUnitSelects();
      updateIngredientSuggestions();
      updateSectionSuggestions();
      updateDependencySuggestions();
    }
  } catch (err) {
    console.warn('Could not load suggestions', err);
  }
}

function ingredientChoices() {
  const rows = [...ingredientRowsEl.querySelectorAll('.ingredient-row')];
  return rows
    .map((row) => {
      const name = row.querySelector('.ingredient-name').value.trim();
      if (!name) return null;
      return { token: slugify(name), name };
    })
    .filter(Boolean);
}

function buildDietaryCheckboxes() {
  const wrapper = document.createElement('div');
  wrapper.className = 'dietary-flags';
  const options = [
    { key: 'gluten_free', label: 'GF', title: 'Gluten-free' },
    { key: 'egg_free', label: 'Egg', title: 'Egg-free' },
    { key: 'dairy_free', label: 'Dairy', title: 'Dairy-free' },
  ];
  options.forEach((opt) => {
    const label = document.createElement('label');
    label.className = 'dietary-chip';
    label.title = opt.title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.dietaryKey = opt.key;
    label.appendChild(input);
    label.append(opt.label);
    wrapper.appendChild(label);
  });
  return wrapper;
}

function createOptionRow(ingredientRow, defaults = {}) {
  const optionRow = document.createElement('div');
  optionRow.className = 'ingredient-option-row';
  optionRow.innerHTML = `
    <div class="ingredient-main option-main">
      <input class="option-value" placeholder="Option value" aria-label="Option value" />
      <div class="input-with-help">
        <input class="option-display" placeholder="Option name" aria-label="Option display" />
        <button type="button" class="help-icon option-display-help" data-help-key="optionDisplay" aria-label="Help: option name">?</button>
      </div>
      <div class="input-with-help">
        <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
        <button type="button" class="help-icon amount-help" data-help-key="amount" aria-label="Help: amount">?</button>
      </div>
      <select class="ingredient-unit" aria-label="Unit"></select>
      <div class="dietary-slot"></div>
      <button type="button" class="ingredient-more-toggle" aria-expanded="false" aria-label="More options">+</button>
      <button type="button" class="link-button remove-option">Remove option</button>
    </div>

    <div class="ingredient-advanced" hidden>
      <div class="ingredient-advanced-grid">
        <div class="input-with-help">
          <input class="ingredient-section" list="section-suggestions" placeholder="Section label" aria-label="Ingredient section" />
          <button type="button" class="help-icon section-help" data-help-key="sectionLabel" aria-label="Help: section label">?</button>
        </div>
        <div class="input-with-help">
          <input class="ingredient-alt" placeholder="Alternative note" aria-label="Alternative or substitution" />
          <button type="button" class="help-icon alt-help" data-help-key="altNote" aria-label="Help: alternative note">?</button>
        </div>
          <div class="show-when-group">
            <div class="show-when-inputs">
              <input class="ingredient-dep-token" list="dependency-suggestions" placeholder="Show when ingredient" aria-label="Dependency token" />
              <div class="input-with-help">
                <input class="ingredient-dep-option" placeholder="Option value" aria-label="Dependency option" />
                <button type="button" class="help-icon option-help" data-help-key="optionValue" aria-label="Help: option value">?</button>
              </div>
            </div>
          <button type="button" class="help-icon show-when-help" data-help-key="showWhen" aria-label="How show-when works">?</button>
        </div>
        <div class="inline-group-with-help">
          <input class="ingredient-group" placeholder="Inline group key" aria-label="Inline group key" />
          <button type="button" class="help-icon inline-group-help" data-help-key="inlineGroup" aria-label="How inline grouping works">?</button>
        </div>
      </div>
      <div class="field-help subtle">
        Leave these blank unless you need sections, conditional ingredients, or to keep items on the same line.
      </div>
    </div>
  `;

  optionRow.querySelector('.dietary-slot').replaceWith(buildDietaryCheckboxes());
  const displayInput = optionRow.querySelector('.option-display');
  const optionValueInput = optionRow.querySelector('.option-value');
  const sectionInput = optionRow.querySelector('.ingredient-section');
  const amountInput = optionRow.querySelector('.ingredient-amount');
  const unitInput = optionRow.querySelector('.ingredient-unit');
  const altInput = optionRow.querySelector('.ingredient-alt');
  const depTokenInput = optionRow.querySelector('.ingredient-dep-token');
  const depOptionInput = optionRow.querySelector('.ingredient-dep-option');
  const groupInput = optionRow.querySelector('.ingredient-group');
  const toggleButton = optionRow.querySelector('.ingredient-more-toggle');
  const advancedPanel = optionRow.querySelector('.ingredient-advanced');
  const showWhenHelp = optionRow.querySelector('.show-when-help');
  const inlineGroupHelp = optionRow.querySelector('.inline-group-help');
  const amountHelp = optionRow.querySelector('.amount-help');
  const sectionHelp = optionRow.querySelector('.section-help');
  const altHelp = optionRow.querySelector('.alt-help');
  const optionHelp = optionRow.querySelector('.option-help');
  const optionDisplayHelp = optionRow.querySelector('.option-display-help');
  const setExpanded = (expanded) => {
    toggleButton.setAttribute('aria-expanded', String(expanded));
    toggleButton.textContent = expanded ? '−' : '+';
    advancedPanel.hidden = !expanded;
  };

  toggleButton.addEventListener('click', () => {
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  displayInput.value = defaults.display || defaults.name || '';
  optionValueInput.value = defaults.option || '';
  sectionInput.value = defaults.section || '';
  amountInput.value = defaults.amount || defaults.ratio || '';
  syncUnitSelect(unitInput, defaults.unit || '');
  unitSelects.add(unitInput);
  altInput.value = defaults.alt || '';
  depTokenInput.value = defaults.depends_on?.token || '';
  depOptionInput.value = defaults.depends_on?.option || '';
  groupInput.value = defaults.line_group || '';
  unitInput.dataset.userChanged = 'false';

  if (defaults.dietary) {
    optionRow.querySelectorAll('[data-dietary-key]').forEach((input) => {
      const key = input.dataset.dietaryKey;
      if (Object.prototype.hasOwnProperty.call(defaults.dietary, key)) {
        input.checked = defaults.dietary[key];
      }
    });
  }

  const hasAdvancedDefaults = Boolean(
    sectionInput.value ||
      altInput.value ||
      depTokenInput.value ||
      depOptionInput.value ||
      groupInput.value,
  );
  if (hasAdvancedDefaults) {
    setExpanded(true);
  }

  const touchOptionSlug = () => {
    if (optionValueInput.dataset.userEdited === 'true') return;
    if (!displayInput.value) return;
    optionValueInput.value = slugify(displayInput.value);
  };

  const tryAutofillUnit = () => {
    const token = slugify(displayInput.value || '');
    if (!token || unitInput.dataset.userChanged === 'true' || unitInput.value) return;
    const autoUnit = commonUnitForToken(token);
    if (autoUnit) {
      syncUnitSelect(unitInput, autoUnit);
    }
  };

  displayInput.addEventListener('input', () => {
    touchOptionSlug();
  });

  displayInput.addEventListener('change', () => {
    tryAutofillUnit();
  });
  displayInput.addEventListener('blur', tryAutofillUnit);

  optionRow.addEventListener('input', () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateIngredientSuggestions();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });
  optionRow.addEventListener('change', () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateIngredientSuggestions();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  optionValueInput.addEventListener('change', () => {
    optionValueInput.dataset.userEdited = 'true';
  });

  toggleButton.addEventListener('click', () => {
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', String(!expanded));
    toggleButton.textContent = expanded ? '+' : '−';
    advancedPanel.hidden = expanded;
  });

  unitInput.addEventListener('change', () => {
    unitInput.dataset.userChanged = 'true';
  });

  attachHelpTrigger(showWhenHelp, 'showWhen');
  attachHelpTrigger(inlineGroupHelp, 'inlineGroup');
  attachHelpTrigger(amountHelp, 'amount');
  attachHelpTrigger(sectionHelp, 'sectionLabel');
  attachHelpTrigger(altHelp, 'altNote');
  attachHelpTrigger(optionHelp, 'optionValue');
  attachHelpTrigger(optionDisplayHelp, 'optionDisplay');

  optionRow.querySelector('.remove-option').addEventListener('click', () => {
    unitSelects.delete(unitInput);
    const optionsContainer = ingredientRow.querySelector('.ingredient-options');
    optionRow.remove();
    if (optionsContainer.children.length === 0) {
      const fallback = createOptionRow(ingredientRow, {});
      optionsContainer.appendChild(fallback);
    }
    if (ingredientRow.syncChoiceDefaults) {
      ingredientRow.syncChoiceDefaults();
    }
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  return optionRow;
}

function createIngredientRow(defaults = {}) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <div class="ingredient-main">
      <input class="ingredient-name" list="ingredient-suggestions" placeholder="Ingredient name" aria-label="Ingredient name" />
      <div class="input-with-help">
        <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
        <button type="button" class="help-icon amount-help" data-help-key="amount" aria-label="Help: amount">?</button>
      </div>
      <select class="ingredient-unit" aria-label="Unit"></select>
      <div class="dietary-slot"></div>
      <button type="button" class="ingredient-more-toggle" aria-expanded="false" aria-label="More options">+</button>
      <button type="button" class="link-button remove-ingredient">Remove</button>
    </div>

    <div class="ingredient-advanced" hidden>
      <div class="ingredient-advanced-grid">
        <div class="input-with-help">
          <input class="ingredient-section" list="section-suggestions" placeholder="Section label" aria-label="Ingredient section" />
          <button type="button" class="help-icon section-help" data-help-key="sectionLabel" aria-label="Help: section label">?</button>
        </div>
        <div class="input-with-help">
          <input class="ingredient-alt" placeholder="Alternative note" aria-label="Alternative or substitution" />
          <button type="button" class="help-icon alt-help" data-help-key="altNote" aria-label="Help: alternative note">?</button>
        </div>
          <div class="show-when-group">
            <div class="show-when-inputs">
              <input class="ingredient-dep-token" list="dependency-suggestions" placeholder="Show when ingredient" aria-label="Dependency token" />
              <div class="input-with-help">
                <input class="ingredient-dep-option" placeholder="Option value" aria-label="Dependency option" />
                <button type="button" class="help-icon option-help" data-help-key="optionValue" aria-label="Help: option value">?</button>
              </div>
            </div>
          <button type="button" class="help-icon show-when-help" data-help-key="showWhen" aria-label="How show-when works">?</button>
        </div>
        <div class="inline-group-with-help">
          <input class="ingredient-group" placeholder="Inline group key" aria-label="Inline group key" />
          <button type="button" class="help-icon inline-group-help" data-help-key="inlineGroup" aria-label="How inline grouping works">?</button>
        </div>
      </div>

      <div class="choice-row">
        <div class="choice-config">
          <label class="choice-toggle"><input type="checkbox" class="ingredient-choice-flag" /> Choice ingredient</label>
          <div class="input-with-help">
            <input class="ingredient-choice-label" placeholder="Choice label" aria-label="Choice label" />
            <button type="button" class="help-icon choice-label-help" data-help-key="choiceLabel" aria-label="Help: choice label">?</button>
          </div>
          <div class="input-with-help">
            <select class="ingredient-choice-default" aria-label="Default option"></select>
            <button type="button" class="help-icon choice-default-help" data-help-key="choiceDefault" aria-label="Help: default option">?</button>
          </div>
        </div>
        <div class="choice-options-block">
          <div class="options-header">
            <span>Options</span>
            <button type="button" class="help-icon choice-options-help" data-help-key="choiceOptions" aria-label="Help: choice options">?</button>
          </div>
          <div class="ingredient-options"></div>
          <button class="button secondary add-option" type="button">+ Add option</button>
        </div>
      </div>

      <div class="field-help subtle">
        Open options to add choice swaps, conditional visibility, or section headings. Leave blank when not needed.
      </div>
    </div>
  `;
  row.querySelector('.dietary-slot').replaceWith(buildDietaryCheckboxes());
  const nameInput = row.querySelector('.ingredient-name');
  const sectionInput = row.querySelector('.ingredient-section');
  const amountInput = row.querySelector('.ingredient-amount');
  const unitInput = row.querySelector('.ingredient-unit');
  const altInput = row.querySelector('.ingredient-alt');
  const depTokenInput = row.querySelector('.ingredient-dep-token');
  const depOptionInput = row.querySelector('.ingredient-dep-option');
  const groupInput = row.querySelector('.ingredient-group');
  const toggleButton = row.querySelector('.ingredient-more-toggle');
  const advancedPanel = row.querySelector('.ingredient-advanced');
  const showWhenHelp = row.querySelector('.show-when-help');
  const inlineGroupHelp = row.querySelector('.inline-group-help');
  const amountHelp = row.querySelector('.amount-help');
  const sectionHelp = row.querySelector('.section-help');
  const altHelp = row.querySelector('.alt-help');
  const optionHelp = row.querySelector('.option-help');
  const choiceToggle = row.querySelector('.ingredient-choice-flag');
  const choiceLabelInput = row.querySelector('.ingredient-choice-label');
  const choiceDefaultSelect = row.querySelector('.ingredient-choice-default');
  const optionsContainer = row.querySelector('.ingredient-options');
  const addOptionButton = row.querySelector('.add-option');
  const choiceLabelHelp = row.querySelector('.choice-label-help');
  const choiceDefaultHelp = row.querySelector('.choice-default-help');
  const choiceOptionsHelp = row.querySelector('.choice-options-help');
  const choiceFields = row.querySelector('.choice-row');
  const setExpanded = (expanded) => {
    toggleButton.setAttribute('aria-expanded', String(expanded));
    toggleButton.textContent = expanded ? '−' : '+';
    advancedPanel.hidden = !expanded;
  };

  toggleButton.addEventListener('click', () => {
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  const baseDefaults = (defaults.options && defaults.options[0]) || defaults;
  nameInput.value = defaults.name || baseDefaults.display || '';
  sectionInput.value = baseDefaults.section || '';
  amountInput.value = baseDefaults.amount || baseDefaults.ratio || '';
  syncUnitSelect(unitInput, baseDefaults.unit || '');
  unitSelects.add(unitInput);
  altInput.value = baseDefaults.alt || '';
  depTokenInput.value = baseDefaults.depends_on?.token || '';
  depOptionInput.value = baseDefaults.depends_on?.option || '';
  groupInput.value = baseDefaults.line_group || '';
  if (baseDefaults.dietary) {
    row.querySelectorAll('[data-dietary-key]').forEach((input) => {
      const key = input.dataset.dietaryKey;
      if (Object.prototype.hasOwnProperty.call(baseDefaults.dietary, key)) {
        input.checked = baseDefaults.dietary[key];
      }
    });
  }
  unitInput.dataset.userChanged = 'false';

  const hasAdvancedDefaults =
    Boolean(sectionInput.value || altInput.value || depTokenInput.value || depOptionInput.value || groupInput.value) ||
    (defaults.options && defaults.options.length > 1) ||
    defaults.isChoice;
  if (hasAdvancedDefaults) {
    setExpanded(true);
  }

  const syncChoiceDefaults = () => {
    const optionRows = [...optionsContainer.querySelectorAll('.ingredient-option-row')];
    const previous = choiceDefaultSelect.value;
    choiceDefaultSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select default';
    placeholder.disabled = true;
    choiceDefaultSelect.appendChild(placeholder);

    const baseDisplay = nameInput.value.trim();
    const baseValue = slugify(baseDisplay || 'option-1');
    const allOptions = baseDisplay
      ? [{ value: baseValue, label: baseDisplay }]
      : [];

    optionRows.forEach((optRow, idx) => {
      const optValueInput = optRow.querySelector('.option-value');
      const optDisplay = optRow.querySelector('.option-display');
      const value = slugify(optValueInput.value || optDisplay.value || `option-${idx + 1}`);
      const label = optDisplay.value || value;
      allOptions.push({ value, label });
    });

    allOptions.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === previous) optionEl.selected = true;
      choiceDefaultSelect.appendChild(optionEl);
    });

    const shouldShowChoiceFields =
      choiceToggle.checked || allOptions.length > 1 || optionRows.some((optRow) => (optRow.querySelector('.option-value')?.value || '').trim());
    if (choiceFields) choiceFields.hidden = !shouldShowChoiceFields;
    if (!choiceDefaultSelect.value && allOptions.length) {
      choiceDefaultSelect.value = allOptions[0]?.value || '';
    }
  };

  row.syncChoiceDefaults = syncChoiceDefaults;

  const handleChange = () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateIngredientSuggestions();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    syncChoiceDefaults();
    refreshPreview();
  };

  const tryAutofillFromName = () => {
    if (!nameInput.value) return;
    if (!choiceLabelInput.value) {
      choiceLabelInput.value = nameInput.value;
    }
  };

  const tryAutofillUnit = () => {
    const token = slugify(nameInput.value || '');
    if (!token || unitInput.dataset.userChanged === 'true' || unitInput.value) return;
    const autoUnit = commonUnitForToken(token);
    if (autoUnit) {
      syncUnitSelect(unitInput, autoUnit);
    }
  };

  nameInput.addEventListener('change', () => {
    tryAutofillFromName();
    tryAutofillUnit();
    handleChange();
  });
  nameInput.addEventListener('blur', tryAutofillFromName);
  row.addEventListener('input', handleChange);
  row.addEventListener('change', handleChange);

  unitInput.addEventListener('change', () => {
    unitInput.dataset.userChanged = 'true';
  });

  attachHelpTrigger(showWhenHelp, 'showWhen');
  attachHelpTrigger(inlineGroupHelp, 'inlineGroup');
  attachHelpTrigger(amountHelp, 'amount');
  attachHelpTrigger(sectionHelp, 'sectionLabel');
  attachHelpTrigger(altHelp, 'altNote');
  attachHelpTrigger(optionHelp, 'optionValue');
  attachHelpTrigger(choiceLabelHelp, 'choiceLabel');
  attachHelpTrigger(choiceDefaultHelp, 'choiceDefault');
  attachHelpTrigger(choiceOptionsHelp, 'choiceOptions');

  choiceToggle.addEventListener('change', () => {
    syncChoiceDefaults();
  });

  addOptionButton.addEventListener('click', () => {
    const optionDefaults = { name: nameInput.value };
    const newOption = createOptionRow(row, optionDefaults);
    optionsContainer.appendChild(newOption);
    syncChoiceDefaults();
  });

  row.querySelector('.remove-ingredient').addEventListener('click', () => {
    row.remove();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  const initialOptions = defaults.options && defaults.options.length > 1 ? defaults.options.slice(1) : [];
  initialOptions.forEach((optDefaults) => {
    const optionRow = createOptionRow(row, { ...optDefaults, name: optDefaults.display || defaults.name || '' });
    optionsContainer.appendChild(optionRow);
  });

  if (defaults.isChoice) {
    choiceToggle.checked = true;
  }
  if (defaults.choiceLabel) {
    choiceLabelInput.value = defaults.choiceLabel;
  }
  if (defaults.defaultOption) {
    choiceDefaultSelect.value = defaults.defaultOption;
  }

  syncChoiceDefaults();
  ingredientRowsEl.appendChild(row);
}

function createStepRow(defaultText = '', defaultSection = '') {
  const li = document.createElement('li');
  li.className = 'step-row';

  const main = document.createElement('div');
  main.className = 'step-main';

  const instructionLabel = document.createElement('label');
  instructionLabel.className = 'step-text-label';
  instructionLabel.innerHTML = '<span class="label-top">Instruction</span>';
  const textInput = document.createElement('textarea');
  textInput.className = 'step-text';
  textInput.rows = 3;
  textInput.placeholder = 'Describe the action and include ingredients';
  textInput.value = defaultText;
  instructionLabel.appendChild(textInput);

  const ingredientsWrap = document.createElement('div');
  ingredientsWrap.className = 'step-ingredients';
  ingredientsWrap.setAttribute('aria-label', 'Ingredients used in this step');

  const actions = document.createElement('div');
  actions.className = 'step-actions';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'step-more-toggle';
  toggleButton.setAttribute('aria-expanded', 'false');
  toggleButton.setAttribute('aria-label', 'More options');
  toggleButton.textContent = '+';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'link-button remove-step';
  removeButton.textContent = 'Remove';

  actions.append(toggleButton, removeButton);
  main.append(instructionLabel, ingredientsWrap, actions);

  const advanced = document.createElement('div');
  advanced.className = 'step-advanced';
  advanced.hidden = true;

  const advancedGrid = document.createElement('div');
  advancedGrid.className = 'step-advanced-grid';

  const sectionLabel = document.createElement('label');
  sectionLabel.innerHTML = 'Section heading';
  const sectionInput = document.createElement('input');
  sectionInput.className = 'step-section';
  sectionInput.placeholder = 'e.g., Prep Work';
  sectionInput.value = defaultSection;
  sectionLabel.appendChild(sectionInput);

  const variationBlock = document.createElement('div');
  variationBlock.className = 'variation-grid';
  variationBlock.innerHTML = `
    <label>Show when ingredient is set to
      <div class="conditional-inputs">
        <input class="variation-token" list="dependency-suggestions" placeholder="Ingredient name" aria-label="Variation token" />
        <input class="variation-option" placeholder="Option value" aria-label="Variation option" />
      </div>
    </label>
    <label>Variation text (only shown when matched)
      <textarea class="variation-text" rows="2" placeholder="Shown only for that choice"></textarea>
    </label>
  `;

  advancedGrid.append(sectionLabel, variationBlock);
  advanced.appendChild(advancedGrid);

  const help = document.createElement('div');
  help.className = 'field-help subtle';
  help.textContent = 'Add a section heading or conditional variation only when needed.';
  advanced.appendChild(help);

  li.append(main, advanced);

  li.addEventListener('input', refreshPreview);

  const setExpanded = (expanded) => {
    toggleButton.setAttribute('aria-expanded', String(expanded));
    toggleButton.textContent = expanded ? '−' : '+';
    advanced.hidden = !expanded;
  };

  toggleButton.addEventListener('click', () => {
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  removeButton.addEventListener('click', () => {
    li.remove();
    refreshPreview();
  });

  if (defaultSection) {
    setExpanded(true);
  }

  stepsListEl.appendChild(li);
  refreshStepIngredientPicker(li);
}

function refreshStepIngredientPicker(stepRow) {
  const picker = stepRow.querySelector('.step-ingredients');
  const existingSelection = new Set(
    [...picker.querySelectorAll('input[type="checkbox"]')].filter((cb) => cb.checked).map((cb) => cb.value)
  );
  picker.innerHTML = '';
  const choices = ingredientChoices();
  if (!choices.length) {
    picker.textContent = 'Add ingredients first.';
    return;
  }
  choices.forEach((choice) => {
    const label = document.createElement('label');
    label.className = 'pill-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = choice.token;
    input.checked = existingSelection.has(choice.token);
    input.addEventListener('change', refreshPreview);
    label.appendChild(input);
    label.append(` ${choice.name}`);
    picker.appendChild(label);
  });
}

function refreshStepIngredientPickers() {
  stepsListEl.querySelectorAll('.step-row').forEach((row) => refreshStepIngredientPicker(row));
}

function readDietaryFlags(row) {
  const flags = { gluten_free: true, egg_free: true, dairy_free: true };
  if (!row) return flags;
  row.querySelectorAll('[data-dietary-key]').forEach((input) => {
    const key = input.dataset.dietaryKey;
    flags[key] = input.checked;
  });
  return flags;
}

function dietaryFlagsAreDefault(flags) {
  return flags.gluten_free === true && flags.egg_free === true && flags.dairy_free === true;
}

function buildIngredientsFromForm(issues) {
  const tokenOrder = [];
  const ingredientList = [];
  const choicesMap = {};
  const ingredientRows = [...ingredientRowsEl.querySelectorAll('.ingredient-row')];

  ingredientRows.forEach((row, idx) => {
    const nameInput = row.querySelector('.ingredient-name');
    const amountInput = row.querySelector('.ingredient-amount');
    const unitInput = row.querySelector('.ingredient-unit');
    const altInput = row.querySelector('.ingredient-alt');
    const depTokenInput = row.querySelector('.ingredient-dep-token');
    const depOptionInput = row.querySelector('.ingredient-dep-option');
    const groupInput = row.querySelector('.ingredient-group');
    const sectionInput = row.querySelector('.ingredient-section');
    const choiceToggle = row.querySelector('.ingredient-choice-flag');
    const choiceLabelInput = row.querySelector('.ingredient-choice-label');
    const choiceDefaultSelect = row.querySelector('.ingredient-choice-default');
    const optionRows = [...row.querySelectorAll('.ingredient-option-row')];

    const name = nameInput?.value.trim() || '';
    if (!name) {
      issues.push(`Ingredient ${idx + 1} needs a name.`);
      markInvalid(nameInput);
      return;
    }

    const options = [];

    const baseAlt = altInput?.value.trim() || '';
    const baseAmount = amountInput?.value.trim() || '';
    const baseUnit = unitInput?.value.trim() || '';
    const baseDepToken = depTokenInput?.value.trim() || '';
    const baseDepOption = depOptionInput?.value.trim() || '';
    const baseLineGroup = groupInput?.value.trim() || '';
    const baseSection = sectionInput?.value.trim() || '';
    const baseDietary = readDietaryFlags(row.querySelector('.ingredient-main'));

    const baseMissing = [];
    if (!baseAmount) baseMissing.push('amount');
    if (!baseUnit) baseMissing.push('unit');
    if (baseMissing.length) {
      issues.push(`Ingredient ${idx + 1} is missing ${baseMissing.join(' and ')}.`);
      if (!baseAmount) markInvalid(amountInput);
      if (!baseUnit) markInvalid(unitInput);
      return;
    }

    const baseDependsOn = baseDepToken
      ? { token: slugify(baseDepToken), option: baseDepOption ? slugify(baseDepOption) : null }
      : null;
    const baseOptionValue = slugify(name);
    const baseDisplay = baseAlt ? `${name} (${baseAlt})` : name;
    options.push({
      option: baseOptionValue,
      display: baseDisplay,
      ratio: baseAmount,
      unit: baseUnit,
      ingredient_id: slugify(name),
      dietary: baseDietary,
      depends_on: baseDependsOn,
      line_group: baseLineGroup || null,
      section: baseSection || null,
    });

    optionRows.forEach((optRow, optIdx) => {
      const displayInput = optRow.querySelector('.option-display');
      const optionValueInput = optRow.querySelector('.option-value');
      const amountInput = optRow.querySelector('.ingredient-amount');
      const unitInput = optRow.querySelector('.ingredient-unit');
      const altInput = optRow.querySelector('.ingredient-alt');
      const depTokenInput = optRow.querySelector('.ingredient-dep-token');
      const depOptionInput = optRow.querySelector('.ingredient-dep-option');
      const groupInput = optRow.querySelector('.ingredient-group');
      const sectionInput = optRow.querySelector('.ingredient-section');

      const display = displayInput?.value.trim() || '';
      const amount = amountInput?.value.trim() || '';
      const unit = unitInput?.value.trim() || '';
      const alt = altInput?.value.trim() || '';
      const depToken = depTokenInput?.value.trim() || '';
      const depOption = depOptionInput?.value.trim() || '';
      const lineGroup = groupInput?.value.trim() || '';
      const section = sectionInput?.value.trim() || '';
      const dietary = readDietaryFlags(optRow);

      const allEmpty =
        !display &&
        !amount &&
        !unit &&
        !alt &&
        !depToken &&
        !depOption &&
        !lineGroup &&
        !section &&
        dietaryFlagsAreDefault(dietary);
      if (allEmpty) return;

      const missingFields = [];
      if (!display) missingFields.push('name');
      if (!amount) missingFields.push('amount');
      if (!unit) missingFields.push('unit');

      if (missingFields.length) {
        issues.push(`Option ${optIdx + 2} for ingredient ${idx + 1} is missing ${missingFields.join(' and ')}.`);
        if (!display) markInvalid(displayInput);
        if (!amount) markInvalid(amountInput);
        if (!unit) markInvalid(unitInput);
        return;
      }

      const depends_on = depToken
        ? { token: slugify(depToken), option: depOption ? slugify(depOption) : null }
        : null;
      const optionValue = slugify(optionValueInput?.value.trim() || display);
      const optionDisplay = alt ? `${display} (${alt})` : display;
      options.push({
        option: optionValue,
        display: optionDisplay || name,
        ratio: amount,
        unit,
        ingredient_id: slugify(display) || slugify(name) || optionValue || name,
        dietary,
        depends_on,
        line_group: lineGroup || null,
        section: section || null,
      });
    });

    if (options.length === 0) {
      issues.push(`Add at least one option for ingredient ${idx + 1}.`);
      markInvalid(nameInput);
      return;
    }

    const isChoice =
      choiceToggle?.checked ||
      options.length > 1 ||
      options.some((opt) => opt.option && opt.option !== slugify(name));

    options.forEach((opt, optIdx) => {
      if (isChoice && !opt.option) {
        issues.push(`Choice option ${optIdx + 1} for ${name} needs a value.`);
        const valueInput = optIdx === 0 ? null : optionRows[optIdx - 1]?.querySelector('.option-value');
        if (valueInput) markInvalid(valueInput);
      }
      if (!isChoice) {
        opt.option = '';
      }
    });

    const token = slugify(name);
    if (!tokenOrder.includes(token)) tokenOrder.push(token);

    const defaultOption = choiceDefaultSelect?.value || (isChoice ? options[0]?.option : '');
    if (isChoice && !defaultOption) {
      issues.push(`Select a default option for ${name}.`);
      markInvalid(choiceDefaultSelect);
    }

    const uniformField = (key) => {
      if (!options.length) return null;
      const normalize = (val) => {
        if (val && typeof val === 'object') return JSON.stringify(val);
        return val || null;
      };
      const first = normalize(options[0][key]);
      const same = options.every((opt) => normalize(opt[key]) === first);
      return same ? options[0][key] || null : null;
    };

    const ingredientEntry = {
      token,
      options,
      isChoice,
      depends_on: uniformField('depends_on'),
      line_group: uniformField('line_group'),
      section: uniformField('section'),
    };

    ingredientList.push(ingredientEntry);

    if (isChoice) {
      const label = choiceLabelInput?.value.trim() || name;
      choicesMap[token] = { token, label, default_option: slugify(defaultOption || options[0]?.option || '') };
    }
  });

  if (ingredientList.length === 0) {
    issues.push('Add at least one ingredient with a name, amount, and unit.');
  }

  return { ingredientList, tokenOrder, choicesMap };
}

function buildRecipeDraft() {
  clearValidationHighlights();
  const issues = [];

  const titleInput = document.getElementById('title');
  const slugInput = document.getElementById('slug');
  const notesInput = document.getElementById('notes');
  const categoriesSelect = document.getElementById('categories');
  const defaultBaseInput = document.getElementById('default-base');

  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const notes = notesInput.value.trim();
  const categories = categoriesSelect ? [...categoriesSelect.selectedOptions].map((opt) => opt.value) : [];
  const defaultBase = Number(defaultBaseInput.value) || 1;

  if (!title) {
    issues.push('Add a recipe title.');
    markInvalid(titleInput);
  }

  if (!slug) {
    issues.push('Add a recipe ID.');
    markInvalid(slugInput);
  } else if (!/^[a-z0-9-]+$/.test(slug)) {
    issues.push('Recipe ID can only contain letters, numbers, and dashes.');
    markInvalid(slugInput);
  }

  if (categories.length === 0) {
    issues.push('Add at least one category.');
    markInvalid(categoriesSelect);
  }

  if (!Number.isFinite(defaultBase) || defaultBase <= 0) {
    issues.push('Batch size must be a positive number.');
    markInvalid(defaultBaseInput);
  }

  const { ingredientList, tokenOrder, choicesMap } = buildIngredientsFromForm(issues);

  const stepsRawLines = [];
  const structuredSteps = [];
  const stepSections = [];
  const tokenUsage = [];
  const stepRows = [...stepsListEl.querySelectorAll('.step-row')];
  stepRows.forEach((row, index) => {
    const textInput = row.querySelector('.step-text');
    const sectionInput = row.querySelector('.step-section');
    const text = textInput.value.trim();
    const section = sectionInput?.value.trim() || '';
    const checkboxes = [...row.querySelectorAll('.step-ingredients input')];
    const selectedTokens = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);

    if (!text) {
      issues.push(`Step ${index + 1} needs instructions.`);
      markInvalid(textInput);
    }

    if (selectedTokens.length === 0) {
      issues.push(`Select ingredients for step ${index + 1}.`);
      checkboxes.forEach((cb) => markInvalid(cb.closest('label')));
    }

    if (!text || selectedTokens.length === 0) return;

    let stepText = text;
    selectedTokens.forEach((token) => {
      const tokenPattern = new RegExp(`{{\\s*${token}\\s*}}`);
      if (!tokenPattern.test(stepText)) {
        stepText = `${stepText} {{${token}}}`.trim();
      }
    });

    const variationToken = slugify(row.querySelector('.variation-token')?.value || '');
    const variationOption = slugify(row.querySelector('.variation-option')?.value || '');
    const variationText = (row.querySelector('.variation-text')?.value || '').trim();
    if (variationText && variationToken) {
      const condition = variationOption ? `${variationToken}=${variationOption}` : variationToken;
      stepText = `${stepText} {{#if ${condition}}}${variationText}{{/if}}`.trim();
      tokenUsage.push(variationToken);
    }
    structuredSteps.push({ section: section || null, text: stepText });
    if (section && !stepSections.includes(section)) {
      stepSections.push(section);
    }
    const numbered = `${structuredSteps.length}. ${stepText}`;
    stepsRawLines.push(numbered);
    const regex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
    let match;
    while ((match = regex.exec(stepText)) !== null) {
      tokenUsage.push(match[1]);
    }
    const conditionRegex = /{{#if\s+([a-zA-Z0-9_-]+)/g;
    while ((match = conditionRegex.exec(stepText)) !== null) {
      tokenUsage.push(match[1]);
    }
  });

  if (stepsRawLines.length === 0) {
    issues.push('Add at least one step with instructions and ingredients.');
  }

  const unusedTokens = tokenOrder.filter((token) => !tokenUsage.includes(token));
  if (unusedTokens.length) {
    issues.push(`Select where to use ${unusedTokens.length > 1 ? 'these ingredients' : 'this ingredient'}: ${unusedTokens.join(', ')}.`);
  }

  const compatibility = { gluten_free: true, egg_free: true, dairy_free: true };
  const ingredientSections = [];
  ingredientList.forEach((tokenData) => {
    if (tokenData.section && !ingredientSections.includes(tokenData.section)) {
      ingredientSections.push(tokenData.section);
    }
    tokenData.options.forEach((opt) => {
      ['gluten_free', 'egg_free', 'dairy_free'].forEach((key) => {
        if (opt.dietary && opt.dietary[key] === false) {
          compatibility[key] = false;
        }
      });
    });
  });

  const recipe = {
    id: slug,
    title,
    base_kind: 'multiplier',
    default_base: defaultBase,
    categories,
    notes,
    steps_raw: stepsRawLines.join('\n'),
    steps: structuredSteps,
    step_sections: stepSections,
    tokens_used: tokenUsage,
    token_order: tokenOrder,
    ingredients: ingredientList,
    ingredient_sections: ingredientSections,
    choices: choicesMap,
    pan_sizes: [],
    default_pan: null,
    compatibility_possible: compatibility,
  };

  return { recipe, issues };
}

function buildRecipeFromForm({ strict = true } = {}) {
  const { recipe, issues } = buildRecipeDraft();
  if (strict && issues.length) {
    const error = new Error('Please fix the highlighted items.');
    error.issues = issues;
    throw error;
  }
  return recipe;
}

function buildPreviewRecipe() {
  const { recipe } = buildRecipeDraft();
  const ingredientMap = {};
  (recipe.ingredients || []).forEach((entry) => {
    if (entry?.token) {
      ingredientMap[entry.token] = entry;
    }
  });
  return { ...recipe, ingredients: ingredientMap };
}

function renderPreviewChoiceControls(recipe, state) {
  const container = document.getElementById('preview-choice-controls');
  if (!container) return;

  const choices = recipe?.choices && typeof recipe.choices === 'object' ? recipe.choices : {};
  const ingredients = recipe?.ingredients && typeof recipe.ingredients === 'object' ? recipe.ingredients : {};

  const choiceEntries = Object.entries(choices).filter(([token]) => {
    const selectable = ingredients[token]?.options?.filter((opt) => opt.option) || [];
    return selectable.length >= 2;
  });

  container.innerHTML = '';

  if (!choiceEntries.length) {
    container.textContent = 'Add a choice ingredient to preview swaps.';
    return;
  }

  choiceEntries.forEach(([token, choice]) => {
    const tokenData = ingredients[token];
    const selectable = tokenData?.options?.filter((opt) => opt.option) || [];
    if (selectable.length < 2) return;

    const row = document.createElement('div');
    row.className = 'swap-row';

    const label = document.createElement('span');
    label.className = 'swap-label';
    label.textContent = `Swap ${choice?.label || token}`;

    const select = document.createElement('select');
    select.dataset.token = token;
    select.title = 'Choose which ingredient to preview. This updates ingredients and steps.';

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
      previewSelections.selectedOptions[token] = select.value;
      renderPreview(recipe);
    });

    if (preferred?.option) {
      state.selectedOptions[token] = preferred.option;
      previewSelections.selectedOptions[token] = preferred.option;
    }

    row.append(label, select);
    container.appendChild(row);
  });
}

function renderPreview(recipe) {
  const titleEl = document.getElementById('preview-recipe-title');
  const noteDetails = document.getElementById('preview-recipe-note');
  const notesEl = document.getElementById('preview-notes');
  const dietaryBadgesEl = document.getElementById('preview-dietary-badges');
  const categoryBadgeEl = document.getElementById('preview-category-badge');
  const batchMultiplierEl = document.getElementById('preview-batch-multiplier');
  const ingredientsEl = document.getElementById('preview-ingredients');
  const stepsEl = document.getElementById('preview-steps');

  const defaultCompatibility = recipeDefaultCompatibility(recipe);
  const compatibilityPossible = recipe.compatibility_possible || {};
  const hasChoiceTokens = Object.values(recipe.ingredients || {}).some((entry) => entry?.isChoice);

  if (titleEl) titleEl.textContent = recipe.title || 'Recipe title';

  const noteText = (recipe.notes || '').trim();
  if (noteDetails) {
    if (noteText) {
      noteDetails.hidden = false;
      noteDetails.open = false;
      if (notesEl) notesEl.textContent = noteText;
    } else {
      noteDetails.hidden = true;
      if (notesEl) notesEl.textContent = '';
    }
  }

  if (categoryBadgeEl) {
    const primaryCategory = (recipe.categories || [])[0] || 'Uncategorized';
    categoryBadgeEl.textContent = primaryCategory;
  }

  if (batchMultiplierEl) {
    const multiplier = Number(recipe.default_base) || 1;
    batchMultiplierEl.value = multiplier;
  }

  renderPreviewDietaryBadges(dietaryBadgesEl, defaultCompatibility, compatibilityPossible, hasChoiceTokens);

  const selectedOptions = {};
  Object.entries(previewSelections.selectedOptions || {}).forEach(([token, value]) => {
    if (recipe.ingredients && recipe.ingredients[token]) {
      selectedOptions[token] = value;
    }
  });

  const state = {
    multiplier: recipe.default_base || 1,
    panMultiplier: 1,
    selectedOptions,
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? defaultCompatibility.gluten_free : false,
      egg_free: compatibilityPossible.egg_free ? defaultCompatibility.egg_free : false,
      dairy_free: compatibilityPossible.dairy_free ? defaultCompatibility.dairy_free : false,
    },
  };

  renderPreviewChoiceControls(recipe, state);

  const ingredientLines = renderIngredientLines(recipe, state);
  const ingredientSections = groupLinesBySection(ingredientLines, recipe.ingredient_sections || []);
  renderPreviewLines(ingredientsEl, ingredientSections, { showAlternatives: true });

  const steps = renderStepLines(recipe, state);
  const stepSections = groupLinesBySection(steps, recipe.step_sections || []);
  renderPreviewLines(stepsEl, stepSections);
}

function renderPreviewDietaryBadges(container, defaultCompatibility, compatibilityPossible, hasChoiceTokens) {
  if (!container) return;

  const BADGES = [
    { key: 'gluten_free', short: 'GF', name: 'Gluten-free' },
    { key: 'egg_free', short: 'EF', name: 'Egg-free' },
    { key: 'dairy_free', short: 'DF', name: 'Dairy-free' },
  ];

  container.innerHTML = '';

  BADGES.forEach(({ key, short, name }) => {
    const ready = !!defaultCompatibility[key];
    const possible = !!compatibilityPossible[key] || hasChoiceTokens;
    const status = !possible && !ready ? 'cannot' : ready ? 'ready' : 'can-become';

    const badge = document.createElement('span');
    badge.className = `diet-badge diet-badge--${status} is-static`;
    badge.title = `${name}: ${ready ? 'meets by default' : possible ? 'can be made' : 'no swaps yet'}`;

    const text = document.createElement('span');
    text.className = 'diet-badge__text';
    text.textContent = short;

    const icon = document.createElement('span');
    icon.className = 'diet-badge__icon';
    icon.setAttribute('aria-hidden', 'true');

    badge.append(text, icon);
    container.appendChild(badge);
  });
}

function renderPreviewLines(container, sections, options = {}) {
  if (!container) return;
  const { showAlternatives = false } = options;

  container.innerHTML = '';

  if (!sections.length) {
    const placeholder = document.createElement('li');
    placeholder.className = 'section-header';
    placeholder.textContent = 'Details will appear here.';
    container.appendChild(placeholder);
    return;
  }

  sections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      container.appendChild(header);
    }

    section.lines.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line.text;
      if (showAlternatives && line.alternatives.length) {
        const span = document.createElement('span');
        span.className = 'ingredient-alternatives';
        span.textContent = ` (or ${line.alternatives.join(' / ')})`;
        li.appendChild(span);
      }
      container.appendChild(li);
    });
  });
}

function refreshPreview() {
  try {
    const recipe = buildPreviewRecipe();
    recipe.compatibility_possible = recipe.compatibility_possible || {};
    renderPreview(recipe);
    statusEl.textContent = '';
    statusEl.className = 'status';
  } catch (err) {
    statusEl.textContent = err.message || 'Unable to build preview';
    statusEl.className = 'status error';
  }
}

function promptFamilyPassword() {
  const remembered = getRememberedPassword('family');
  const provided = window.prompt('Family inbox password', remembered || '');
  if (provided === null) return null;
  const remember = document.getElementById('remember-family').checked;
  setRememberedPassword({ kind: 'family', value: provided, remember });
  return provided;
}

function showStatus(message, kind = 'info') {
  statusEl.textContent = '';
  statusEl.className = `status ${kind}`;
  if (Array.isArray(message)) {
    const intro = document.createElement('div');
    intro.textContent = 'Please fix these issues:';
    statusEl.appendChild(intro);
    const list = document.createElement('ul');
    message.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    statusEl.appendChild(list);
  } else {
    statusEl.textContent = message;
  }
}

function resetFormForNewEntry() {
  document.getElementById('recipe-form').reset();
  document.getElementById('slug').dataset.userEdited = 'false';
  ingredientRowsEl.innerHTML = '';
  stepsListEl.innerHTML = '';
  unitSelects.clear();
  previewSelections.selectedOptions = {};
  if (categorySelectEl) {
    [...categorySelectEl.options].forEach((opt) => (opt.selected = false));
  }
  createIngredientRow();
  createStepRow();
  touchSlugFromTitle();
  refreshPreview();
}

async function handleSubmit(evt) {
  evt.preventDefault();
  try {
    const recipe = buildRecipeFromForm({ strict: true });
    const password = promptFamilyPassword();
    if (!password) return;
    showStatus('Submitting recipe...', 'info');
    const result = await familySubmitRecipe({ familyPassword: password, recipe });
    showStatus(`Success: submitted with id ${result?.id || recipe.id}.`, 'success');
    const submitAnother = document.createElement('button');
    submitAnother.type = 'button';
    submitAnother.className = 'button secondary';
    submitAnother.textContent = 'Submit another';
    submitAnother.addEventListener('click', () => {
      resetFormForNewEntry();
      statusEl.textContent = '';
      statusEl.className = 'status';
    });
    statusEl.appendChild(document.createElement('br'));
    statusEl.appendChild(submitAnother);
  } catch (err) {
    if (err.issues && Array.isArray(err.issues)) {
      showStatus(err.issues, 'error');
    } else {
      showStatus(err.message || 'Unable to submit', 'error');
    }
  }
}

function bootstrap() {
  const previewDetails = document.querySelector('details.mobile-preview');
  if (previewDetails && window.matchMedia('(max-width: 640px)').matches) {
    previewDetails.removeAttribute('open');
  }

  document.querySelectorAll('.field-help-icon[data-help-key]').forEach((btn) => {
    attachHelpTrigger(btn, btn.dataset.helpKey);
  });

  document.getElementById('title').addEventListener('input', () => {
    touchSlugFromTitle();
    refreshPreview();
  });
  document.getElementById('slug').addEventListener('input', (evt) => {
    evt.target.dataset.userEdited = 'true';
  });
  document.getElementById('categories').addEventListener('change', refreshPreview);
  document.getElementById('notes').addEventListener('input', refreshPreview);
  document.getElementById('default-base').addEventListener('input', refreshPreview);

  loadUnitsFromConversions();
  syncCategoryOptions();

  document.getElementById('add-ingredient').addEventListener('click', () => {
    createIngredientRow();
    refreshStepIngredientPickers();
  });
  document.getElementById('add-step').addEventListener('click', () => {
    createStepRow();
  });
  document.getElementById('recipe-form').addEventListener('submit', handleSubmit);

  if (getRememberedPassword('family')) {
    document.getElementById('remember-family').checked = true;
  }

  createIngredientRow();
  createStepRow();
  refreshPreview();
  loadExistingRecipes();
}

bootstrap();
