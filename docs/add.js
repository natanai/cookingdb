import {
  familySubmitRecipe,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';
import {
  DIETARY_TAGS,
  renderIngredientLines,
  renderStepLines,
  groupLinesBySection,
  recipeDefaultCompatibility,
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
  title: 'Write the full recipe name just like you would tell a friend.',
  slug: 'Short ID for the link. Use lowercase letters, numbers, dashes, or underscores—we fill it from the title for you.',
  notes: 'Quick tips such as storage, serving, or special tools. Leave blank if there is nothing extra.',
  family: 'Add a family name if this recipe is tied to a specific family.',
  categories: 'Pick the cookbook sections that fit (e.g., “Main dishes” and “Slow cooker”).',
  batch: 'How many batches the written recipe makes. Example: set to 2 if the card already makes two pans.',
  ingredients:
    'Enter name, amount, and unit for each line. Use a section label like “Sauce” or “Filling” when the recipe has parts.',
  steps:
    'Write steps in cooking order. Click the ingredients each step uses so the preview stays accurate.',
  showWhen: 'Only include this ingredient when another dropdown is set to a specific option.',
  showWhenEnabled: 'Only include this ingredient when another dropdown is set to a specific option.',
  inlineGroup: 'Use the same short key to keep related items on one line, such as “salt + pepper.”',
  amount: 'Type the amount exactly as written, such as “1 1/2” or “scant 1 cup.”',
  sectionLabel: 'Adds a bold mini heading such as “Chicken” or “Sauce” above the related ingredients.',
  alternativeNote: 'Shows as “(or …)” on the recipe line so families see swaps like “(or almond milk)”.',
  altNote: 'Shows as “(or …)” on the recipe line so families see swaps like “(or almond milk)”.',
  optionKey: 'Text families pick in the dropdown, like “beef broth” or “oat milk.”',
  optionValue: 'Text families pick in the dropdown, like “beef broth” or “oat milk.”',
  isChoiceOption: 'Turns this ingredient into one option in a dropdown swap.',
  choiceGroup: 'Options with the same group name become one Swap menu, like “Broth type.”',
  swapLabel: 'Label shown next to the swap dropdown, such as “Broth”; leave blank to reuse the group name.',
  choiceLabel: 'Label shown next to the swap dropdown, such as “Broth”; leave blank to reuse the group name.',
  isDefaultChoice: 'Sets which option shows first before anyone makes a swap.',
  choiceDefault: 'Sets which option shows first before anyone makes a swap.',
};

function attachHelpTrigger(button, key) {
  if (!button || !key || !HELP_TEXT[key]) return;
  button.addEventListener('click', () => {
    window.alert(HELP_TEXT[key]);
  });
}

const ingredientNameSet = new Set();
const categorySet = new Set();
const unitChoices = new Map();
const unitSelects = new Set();
const sectionSet = new Set();
const unitFrequency = new Map();
let warnedMissingChoiceGroup = false;

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueToken(baseToken, counterMap, { enforceUnique = true } = {}) {
  if (!baseToken) return '';
  const current = counterMap.get(baseToken) || 0;
  const next = current + 1;
  counterMap.set(baseToken, next);
  if (!enforceUnique || current === 0) return baseToken;
  return `${baseToken}-${next}`;
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
    Object.entries(group.units || {}).forEach(([unitKey, unitDef]) => {
      unitChoices.set(unitKey, buildUnitDisplay(unitKey, unitDef));
    });
  });
  syncUnitSelects();
}

function buildUnitDisplay(unitKey, unitDef) {
  if (!unitDef || !unitDef.label) return unitKey;
  const label = unitDef.label;
  const labelNormalized = label.toLowerCase();
  const pluralNormalized = unitDef.plural ? unitDef.plural.toLowerCase() : '';
  if (labelNormalized === unitKey.toLowerCase() || pluralNormalized === unitKey.toLowerCase()) {
    return label;
  }
  return `${label} (${unitKey})`;
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
  [...unitChoices.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([unit, display]) => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = display;
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
              unitChoices.set(opt.unit, unitChoices.get(opt.unit) || opt.unit);
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
  const tokenCounts = new Map();
  const seenTokens = new Set();
  const choices = [];

  rows.forEach((row) => {
    const name = row.querySelector('.ingredient-name')?.value.trim() || '';
    if (!name) return;

    const isChoice = row.querySelector('.ingredient-choice-toggle')?.checked;
    if (isChoice) {
      const groupRaw = row.querySelector('.ingredient-choice-group')?.value.trim() || '';
      if (!groupRaw) return;
      const tokenBase = slugify(groupRaw);
      const token = uniqueToken(tokenBase, tokenCounts, { enforceUnique: false });
      if (seenTokens.has(token)) return;
      const label = row.querySelector('.ingredient-choice-swap-label')?.value.trim() || groupRaw;
      seenTokens.add(token);
      choices.push({ token, name: label || groupRaw });
      return;
    }

    const tokenBase = slugify(name);
    const token = uniqueToken(tokenBase, tokenCounts, { enforceUnique: true });
    seenTokens.add(token);
    choices.push({ token, name });
  });

  return choices;
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

function createIngredientRow(defaults = {}) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <div class="ingredient-main">
      <input class="ingredient-name" list="ingredient-suggestions" placeholder="Ingredient name" aria-label="Ingredient name" />
      <div class="infield">
        <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
        <button
          type="button"
          class="help-icon field-help-icon amount-help"
          data-help-key="amount"
          aria-label="Help: amount"
        >
          ?
        </button>
      </div>
      <select class="ingredient-unit" aria-label="Unit"></select>
      <div class="dietary-slot"></div>
      <button type="button" class="ingredient-more-toggle" aria-expanded="false" aria-label="More options">+</button>
      <button type="button" class="link-button remove-ingredient">Remove</button>
    </div>

    <div class="ingredient-advanced" hidden>
      <div class="ingredient-advanced-grid">
        <div class="advanced-group">
          <div class="infield">
            <input class="ingredient-section" list="section-suggestions" placeholder="Section label" aria-label="Ingredient section" />
            <button
              type="button"
              class="help-icon field-help-icon"
              data-help-key="sectionLabel"
              aria-label="Help: section label"
            >
              ?
            </button>
          </div>
          <div class="infield">
            <input class="ingredient-alt-note" placeholder="Alternative note" aria-label="Alternative or substitution" />
            <button
              type="button"
              class="help-icon field-help-icon"
              data-help-key="alternativeNote"
              aria-label="Help: alternative note"
            >
              ?
            </button>
          </div>
          <div class="infield">
            <input class="ingredient-inline-group" placeholder="Inline group key" aria-label="Inline group key" />
            <button
              type="button"
              class="help-icon field-help-icon"
              data-help-key="inlineGroup"
              aria-label="Help: inline group key"
            >
              ?
            </button>
          </div>
        </div>
        <div class="choice-block">
          <label class="choice-toggle">
            <input type="checkbox" class="ingredient-choice-toggle" />
            <span>Dropdown choice option</span>
            <button
              type="button"
              class="help-icon field-help-icon"
              data-help-key="isChoiceOption"
              aria-label="Help: dropdown choice"
            >
              ?
            </button>
          </label>
          <div class="choice-fields" hidden>
            <div class="infield">
              <input
                class="ingredient-choice-group"
                placeholder="Use the same group name on each option, like “Broth type” (required)"
                aria-label="Choice group"
              />
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="choiceGroup"
                aria-label="Help: choice group"
              >
                ?
              </button>
            </div>
            <div class="infield">
              <input
                class="ingredient-choice-swap-label"
                placeholder="Swap label shown to readers, like “Broth” (optional)"
                aria-label="Choice label"
              />
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="swapLabel"
                aria-label="Help: swap label"
              >
                ?
              </button>
            </div>
            <div class="infield">
              <input
                class="ingredient-option-key"
                placeholder="Option value for dropdowns (we’ll use the name if empty)"
                aria-label="Option value"
              />
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="optionKey"
                aria-label="Help: option value"
              >
                ?
              </button>
            </div>
            <label class="choice-default">
              <input type="checkbox" class="ingredient-default-choice" />
              <span>Make this the default option</span>
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="isDefaultChoice"
                aria-label="Help: default option"
              >
                ?
              </button>
            </label>
          </div>
        </div>
        <div class="conditional-block">
          <label class="conditional-toggle">
            <input type="checkbox" class="ingredient-conditional-toggle" />
            <span>Only include this ingredient sometimes</span>
            <button
              type="button"
              class="help-icon field-help-icon"
              data-help-key="showWhenEnabled"
              aria-label="Help: conditional ingredient"
            >
              ?
            </button>
          </label>
          <div class="conditional-fields" hidden>
            <div class="infield">
              <input class="ingredient-dep-token" list="dependency-suggestions" placeholder="Show when ingredient" aria-label="Dependency token" />
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="showWhen"
                aria-label="Help: show when ingredient"
              >
                ?
              </button>
            </div>
            <div class="infield">
              <input class="ingredient-dep-option" placeholder="Show when option value" aria-label="Dependency option" />
              <button
                type="button"
                class="help-icon field-help-icon"
                data-help-key="showWhen"
                aria-label="Help: show when option value"
              >
                ?
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  row.querySelector('.dietary-slot').replaceWith(buildDietaryCheckboxes());
  const nameInput = row.querySelector('.ingredient-name');
  const sectionInput = row.querySelector('.ingredient-section');
  const amountInput = row.querySelector('.ingredient-amount');
  const unitInput = row.querySelector('.ingredient-unit');
  const altInput = row.querySelector('.ingredient-alt-note');
  const depTokenInput = row.querySelector('.ingredient-dep-token');
  const depOptionInput = row.querySelector('.ingredient-dep-option');
  const optionInput = row.querySelector('.ingredient-option-key');
  const groupInput = row.querySelector('.ingredient-inline-group');
  const isChoiceInput = row.querySelector('.ingredient-choice-toggle');
  const choiceFields = row.querySelector('.choice-fields');
  const choiceGroupInput = row.querySelector('.ingredient-choice-group');
  const choiceLabelInput = row.querySelector('.ingredient-choice-swap-label');
  const choiceDefaultInput = row.querySelector('.ingredient-default-choice');
  const conditionalToggle = row.querySelector('.ingredient-conditional-toggle');
  const conditionalFields = row.querySelector('.conditional-fields');
  const toggleButton = row.querySelector('.ingredient-more-toggle');
  const advancedPanel = row.querySelector('.ingredient-advanced');

  nameInput.value = defaults.name || '';
  sectionInput.value = defaults.section || '';
  amountInput.value = defaults.amount || '';
  syncUnitSelect(unitInput, defaults.unit || '');
  unitSelects.add(unitInput);
  altInput.value = defaults.alt || '';
  depTokenInput.value = defaults.depends_on?.token || '';
  depOptionInput.value = defaults.depends_on?.option || '';
  optionInput.value = defaults.option || '';
  groupInput.value = defaults.line_group || '';
  choiceGroupInput.value = defaults.choice_group || '';
  choiceLabelInput.value = defaults.choice_label || '';
  choiceDefaultInput.checked = Boolean(defaults.choice_default);
  isChoiceInput.checked = Boolean(defaults.isChoice);
  conditionalToggle.checked = Boolean(depTokenInput.value || depOptionInput.value);
  if (
    !isChoiceInput.checked &&
    (choiceGroupInput.value || choiceLabelInput.value || optionInput.value || choiceDefaultInput.checked)
  ) {
    isChoiceInput.checked = true;
  }
  unitInput.dataset.userChanged = 'false';

  const hasAdvancedDefaults = Boolean(
    sectionInput.value ||
      altInput.value ||
      depTokenInput.value ||
      depOptionInput.value ||
      optionInput.value ||
      groupInput.value ||
      choiceGroupInput.value ||
      choiceLabelInput.value ||
      choiceDefaultInput.checked ||
      conditionalToggle.checked ||
      isChoiceInput.checked
  );
  if (hasAdvancedDefaults) {
    advancedPanel.hidden = false;
    toggleButton.textContent = '−';
    toggleButton.setAttribute('aria-expanded', 'true');
  }

  const syncChoiceFields = () => {
    const isChoice = isChoiceInput.checked;
    row.classList.toggle('is-choice', isChoice);
    choiceFields.hidden = !isChoice;
  };
  const syncConditionalFields = () => {
    const isConditional = conditionalToggle.checked;
    conditionalFields.hidden = !isConditional;
  };
  syncChoiceFields();
  syncConditionalFields();

  const handleChange = () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateIngredientSuggestions();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
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
    tryAutofillUnit();
    handleChange();
  });
  nameInput.addEventListener('blur', tryAutofillUnit);
  row.addEventListener('input', handleChange);
  row.addEventListener('change', handleChange);

  isChoiceInput.addEventListener('change', () => {
    if (!isChoiceInput.checked) {
      choiceGroupInput.value = '';
      choiceLabelInput.value = '';
      optionInput.value = '';
      choiceDefaultInput.checked = false;
    }
    const hasChoiceValues = Boolean(
      isChoiceInput.checked ||
        choiceGroupInput.value ||
        choiceLabelInput.value ||
        optionInput.value ||
        choiceDefaultInput.checked
    );
    isChoiceInput.checked = hasChoiceValues;
    syncChoiceFields();
    handleChange();
  });

  conditionalToggle.addEventListener('change', () => {
    if (!conditionalToggle.checked) {
      depTokenInput.value = '';
      depOptionInput.value = '';
    }
    syncConditionalFields();
    handleChange();
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

  row.querySelectorAll('.help-icon[data-help-key]').forEach((btn) => {
    attachHelpTrigger(btn, btn.dataset.helpKey);
  });

  row.querySelector('.remove-ingredient').addEventListener('click', () => {
    unitSelects.delete(unitInput);
    row.remove();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });

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
  const ingredients = {};
  const choices = {};
  const tokenCounts = new Map();
  let missingChoiceGroup = false;
  const ingredientRows = [...ingredientRowsEl.querySelectorAll('.ingredient-row')];

  ingredientRows.forEach((row, idx) => {
    const nameInput = row.querySelector('.ingredient-name');
    const sectionInput = row.querySelector('.ingredient-section');
    const amountInput = row.querySelector('.ingredient-amount');
    const unitInput = row.querySelector('.ingredient-unit');
    const altInput = row.querySelector('.ingredient-alt-note');
    const depTokenInput = row.querySelector('.ingredient-dep-token');
    const depOptionInput = row.querySelector('.ingredient-dep-option');
    const conditionalToggle = row.querySelector('.ingredient-conditional-toggle');
    const groupInput = row.querySelector('.ingredient-inline-group');
    const optionInput = row.querySelector('.ingredient-option-key');
    const isChoiceInput = row.querySelector('.ingredient-choice-toggle');
    const choiceGroupInput = row.querySelector('.ingredient-choice-group');
    const choiceLabelInput = row.querySelector('.ingredient-choice-swap-label');
    const choiceDefaultInput = row.querySelector('.ingredient-default-choice');

    const name = nameInput?.value.trim() || '';
    const section = sectionInput?.value.trim() || '';
    const amount = amountInput?.value.trim() || '';
    const unit = unitInput?.value.trim() || '';
    const alt = altInput?.value.trim() || '';
    const isConditional = Boolean(conditionalToggle?.checked);
    const depToken = isConditional ? depTokenInput?.value.trim() || '' : '';
    const depOption = isConditional ? depOptionInput?.value.trim() || '' : '';
    const lineGroup = groupInput?.value.trim() || '';
    const isChoice = Boolean(isChoiceInput?.checked);
    const optionValue = isChoice ? optionInput?.value.trim() || '' : '';
    const choiceGroup = isChoice ? choiceGroupInput?.value.trim() || '' : '';
    const choiceLabel = isChoice ? choiceLabelInput?.value.trim() || '' : '';
    const isDefaultChoice = isChoice && Boolean(choiceDefaultInput?.checked);
    const dietary = readDietaryFlags(row);

    const allEmpty =
      !name &&
      !section &&
      !amount &&
      !unit &&
      !alt &&
      !depToken &&
      !depOption &&
      !lineGroup &&
      !optionValue &&
      !choiceGroup &&
      !choiceLabel &&
      !isDefaultChoice &&
      !isChoice &&
      dietaryFlagsAreDefault(dietary);
    if (allEmpty) return;

    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!amount) missingFields.push('amount');
    if (!unit) missingFields.push('unit');

    if (missingFields.length) {
      issues.push(`Ingredient ${idx + 1} is missing ${missingFields.join(' and ')}.`);
      if (!name) markInvalid(nameInput);
      if (!amount) markInvalid(amountInput);
      if (!unit) markInvalid(unitInput);
      return;
    }

    const depends_on = depToken
      ? { token: slugify(depToken), option: depOption ? slugify(depOption) : null }
      : null;
    const sectionValue = section || null;
    const lineGroupValue = lineGroup || null;
    const optionDisplay = alt ? `${name} (${alt})` : name;

    if (isChoice) {
      if (!choiceGroup) {
        issues.push(`Ingredient ${idx + 1} is marked as a dropdown option but needs a Choice group name.`);
        markInvalid(choiceGroupInput);
        missingChoiceGroup = true;
        return;
      }

      const tokenBase = slugify(choiceGroup);
      const token = uniqueToken(tokenBase, tokenCounts, { enforceUnique: false });
      const optionKey = slugify(optionValue || name);
      if (!tokenOrder.includes(token)) tokenOrder.push(token);

      if (!ingredients[token]) {
        ingredients[token] = {
          token,
          options: [],
          isChoice: true,
          depends_on,
          line_group: lineGroupValue,
          section: sectionValue,
        };
      }

      if (!ingredients[token].depends_on && depends_on) {
        ingredients[token].depends_on = depends_on;
      }
      if (!ingredients[token].line_group && lineGroupValue) {
        ingredients[token].line_group = lineGroupValue;
      }
      if (!ingredients[token].section && sectionValue) {
        ingredients[token].section = sectionValue;
      }

      ingredients[token].options.push({
        option: optionKey,
        display: optionDisplay,
        ratio: amount,
        unit,
        ingredient_id: slugify(name),
        dietary,
        depends_on,
        line_group: lineGroupValue,
        section: sectionValue,
      });

      if (!choices[token]) {
        choices[token] = { token, default_option: '' };
      }
      if (choiceLabel && !choices[token].label) {
        choices[token].label = choiceLabel;
      }
      if (isDefaultChoice) {
        if (!choices[token].default_option) {
          choices[token].default_option = optionKey;
        } else {
          console.warn(`Choice group ${token} already has a default; keeping the first one.`);
        }
      }
      return;
    }

    const tokenBase = slugify(name);
    const token = uniqueToken(tokenBase, tokenCounts, { enforceUnique: true });
    if (!tokenOrder.includes(token)) tokenOrder.push(token);
    ingredients[token] = {
      token,
      options: [
        {
          option: '',
          display: optionDisplay,
          ratio: amount,
          unit,
          ingredient_id: token,
          dietary,
          depends_on,
          line_group: lineGroupValue,
          section: sectionValue,
        },
      ],
      isChoice: false,
      depends_on,
      line_group: lineGroupValue,
      section: sectionValue,
    };
  });

  Object.keys(choices).forEach((token) => {
    const defaultOption = choices[token].default_option;
    if (!defaultOption) {
      const firstOption = ingredients[token]?.options?.[0]?.option;
      if (firstOption) choices[token].default_option = firstOption;
    }
  });

  if (missingChoiceGroup && !warnedMissingChoiceGroup) {
    window.alert('Please add a Choice group name for each dropdown ingredient.');
    warnedMissingChoiceGroup = true;
  }
  if (!missingChoiceGroup) {
    warnedMissingChoiceGroup = false;
  }

  if (Object.keys(ingredients).length === 0) {
    issues.push('Add at least one ingredient with a name, amount, and unit.');
  }

  return { ingredients, token_order: tokenOrder, choices };
}

function buildRecipeDraft() {
  clearValidationHighlights();
  const issues = [];

  const titleInput = document.getElementById('title');
  const slugInput = document.getElementById('slug');
  const notesInput = document.getElementById('notes');
  const familyInput = document.getElementById('family');
  const categoriesSelect = document.getElementById('categories');
  const defaultBaseInput = document.getElementById('default-base');

  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const notes = notesInput.value.trim();
  const family = familyInput ? familyInput.value.trim() : '';
  const categories = categoriesSelect ? [...categoriesSelect.selectedOptions].map((opt) => opt.value) : [];
  const defaultBase = Number(defaultBaseInput.value) || 1;

  if (!title) {
    issues.push('Add a recipe title.');
    markInvalid(titleInput);
  }

  if (!slug) {
    issues.push('Add a recipe ID.');
    markInvalid(slugInput);
  } else if (!/^[a-z0-9_-]+$/.test(slug)) {
    issues.push('Recipe ID can only contain letters, numbers, dashes, and underscores.');
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

  const { ingredients, token_order: tokenOrder, choices } = buildIngredientsFromForm(issues);

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
  Object.values(ingredients).forEach((tokenData) => {
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
    family,
    notes,
    steps_raw: stepsRawLines.join('\n'),
    steps: structuredSteps,
    step_sections: stepSections,
    tokens_used: tokenUsage,
    token_order: tokenOrder,
    ingredients,
    ingredient_sections: ingredientSections,
    choices,
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
  const ingredientSource = recipe.ingredients || {};
  const ingredientMap = Array.isArray(ingredientSource)
    ? ingredientSource.reduce((acc, entry) => {
        if (entry?.token) acc[entry.token] = entry;
        return acc;
      }, {})
    : ingredientSource;
  return { ...recipe, ingredients: ingredientMap, choices: recipe.choices || {} };
}

function renderPreview(recipe) {
  const titleEl = document.getElementById('preview-recipe-title');
  const noteDetails = document.getElementById('preview-recipe-note');
  const notesEl = document.getElementById('preview-notes');
  const dietaryBadgesEl = document.getElementById('preview-dietary-badges');
  const familyBadgeEl = document.getElementById('preview-family-badge');
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

  if (familyBadgeEl) {
    const familyName = (recipe.family || '').trim();
    if (familyName) {
      familyBadgeEl.textContent = `Family: ${familyName}`;
      familyBadgeEl.style.display = '';
    } else {
      familyBadgeEl.style.display = 'none';
    }
  }

  if (batchMultiplierEl) {
    const multiplier = Number(recipe.default_base) || 1;
    batchMultiplierEl.value = multiplier;
  }

  renderPreviewDietaryBadges(dietaryBadgesEl, defaultCompatibility, compatibilityPossible, hasChoiceTokens);

  const state = {
    multiplier: recipe.default_base || 1,
    panMultiplier: 1,
    selectedOptions: {},
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? defaultCompatibility.gluten_free : false,
      egg_free: compatibilityPossible.egg_free ? defaultCompatibility.egg_free : false,
      dairy_free: compatibilityPossible.dairy_free ? defaultCompatibility.dairy_free : false,
    },
  };

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
  document.getElementById('family').addEventListener('input', refreshPreview);
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
