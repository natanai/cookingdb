import { siteBehavior } from './site-behavior.js';
import { fetchBuiltJson } from './built-data.js';
import {
  adminExportPending,
  adminUpdatePending,
  familySubmitRecipe,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';
import {
  renderIngredientLines,
  renderStepLines,
  groupLinesBySection,
  recipeDefaultCompatibility,
} from './recipe-utils.js';
import { UNIT_CONVERSIONS } from './unit-conversions.js';

const ingredientRowsEl = document.getElementById('ingredient-rows');
const stepsListEl = document.getElementById('steps-list');
const dependencySuggestionsEl = document.getElementById('dependency-suggestions');
const sectionSuggestionsEl = document.getElementById('section-suggestions');
const categorySelectEl = document.getElementById('categories');
const categoryMenuEl = document.getElementById('category-menu');
const panSelectEl = document.getElementById('default-pan');
let panSizeCatalog = [];
let pendingDraftPan = '';
let ingredientAutocompleteState = 'loading';
let categoryCatalogState = 'loading';
// Remove required attribute from slug input as it's auto-generated
const slugInputField = document.getElementById('slug');
if (slugInputField) slugInputField.removeAttribute('required');

const statusEl = document.getElementById('form-status');
const pageParams = new URLSearchParams(window.location.search);
const adminEditId = Number(pageParams.get('adminEdit'));
const isAdminEditMode = Number.isInteger(adminEditId) && adminEditId > 0;
let adminEditUpdatedAt = '';

let ingredientAutocompleteEntries = [];
const ingredientAutocompleteByLabel = new Map();
const ingredientAutocompleteById = new Map();
const categorySet = new Set();
const unitChoices = new Map();
const unitSelects = new Set();
const sectionSet = new Set();
const commonUnitByIngredient = new Map();
const existingRecipeIds = new Set();
let ingredientRowSequence = 0;
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

function uniqueRecipeSlug(baseSlug) {
  if (!baseSlug || !existingRecipeIds.has(baseSlug)) return baseSlug;
  let suffix = 2;
  let candidate = `${baseSlug}-${suffix}`;
  while (existingRecipeIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
  return candidate;
}

function touchSlugFromTitle() {
  const titleInput = document.getElementById('title');
  const slugInput = document.getElementById('slug');
  if (!slugInput.dataset.userEdited || slugInput.dataset.userEdited === 'false') {
    slugInput.value = uniqueRecipeSlug(slugify(titleInput.value || ''));
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

function normalizeAutocompleteText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

async function loadIngredientAutocomplete() {
  ingredientAutocompleteState = 'loading';
  try {
    const entries = await fetchBuiltJson('ingredient-autocomplete.json', {
      label: 'Ingredient lookup',
    });
    ingredientAutocompleteEntries = Array.isArray(entries)
      ? entries
          .filter((entry) => entry?.label && entry?.ingredient_id)
          .map((entry) => ({
            ...entry,
            search: normalizeAutocompleteText(entry.label),
          }))
      : [];

    if (ingredientAutocompleteEntries.length === 0) {
      throw new Error('Ingredient lookup returned no ingredients.');
    }

    ingredientAutocompleteByLabel.clear();
    ingredientAutocompleteById.clear();
    ingredientAutocompleteEntries.forEach((entry) => {
      if (!ingredientAutocompleteByLabel.has(entry.search)) {
        ingredientAutocompleteByLabel.set(entry.search, entry);
      }
      if (!ingredientAutocompleteById.has(entry.ingredient_id)) {
        ingredientAutocompleteById.set(entry.ingredient_id, entry);
      }
    });
    ingredientAutocompleteState = 'ready';
    refreshIngredientCatalogNotes();
    refreshPreview();
  } catch (err) {
    ingredientAutocompleteState = 'failed';
    ingredientAutocompleteEntries = [];
    ingredientAutocompleteByLabel.clear();
    ingredientAutocompleteById.clear();
    refreshIngredientCatalogNotes();
    throw err;
  }
}

function ingredientAutocompleteMatches(query, limit = 8) {
  const normalized = normalizeAutocompleteText(query);
  if (!normalized) return [];

  const startsWith = [];
  const contains = [];

  for (const entry of ingredientAutocompleteEntries) {
    if (entry.search.startsWith(normalized)) {
      startsWith.push(entry);
    } else if (entry.search.includes(normalized)) {
      contains.push(entry);
    }
    if (startsWith.length >= limit) break;
  }

  if (startsWith.length < limit) {
    for (const entry of contains) {
      startsWith.push(entry);
      if (startsWith.length >= limit) break;
    }
  }

  return startsWith;
}

function exactIngredientAutocompleteMatch(value) {
  return ingredientAutocompleteByLabel.get(normalizeAutocompleteText(value)) || null;
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

function updateCategorySummary() {
  const summary = document.getElementById('category-summary');
  if (!summary || !categorySelectEl) return;

  if (categoryCatalogState === 'loading') {
    summary.textContent = 'Loading categories…';
    return;
  }
  if (categoryCatalogState === 'failed') {
    summary.textContent = 'Categories unavailable';
    return;
  }

  const selected = [...categorySelectEl.selectedOptions].map((opt) => opt.textContent);
  if (selected.length === 0) {
    summary.textContent = categorySelectEl.options.length ? 'Choose categories' : 'No categories available';
  } else if (selected.length <= 2) {
    summary.textContent = selected.join(', ');
  } else {
    summary.textContent = `${selected.length} categories selected`;
  }
}

function renderCategoryChips() {
  const container = document.getElementById('category-options');
  if (!container || !categorySelectEl) return;
  container.innerHTML = '';

  if (categoryCatalogState !== 'ready') {
    const status = document.createElement('div');
    status.className = 'muted';
    status.textContent =
      categoryCatalogState === 'failed'
        ? 'Categories could not load. Refresh the page to retry.'
        : 'Loading categories…';
    container.appendChild(status);
    updateCategorySummary();
    return;
  }

  if (categorySelectEl.options.length === 0) {
    const status = document.createElement('div');
    status.className = 'muted';
    status.textContent = 'No recipe categories are available.';
    container.appendChild(status);
    updateCategorySummary();
    return;
  }

  [...categorySelectEl.options].forEach((opt) => {
    if (opt.disabled) return;

    const label = document.createElement('label');
    label.className = 'category-check';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = opt.selected;
    input.value = opt.value;
    input.addEventListener('change', () => {
      opt.selected = input.checked;
      categorySelectEl.dispatchEvent(new Event('change', { bubbles: true }));
      updateCategorySummary();
    });

    const text = document.createElement('span');
    text.textContent = opt.textContent;

    label.append(input, text);
    container.appendChild(label);
  });

  updateCategorySummary();
}

function syncCategoryOptions() {
  if (!categorySelectEl) return;
  const previousSelection = new Set([...categorySelectEl.selectedOptions].map((opt) => opt.value));
  categorySelectEl.innerHTML = '';

  const sortedCategories = [...categorySet].sort((a, b) => a.localeCompare(b));
  sortedCategories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    opt.selected = previousSelection.has(cat) || pendingDraftCategories.includes(cat);
    categorySelectEl.appendChild(opt);
  });

  const ready = categoryCatalogState === 'ready';
  categorySelectEl.disabled = !ready;
  if (categoryMenuEl) {
    categoryMenuEl.setAttribute('aria-busy', categoryCatalogState === 'loading' ? 'true' : 'false');
  }
  renderCategoryChips();
}

let pendingDraftCategories = [];

function syncUnitSelect(selectEl, preferredValue = '') {
  if (!selectEl) return;
  const targetValue = preferredValue || selectEl.value;
  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Unit';
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

function commonUnitForIngredient(ingredientId) {
  return commonUnitByIngredient.get(String(ingredientId || '').trim()) || '';
}

function syncPanOptions({ failed = false } = {}) {
  if (!panSelectEl) return;
  const current = pendingDraftPan || panSelectEl.value || '';
  panSelectEl.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = failed ? 'Pan sizes unavailable' : 'No pan scaling';
  panSelectEl.appendChild(none);

  panSizeCatalog.forEach((pan) => {
    const option = document.createElement('option');
    option.value = pan.id;
    option.textContent = pan.label;
    option.selected = pan.id === current;
    panSelectEl.appendChild(option);
  });

  const hasCatalog = panSizeCatalog.length > 0;
  panSelectEl.disabled = failed || !hasCatalog;
  panSelectEl.setAttribute('aria-busy', 'false');

  if (!hasCatalog) {
    panSelectEl.value = '';
    pendingDraftPan = '';
    return;
  }

  if (!panSizeCatalog.some((pan) => pan.id === current)) {
    panSelectEl.value = '';
  }
  pendingDraftPan = '';
}

async function loadPanOptions() {
  if (!panSelectEl) return;
  panSelectEl.disabled = true;
  panSelectEl.setAttribute('aria-busy', 'true');

  try {
    const pans = await fetchBuiltJson('pan-sizes.json', { label: 'Pan sizes' });
    panSizeCatalog = Array.isArray(pans) ? pans.filter((pan) => pan?.id && pan?.label) : [];
    if (panSizeCatalog.length === 0) throw new Error('Pan catalog is empty');
    syncPanOptions();
  } catch (err) {
    console.warn('Could not load pan sizes', err);
    panSizeCatalog = [];
    syncPanOptions({ failed: true });
  }
}

async function loadAuthoringOptions() {
  categoryCatalogState = 'loading';
  syncCategoryOptions();

  try {
    const options = await fetchBuiltJson('authoring-options.json', {
      label: 'Recipe authoring options',
    });
    if (!options || typeof options !== 'object') {
      throw new Error('Recipe authoring options returned invalid data.');
    }

    categorySet.clear();
    sectionSet.clear();
    commonUnitByIngredient.clear();
    existingRecipeIds.clear();

    (options.categories || []).forEach((category) => {
      if (category) categorySet.add(String(category));
    });
    (options.sections || []).forEach((section) => {
      if (section) sectionSet.add(String(section));
    });
    (options.units || []).forEach((unit) => {
      const value = String(unit || '').trim();
      if (value) unitChoices.set(value, unitChoices.get(value) || value);
    });
    Object.entries(options.common_units_by_ingredient || {}).forEach(([ingredientId, unit]) => {
      if (ingredientId && unit) commonUnitByIngredient.set(ingredientId, String(unit));
    });
    (options.recipe_ids || []).forEach((recipeId) => {
      if (recipeId) existingRecipeIds.add(String(recipeId));
    });

    categoryCatalogState = 'ready';
    syncCategoryOptions();
    pendingDraftCategories = [];
    syncUnitSelects();
    updateSectionSuggestions();
    updateDependencySuggestions();
    touchSlugFromTitle();
  } catch (err) {
    categoryCatalogState = 'failed';
    syncCategoryOptions();
    console.warn('Could not load recipe authoring options', err);
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
      const preservedToken = row.querySelector('.ingredient-token')?.value.trim() || '';
      const tokenBase = preservedToken || slugify(groupRaw);
      const token = uniqueToken(tokenBase, tokenCounts, { enforceUnique: false });
      if (seenTokens.has(token)) return;
      const label = row.querySelector('.ingredient-choice-swap-label')?.value.trim() || groupRaw;
      seenTokens.add(token);
      choices.push({ token, name: label || groupRaw });
      return;
    }

    const preservedToken = row.querySelector('.ingredient-token')?.value.trim() || '';
    const tokenBase = preservedToken || slugify(name);
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
  if (defaults.is_substitution) row.classList.add('is-substitution');
  row.innerHTML = `
    <div class="ingredient-main">
      <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
      <select class="ingredient-unit" aria-label="Unit"></select>
      <div class="ingredient-autocomplete">
        <input
          class="ingredient-name"
          placeholder="Ingredient"
          aria-label="Ingredient name"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
        />
        <div class="ingredient-autocomplete-menu" role="listbox" hidden></div>
      </div>
      <button type="button" class="ingredient-more-toggle" aria-expanded="false" aria-label="Ingredient options">•••</button>
      <button type="button" class="remove-row-button remove-ingredient" aria-label="Remove ingredient">×</button>
    </div>

    <div class="ingredient-advanced" hidden>
      <div class="ingredient-action-row">
        <button type="button" class="editor-action start-section-here">Start section here</button>
        <button type="button" class="editor-action add-substitution">Add substitution</button>
      </div>

      <div class="ingredient-advanced-grid">
        <input class="ingredient-section" type="hidden" />
        <input class="ingredient-token" type="hidden" />
        <input class="ingredient-id" type="hidden" />

        <label class="advanced-field">
          <span>Prep note</span>
          <input class="ingredient-prep" placeholder="finely chopped, divided…" />
        </label>

        <label class="advanced-field">
          <span>Keep on the same line with</span>
          <input class="ingredient-inline-group" placeholder="Optional group name" />
        </label>

        <details class="advanced-detail">
          <summary>Dietary compatibility</summary>
          <div class="dietary-slot"></div>
        </details>

        <div class="choice-block">
          <label class="choice-toggle">
            <input type="checkbox" class="ingredient-choice-toggle" />
            <span>Part of a substitution group</span>
          </label>
          <div class="choice-fields" hidden>
            <label class="advanced-field">
              <span>Group</span>
              <input class="ingredient-choice-group" placeholder="Milk, broth, flour…" />
            </label>
            <label class="advanced-field">
              <span>Shown to readers as</span>
              <input class="ingredient-choice-swap-label" placeholder="Optional label" />
            </label>
            <label class="advanced-field">
              <span>Option name</span>
              <input class="ingredient-option-key" placeholder="Uses ingredient name if blank" />
            </label>
            <label class="choice-default">
              <input type="checkbox" class="ingredient-default-choice" />
              <span>Use this option by default</span>
            </label>
          </div>
        </div>

        <div class="conditional-block">
          <label class="conditional-toggle">
            <input type="checkbox" class="ingredient-conditional-toggle" />
            <span>Only include this ingredient sometimes</span>
          </label>
          <div class="conditional-fields" hidden>
            <label class="advanced-field">
              <span>When</span>
              <input class="ingredient-dep-token" list="dependency-suggestions" placeholder="Ingredient or substitution group" />
            </label>
            <label class="advanced-field">
              <span>Is set to</span>
              <input class="ingredient-dep-option" placeholder="Option" />
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  row.querySelector('.dietary-slot').replaceWith(buildDietaryCheckboxes());

  const nameInput = row.querySelector('.ingredient-name');
  const autocompleteMenu = row.querySelector('.ingredient-autocomplete-menu');
  const sectionInput = row.querySelector('.ingredient-section');
  const preservedTokenInput = row.querySelector('.ingredient-token');
  const ingredientIdInput = row.querySelector('.ingredient-id');
  const amountInput = row.querySelector('.ingredient-amount');
  const unitInput = row.querySelector('.ingredient-unit');
  const prepInput = row.querySelector('.ingredient-prep');
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
  nameInput.dataset.originalName = nameInput.value.trim();
  sectionInput.value = defaults.section || '';
  preservedTokenInput.value = defaults.token || '';
  ingredientIdInput.value = defaults.ingredient_id || '';
  amountInput.value = defaults.amount || '';
  syncUnitSelect(unitInput, defaults.unit || '');
  unitSelects.add(unitInput);
  prepInput.value = defaults.prep || defaults.alt || '';
  depTokenInput.value = defaults.depends_on?.token || '';
  depOptionInput.value = defaults.depends_on?.option || '';
  optionInput.value = defaults.option || '';
  groupInput.value = defaults.line_group || '';
  choiceGroupInput.value = defaults.choice_group || '';
  choiceLabelInput.value = defaults.choice_label || '';
  choiceDefaultInput.checked = Boolean(defaults.choice_default);
  isChoiceInput.checked = Boolean(defaults.isChoice);
  conditionalToggle.checked = Boolean(depTokenInput.value || depOptionInput.value);
  unitInput.dataset.userChanged = 'false';

  if (defaults.dietary) {
    row.querySelectorAll('[data-dietary-key]').forEach((input) => {
      const key = input.dataset.dietaryKey;
      if (Object.prototype.hasOwnProperty.call(defaults.dietary, key)) input.checked = Boolean(defaults.dietary[key]);
    });
  }

  const syncChoiceFields = () => {
    const isChoice = isChoiceInput.checked;
    row.classList.toggle('is-choice', isChoice);
    choiceFields.hidden = !isChoice;
  };
  const syncConditionalFields = () => {
    conditionalFields.hidden = !conditionalToggle.checked;
  };
  syncChoiceFields();
  syncConditionalFields();

  const hasAdvancedDefaults = Boolean(
    sectionInput.value ||
      prepInput.value ||
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
  if (hasAdvancedDefaults && !defaults.is_substitution) {
    advancedPanel.hidden = false;
    toggleButton.setAttribute('aria-expanded', 'true');
  }

  const handleChange = () => {
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
    saveDraftSoon();
  };

  const closeAutocomplete = () => {
    autocompleteMenu.hidden = true;
    autocompleteMenu.innerHTML = '';
    nameInput.setAttribute('aria-expanded', 'false');
  };

  const selectAutocompleteEntry = (entry) => {
    if (!entry) return;
    nameInput.value = entry.label;
    nameInput.dataset.originalName = entry.label;
    ingredientIdInput.value = entry.ingredient_id || '';
    if (entry.unit && !unitInput.value) {
      syncUnitSelect(unitInput, entry.unit);
    }
    closeAutocomplete();
    handleChange();
  };

  const acceptNewIngredient = () => {
    const value = nameInput.value.trim();
    if (!value) return;
    ingredientIdInput.value = '';
    nameInput.dataset.originalName = value;
    closeAutocomplete();
    handleChange();
  };

  const renderAutocomplete = () => {
    const query = nameInput.value.trim();
    autocompleteMenu.innerHTML = '';

    if (!query) {
      closeAutocomplete();
      return;
    }

    if (ingredientAutocompleteState !== 'ready') {
      const status = document.createElement('button');
      status.type = 'button';
      status.disabled = true;
      status.className = 'ingredient-autocomplete-option';
      status.textContent =
        ingredientAutocompleteState === 'failed'
          ? 'Ingredient lookup unavailable — refresh to retry'
          : 'Loading ingredients…';
      autocompleteMenu.appendChild(status);
      autocompleteMenu.hidden = false;
      nameInput.setAttribute('aria-expanded', 'true');
      return;
    }

    const matches = ingredientAutocompleteMatches(query);
    if (matches.length) {
      matches.forEach((entry) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'ingredient-autocomplete-option';
        option.setAttribute('role', 'option');

        const label = document.createElement('span');
        label.textContent = entry.label;
        option.appendChild(label);

        if (entry.unit) {
          const unit = document.createElement('small');
          unit.textContent = entry.unit;
          option.appendChild(unit);
        }

        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => selectAutocompleteEntry(entry));
        autocompleteMenu.appendChild(option);
      });
    } else {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'ingredient-autocomplete-option ingredient-autocomplete-add';
      addButton.textContent = `Add “${query}” as ingredient`;
      addButton.addEventListener('pointerdown', (event) => event.preventDefault());
      addButton.addEventListener('click', acceptNewIngredient);
      autocompleteMenu.appendChild(addButton);
    }

    autocompleteMenu.hidden = false;
    nameInput.setAttribute('aria-expanded', 'true');
  };

  const tryAutofillUnit = () => {
    if (unitInput.dataset.userChanged === 'true' || unitInput.value) return;
    const exact = exactIngredientAutocompleteMatch(nameInput.value);
    const autoUnit = exact?.unit || commonUnitForToken(slugify(nameInput.value || ''));
    if (autoUnit) syncUnitSelect(unitInput, autoUnit);
  };

  nameInput.addEventListener('input', () => {
    if (
      ingredientIdInput.value &&
      nameInput.value.trim() !== (nameInput.dataset.originalName || '')
    ) {
      ingredientIdInput.value = '';
    }
    renderAutocomplete();
    saveDraftSoon();
  });

  nameInput.addEventListener('focus', renderAutocomplete);

  nameInput.addEventListener('change', () => {
    const exact = exactIngredientAutocompleteMatch(nameInput.value);
    if (exact && !ingredientIdInput.value) {
      selectAutocompleteEntry(exact);
      return;
    }
    tryAutofillUnit();
    handleChange();
  });

  nameInput.addEventListener('blur', () => {
    window.setTimeout(closeAutocomplete, 100);
    tryAutofillUnit();
  });

  row.addEventListener('change', (event) => {
    if (event.target === nameInput) return;
    handleChange();
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAutocomplete();
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    if (!autocompleteMenu.hidden) {
      const firstOption = autocompleteMenu.querySelector('button');
      if (firstOption) {
        event.preventDefault();
        firstOption.click();
        return;
      }
    }

    event.preventDefault();
    const next = createIngredientRow({ section: sectionInput.value });
    next.querySelector('.ingredient-amount')?.focus();
    refreshStepIngredientPickers();
  });

  isChoiceInput.addEventListener('change', () => {
    if (!isChoiceInput.checked) {
      choiceGroupInput.value = '';
      choiceLabelInput.value = '';
      optionInput.value = '';
      choiceDefaultInput.checked = false;
      row.classList.remove('is-substitution');
    }
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
    advancedPanel.hidden = expanded;
  });

  unitInput.addEventListener('change', () => {
    unitInput.dataset.userChanged = 'true';
  });

  row.querySelector('.start-section-here').addEventListener('click', () => {
    const divider = createIngredientSection('', row);
    divider.querySelector('.section-divider-input')?.focus();
    advancedPanel.hidden = true;
    toggleButton.setAttribute('aria-expanded', 'false');
    saveDraftSoon();
  });

  row.querySelector('.add-substitution').addEventListener('click', () => {
    const group = choiceGroupInput.value.trim() || nameInput.value.trim() || 'Substitution';
    isChoiceInput.checked = true;
    choiceGroupInput.value = group;
    choiceLabelInput.value = choiceLabelInput.value.trim() || nameInput.value.trim() || group;
    choiceDefaultInput.checked = true;
    syncChoiceFields();

    const substitute = createIngredientRow({
      isChoice: true,
      is_substitution: true,
      token: preservedTokenInput.value || slugify(group),
      choice_group: group,
      choice_label: choiceLabelInput.value,
      choice_default: false,
      section: sectionInput.value,
    });
    row.after(substitute);
    substitute.querySelector('.ingredient-name')?.focus();
    handleChange();
  });

  row.querySelector('.remove-ingredient').addEventListener('click', () => {
    unitSelects.delete(unitInput);
    row.remove();
    updateDependencySuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
    saveDraftSoon();
  });

  ingredientRowsEl.appendChild(row);
  return row;
}

function createIngredientSection(defaultName = '', beforeNode = null) {
  const divider = document.createElement('div');
  divider.className = 'ingredient-section-divider';
  divider.innerHTML = `
    <input class="section-divider-input" placeholder="Section name" aria-label="Ingredient section name" />
    <span class="section-divider-line" aria-hidden="true"></span>
    <button type="button" class="remove-row-button remove-section" aria-label="Remove section">×</button>
  `;
  divider.querySelector('.section-divider-input').value = defaultName;
  divider.querySelector('.section-divider-input').addEventListener('input', () => {
    refreshPreview();
    saveDraftSoon();
  });
  divider.querySelector('.remove-section').addEventListener('click', () => {
    divider.remove();
    refreshPreview();
    saveDraftSoon();
  });

  if (beforeNode && beforeNode.parentNode === ingredientRowsEl) {
    ingredientRowsEl.insertBefore(divider, beforeNode);
  } else {
    ingredientRowsEl.appendChild(divider);
  }
  return divider;
}

function createStepRow(defaultText = '', defaultSection = '', defaults = {}) {
  const li = document.createElement('li');
  li.className = 'step-row';

  const main = document.createElement('div');
  main.className = 'step-main';

  const stepNumber = document.createElement('span');
  stepNumber.className = 'step-number';
  stepNumber.setAttribute('aria-hidden', 'true');

  const textInput = document.createElement('textarea');
  textInput.className = 'step-text';
  textInput.rows = 3;
  textInput.placeholder = 'Write the next direction…';
  textInput.value = defaultText;

  const ingredientsWrap = document.createElement('div');
  ingredientsWrap.className = 'step-ingredients';
  ingredientsWrap.setAttribute('aria-label', 'Insert an ingredient');

  const actions = document.createElement('div');
  actions.className = 'step-actions';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'step-more-toggle';
  toggleButton.setAttribute('aria-expanded', 'false');
  toggleButton.setAttribute('aria-label', 'Step options');
  toggleButton.textContent = '•••';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-row-button remove-step';
  removeButton.setAttribute('aria-label', 'Remove step');
  removeButton.textContent = '×';

  actions.append(toggleButton, removeButton);
  main.append(stepNumber, textInput, actions, ingredientsWrap);

  const advanced = document.createElement('div');
  advanced.className = 'step-advanced';
  advanced.hidden = true;

  const advancedGrid = document.createElement('div');
  advancedGrid.className = 'step-advanced-grid';

  const sectionControl = document.createElement('label');
  sectionControl.className = 'step-option-row step-section-row';
  const sectionLabelText = document.createElement('span');
  sectionLabelText.className = 'step-option-label';
  sectionLabelText.textContent = 'Section';
  const sectionInput = document.createElement('input');
  sectionInput.className = 'step-section';
  sectionInput.placeholder = 'Prep, sauce, assembly…';
  sectionInput.value = defaultSection;
  sectionControl.append(sectionLabelText, sectionInput);

  const variationBlock = document.createElement('details');
  variationBlock.className = 'step-variation-details';
  variationBlock.innerHTML = `
    <summary>
      <span>Conditional variation</span>
      <span class="disclosure-caret" aria-hidden="true">▾</span>
    </summary>
    <div class="step-variation-body">
      <div class="variation-condition-row">
        <span class="variation-condition-word">When</span>
        <input class="variation-token" list="dependency-suggestions" placeholder="Ingredient or substitution" aria-label="Variation ingredient or substitution" />
        <span class="variation-condition-word">is</span>
        <input class="variation-option" placeholder="Option" aria-label="Variation option" />
      </div>
      <label class="advanced-field variation-copy-field">
        <span>Use this direction instead / in addition</span>
        <textarea class="variation-text" rows="2" placeholder="Extra direction for that choice"></textarea>
      </label>
    </div>
  `;
  variationBlock.querySelector('.variation-token').value = defaults.variation_token || '';
  variationBlock.querySelector('.variation-option').value = defaults.variation_option || '';
  variationBlock.querySelector('.variation-text').value = defaults.variation_text || '';
  if (defaults.variation_token || defaults.variation_option || defaults.variation_text) {
    variationBlock.open = true;
  }

  advancedGrid.append(sectionControl, variationBlock);
  advanced.appendChild(advancedGrid);
  li.append(main, advanced);

  const setExpanded = (expanded) => {
    toggleButton.setAttribute('aria-expanded', String(expanded));
    advanced.hidden = !expanded;
  };

  textInput.addEventListener('input', () => {
    syncStepIngredientMatches(li);
    refreshPreview();
    saveDraftSoon();
  });
  li.addEventListener('change', () => {
    refreshPreview();
    saveDraftSoon();
  });

  toggleButton.addEventListener('click', () => {
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  removeButton.addEventListener('click', () => {
    li.remove();
    refreshPreview();
    saveDraftSoon();
  });

  if (defaultSection || defaults.variation_token || defaults.variation_text) setExpanded(true);

  stepsListEl.appendChild(li);
  refreshStepIngredientPicker(li);
  return li;
}

function insertIngredientName(textarea, name) {
  if (!textarea || !name) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const needsLeadingSpace = before && !/\s$/.test(before);
  const needsTrailingSpace = after && !/^[\s.,;:!?]/.test(after);
  const insertion = `${needsLeadingSpace ? ' ' : ''}${name}${needsTrailingSpace ? ' ' : ''}`;
  textarea.value = `${before}${insertion}${after}`;
  const caret = before.length + insertion.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function ingredientNamePattern(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  const escaped = value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const plural = /[a-z]$/i.test(value) && !/s$/i.test(value) ? '(?:s)?' : '';
  return new RegExp(`\\b${escaped}${plural}\\b`, 'i');
}

function syncStepIngredientMatches(stepRow) {
  const textarea = stepRow.querySelector('.step-text');
  const text = textarea?.value || '';
  stepRow.querySelectorAll('.ingredient-reference-chip').forEach((button) => {
    const name = button.dataset.ingredientName || '';
    const input = button.querySelector('input[type="checkbox"]');
    const pattern = ingredientNamePattern(name);
    const matched = Boolean(pattern && pattern.test(text));
    input.checked = matched;
    button.classList.toggle('is-linked', matched);
    button.setAttribute('aria-pressed', String(matched));
  });
}

function refreshStepIngredientPicker(stepRow) {
  const picker = stepRow.querySelector('.step-ingredients');
  if (!picker) return;
  const textarea = stepRow.querySelector('.step-text');
  const choices = ingredientChoices();
  picker.innerHTML = '';

  if (!choices.length) {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;

  choices.forEach((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ingredient-reference-chip';
    button.dataset.ingredientName = choice.name;
    button.title = `Insert ${choice.name}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = choice.token;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = choice.name;

    button.append(input, label);
    button.addEventListener('click', () => {
      insertIngredientName(textarea, choice.name);
      input.checked = true;
      button.classList.add('is-linked');
      button.setAttribute('aria-pressed', 'true');
      refreshPreview();
      saveDraftSoon();
    });
    picker.appendChild(button);
  });
  syncStepIngredientMatches(stepRow);
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
  const rowSectionMap = new Map();
  let activeSection = '';
  [...ingredientRowsEl.children].forEach((child) => {
    if (child.classList.contains('ingredient-section-divider')) {
      activeSection = child.querySelector('.section-divider-input')?.value.trim() || '';
      return;
    }
    if (child.classList.contains('ingredient-row')) rowSectionMap.set(child, activeSection);
  });

  ingredientRows.forEach((row, idx) => {
    const nameInput = row.querySelector('.ingredient-name');
    const sectionInput = row.querySelector('.ingredient-section');
    const preservedTokenInput = row.querySelector('.ingredient-token');
    const ingredientIdInput = row.querySelector('.ingredient-id');
    const amountInput = row.querySelector('.ingredient-amount');
    const unitInput = row.querySelector('.ingredient-unit');
    const prepInput = row.querySelector('.ingredient-prep');
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
    const preservedToken = preservedTokenInput?.value.trim() || '';
    const preservedIngredientId = ingredientIdInput?.value.trim() || '';
    const section = sectionInput?.value.trim() || rowSectionMap.get(row) || '';
    const amount = amountInput?.value.trim() || '';
    const unit = unitInput?.value.trim() || '';
    const prep = prepInput?.value.trim() || '';
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
      !prep &&
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
    const optionDisplay = name;

    if (isChoice) {
      if (!choiceGroup) {
        issues.push(`Ingredient ${idx + 1} is marked as a dropdown option but needs a Choice group name.`);
        markInvalid(choiceGroupInput);
        missingChoiceGroup = true;
        return;
      }

      const tokenBase = preservedToken || slugify(choiceGroup);
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
        ingredient_id: preservedIngredientId || slugify(name),
        prep,
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

    const tokenBase = preservedToken || slugify(name);
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
          ingredient_id: preservedIngredientId || token,
          prep,
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
  const bylineInput = document.getElementById('byline');
  const defaultPanInput = document.getElementById('default-pan');
  const categoriesSelect = document.getElementById('categories');
  const defaultBaseInput = document.getElementById('default-base');
  const servingsInput = document.getElementById('servings-per-batch');

  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const notes = notesInput.value.trim();
  const family = familyInput ? familyInput.value.trim() : '';
  const byline = bylineInput ? bylineInput.value.trim() : '';
  const defaultPan = defaultPanInput?.value?.trim() || '';
  const categories = categoriesSelect ? [...categoriesSelect.selectedOptions].map((opt) => opt.value) : [];
  const defaultBase = Number(defaultBaseInput.value) || 1;
  const servingsRaw = servingsInput?.value?.trim() || '';
  const servingsPerBatch = servingsRaw ? Number(servingsRaw) : null;

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

  if (categoryCatalogState === 'failed') {
    issues.push('Categories could not load. Refresh the page before submitting this recipe.');
    markInvalid(document.getElementById('category-menu') || categoriesSelect);
  } else if (categories.length === 0) {
    issues.push(
      categoryCatalogState === 'loading'
        ? 'Categories are still loading. Wait a moment and try again.'
        : 'Add at least one category.'
    );
    markInvalid(document.getElementById('category-menu') || categoriesSelect);
  }

  if (ingredientAutocompleteState === 'failed') {
    issues.push('Ingredient lookup could not load. Refresh the page before submitting this recipe.');
  }

  if (!Number.isFinite(defaultBase) || defaultBase <= 0) {
    issues.push('Batch size must be a positive number.');
    markInvalid(defaultBaseInput);
  }
  if (servingsRaw && (!Number.isFinite(servingsPerBatch) || servingsPerBatch <= 0)) {
    issues.push('Servings per batch must be a positive number.');
    markInvalid(servingsInput);
  }

  if (defaultPan && !panSizeCatalog.some((pan) => pan.id === defaultPan)) {
    issues.push('Choose a valid pan size or turn off pan scaling.');
    markInvalid(defaultPanInput);
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
      return;
    }

    let stepText = text;
    const choiceNames = new Map(ingredientChoices().map((choice) => [choice.token, choice.name]));
    selectedTokens.forEach((token) => {
      const tokenPattern = new RegExp(`{{\\s*${token}\\s*}}`);
      if (tokenPattern.test(stepText)) return;
      const displayName = choiceNames.get(token) || '';
      if (displayName) {
        const namePattern = ingredientNamePattern(displayName);
        if (namePattern && namePattern.test(stepText)) {
          stepText = stepText.replace(namePattern, `{{${token}}}`);
          return;
        }
      }
      stepText = `${stepText} {{${token}}}`.trim();
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
    issues.push('Add at least one direction.');
  }

  const unusedTokens = tokenOrder.filter((token) => !tokenUsage.includes(token));
  if (unusedTokens.length) {
    issues.push(`Use each ingredient in the directions at least once: ${unusedTokens.join(', ')}.`);
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
    servings_per_batch: Number.isFinite(servingsPerBatch) && servingsPerBatch > 0 ? servingsPerBatch : null,
    categories,
    family,
    byline,
    notes,
    steps_raw: stepsRawLines.join('\n'),
    steps: structuredSteps,
    step_sections: stepSections,
    tokens_used: tokenUsage,
    token_order: tokenOrder,
    ingredients,
    ingredient_sections: ingredientSections,
    choices,
    pan_sizes: defaultPan
      ? panSizeCatalog.map((pan) => ({ ...pan, is_default: pan.id === defaultPan }))
      : [],
    default_pan: defaultPan || null,
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
  clearValidationHighlights();
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
  renderPreviewLines(stepsEl, stepSections, { allowHtml: true });
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
  const { showAlternatives = false, allowHtml = false } = options;

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
      if (allowHtml) {
        li.innerHTML = `<span class="step-text">${line.text}</span>`;
      } else {
        li.textContent = line.text;
      }
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

const DRAFT_KEY = "cookingdb:add-recipe:draft:v2";
let draftSaveTimer = null;
let restoringDraft = false;

function serializeIngredientEditor() {
  return [...ingredientRowsEl.children].map((child) => {
    if (child.classList.contains('ingredient-section-divider')) {
      return {
        kind: 'section',
        name: child.querySelector('.section-divider-input')?.value || '',
      };
    }
    if (!child.classList.contains('ingredient-row')) return null;
    return {
      kind: 'ingredient',
      token: child.querySelector('.ingredient-token')?.value || '',
      ingredient_id: child.querySelector('.ingredient-id')?.value || '',
      name: child.querySelector('.ingredient-name')?.value || '',
      amount: child.querySelector('.ingredient-amount')?.value || '',
      unit: child.querySelector('.ingredient-unit')?.value || '',
      section: child.querySelector('.ingredient-section')?.value || '',
      prep: child.querySelector('.ingredient-prep')?.value || '',
      line_group: child.querySelector('.ingredient-inline-group')?.value || '',
      isChoice: Boolean(child.querySelector('.ingredient-choice-toggle')?.checked),
      choice_group: child.querySelector('.ingredient-choice-group')?.value || '',
      choice_label: child.querySelector('.ingredient-choice-swap-label')?.value || '',
      option: child.querySelector('.ingredient-option-key')?.value || '',
      choice_default: Boolean(child.querySelector('.ingredient-default-choice')?.checked),
      depends_on: {
        token: child.querySelector('.ingredient-dep-token')?.value || '',
        option: child.querySelector('.ingredient-dep-option')?.value || '',
      },
      dietary: readDietaryFlags(child),
      is_substitution: child.classList.contains('is-substitution'),
    };
  }).filter(Boolean);
}

function serializeSteps() {
  return [...stepsListEl.querySelectorAll('.step-row')].map((row) => ({
    text: row.querySelector('.step-text')?.value || '',
    section: row.querySelector('.step-section')?.value || '',
    variation_token: row.querySelector('.variation-token')?.value || '',
    variation_option: row.querySelector('.variation-option')?.value || '',
    variation_text: row.querySelector('.variation-text')?.value || '',
  }));
}

function saveDraft() {
  if (restoringDraft || isAdminEditMode) return;
  const draft = {
    title: document.getElementById('title')?.value || '',
    servings: document.getElementById('servings-per-batch')?.value || '',
    family: document.getElementById('family')?.value || '',
    byline: document.getElementById('byline')?.value || '',
    default_base: document.getElementById('default-base')?.value || '1',
    default_pan: document.getElementById('default-pan')?.value || '',
    notes: document.getElementById('notes')?.value || '',
    categories: categorySelectEl ? [...categorySelectEl.selectedOptions].map((opt) => opt.value) : [],
    ingredients: serializeIngredientEditor(),
    steps: serializeSteps(),
    saved_at: Date.now(),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    const status = document.getElementById('draft-status');
    if (status) status.textContent = 'Saved';
  } catch (err) {
    console.warn('Could not save recipe draft', err);
  }
}

function saveDraftSoon() {
  if (restoringDraft || isAdminEditMode) return;
  const status = document.getElementById('draft-status');
  if (status) status.textContent = 'Saving…';
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(saveDraft, 300);
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn('Could not clear recipe draft', err);
  }
}

function restoreDraft() {
  if (isAdminEditMode) return false;
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch (err) {
    console.warn('Could not read recipe draft', err);
    return false;
  }
  if (!draft || typeof draft !== 'object') return false;

  const hasContent =
    draft.title ||
    draft.servings ||
    draft.family ||
    draft.byline ||
    draft.default_pan ||
    draft.notes ||
    (draft.categories || []).length ||
    (draft.ingredients || []).some((item) => item.kind === 'ingredient' && (item.name || item.amount)) ||
    (draft.steps || []).some((step) => step.text);
  if (!hasContent) return false;

  restoringDraft = true;
  pendingDraftCategories = Array.isArray(draft.categories) ? draft.categories : [];
  syncCategoryOptions();
  document.getElementById('title').value = draft.title || '';
  document.getElementById('servings-per-batch').value = draft.servings || '';
  document.getElementById('family').value = draft.family || '';
  document.getElementById('byline').value = draft.byline || '';
  document.getElementById('default-base').value = draft.default_base || '1';
  pendingDraftPan = draft.default_pan || '';
  if (panSelectEl && panSizeCatalog.length) {
    panSelectEl.value = pendingDraftPan;
    pendingDraftPan = '';
  }
  document.getElementById('notes').value = draft.notes || '';

  ingredientRowsEl.innerHTML = '';
  stepsListEl.innerHTML = '';
  unitSelects.clear();

  (draft.ingredients || []).forEach((item) => {
    if (item.kind === 'section') createIngredientSection(item.name || '');
    else if (item.kind === 'ingredient') createIngredientRow(item);
  });
  if (!ingredientRowsEl.querySelector('.ingredient-row')) createIngredientRow();

  (draft.steps || []).forEach((step) => {
    createStepRow(step.text || '', step.section || '', step);
  });
  if (!stepsListEl.querySelector('.step-row')) createStepRow();

  touchSlugFromTitle();
  refreshStepIngredientPickers();
  refreshPreview();
  restoringDraft = false;

  const status = document.getElementById('draft-status');
  if (status) status.textContent = 'Draft restored';
  return true;
}

function setReviewOpen(open) {
  const panel = document.getElementById('review-panel');
  const button = document.getElementById('review-recipe');
  if (!panel) return;
  panel.hidden = !open;
  if (button) button.textContent = open ? 'Hide review' : 'Review recipe';
  if (open) {
    refreshPreview();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function attachEditorState(recipe) {
  return {
    ...recipe,
    editor_state: {
      version: 1,
      ingredients: serializeIngredientEditor(),
      steps: serializeSteps(),
    },
  };
}

function unwrapPendingRecipe(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.recipe && typeof item.recipe === 'object') return item.recipe;
  if (item.payload && typeof item.payload === 'object') {
    if (item.payload.payload && typeof item.payload.payload === 'object') return item.payload.payload;
    if (item.payload.recipe && typeof item.payload.recipe === 'object') return item.payload.recipe;
    return item.payload;
  }
  return item;
}

function editorIngredientsFromRecipe(recipe) {
  const saved = recipe?.editor_state?.ingredients;
  if (Array.isArray(saved) && saved.length) return saved;

  const source =
    recipe?.ingredients && typeof recipe.ingredients === 'object'
      ? recipe.ingredients
      : {};
  const ingredientMap = Array.isArray(source)
    ? Object.fromEntries(source.filter((entry) => entry?.token).map((entry) => [entry.token, entry]))
    : source;
  const order = Array.isArray(recipe?.token_order)
    ? [...recipe.token_order, ...Object.keys(ingredientMap)]
    : Object.keys(ingredientMap);
  const tokens = [...new Set(order)].filter((token) => ingredientMap[token]);
  const choices =
    recipe?.choices && typeof recipe.choices === 'object'
      ? recipe.choices
      : {};

  const items = [];
  let visibleSection = '';

  tokens.forEach((token) => {
    const entry = ingredientMap[token] || {};
    const options = Array.isArray(entry.options) ? entry.options : [];
    const choice = choices[token] || {};
    const isChoice =
      Boolean(entry.isChoice) ||
      options.length > 1 ||
      options.some((option) => Boolean(option?.option));

    options.forEach((option, index) => {
      const section = String(option?.section ?? entry.section ?? '').trim();
      if (section && section !== visibleSection) {
        items.push({ kind: 'section', name: section });
        visibleSection = section;
      }

      items.push({
        kind: 'ingredient',
        token,
        ingredient_id: option?.ingredient_id || '',
        name: option?.display || '',
        amount: option?.ratio || '',
        unit: option?.unit || '',
        section,
        prep: option?.prep || '',
        line_group: option?.line_group ?? entry.line_group ?? '',
        isChoice,
        choice_group: isChoice ? token : '',
        choice_label: isChoice ? choice.label || '' : '',
        option: option?.option || '',
        choice_default: Boolean(
          isChoice &&
          choice.default_option &&
          choice.default_option === option?.option
        ),
        depends_on: option?.depends_on || entry.depends_on || { token: '', option: '' },
        dietary: option?.dietary || null,
        is_substitution: isChoice && index > 0,
      });
    });
  });

  return items;
}

function editorStepsFromRecipe(recipe) {
  const saved = recipe?.editor_state?.steps;
  if (Array.isArray(saved) && saved.length) return saved;

  if (Array.isArray(recipe?.steps) && recipe.steps.length) {
    return recipe.steps.map((step) => ({
      text: step?.text || '',
      section: step?.section || '',
      variation_token: '',
      variation_option: '',
      variation_text: '',
    }));
  }

  return String(recipe?.steps_raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      text: line.replace(/^\d+\.\s*/, ''),
      section: '',
      variation_token: '',
      variation_option: '',
      variation_text: '',
    }));
}

function configureAdminEditUi() {
  document.body.classList.add('admin-edit-mode');
  document.title = 'Review pending recipe';

  const heading = document.getElementById('composer-site-title');
  if (heading) heading.textContent = 'Review recipe';

  const inboxLink = document.getElementById('admin-inbox-link');
  if (inboxLink) inboxLink.hidden = false;

  const banner = document.getElementById('admin-edit-banner');
  if (banner) banner.hidden = false;

  const submit = document.getElementById('submit-recipe');
  if (submit) {
    submit.textContent = 'Save pending recipe';
    submit.disabled = true;
  }

  const familyAuth = document.getElementById('family-auth-row');
  if (familyAuth) familyAuth.hidden = true;

  const draftStatus = document.getElementById('draft-status');
  if (draftStatus) {
    draftStatus.textContent = 'Pending inbox recipe · changes save only when you press Save';
  }
}

function hydrateAdminRecipe(recipe, item) {
  restoringDraft = true;

  document.getElementById('title').value = recipe.title || item.title || '';
  document.getElementById('slug').value = recipe.id || recipe.recipe_id || item.slug || '';
  document.getElementById('slug').dataset.userEdited = 'true';
  document.getElementById('servings-per-batch').value = recipe.servings_per_batch || '';
  document.getElementById('family').value = recipe.family || '';
  document.getElementById('byline').value = recipe.byline || '';
  document.getElementById('default-base').value = recipe.default_base || '1';
  document.getElementById('notes').value = recipe.notes || '';

  const categories = Array.isArray(recipe.categories) ? recipe.categories.filter(Boolean) : [];
  categories.forEach((category) => categorySet.add(category));
  pendingDraftCategories = categories;
  syncCategoryOptions();
  pendingDraftCategories = [];

  pendingDraftPan = recipe.default_pan || '';
  syncPanOptions();

  ingredientRowsEl.innerHTML = '';
  stepsListEl.innerHTML = '';
  unitSelects.clear();

  const ingredientItems = editorIngredientsFromRecipe(recipe);
  ingredientItems.forEach((entry) => {
    if (entry.kind === 'section') {
      createIngredientSection(entry.name || '');
    } else {
      createIngredientRow(entry);
    }
  });
  if (!ingredientRowsEl.querySelector('.ingredient-row')) createIngredientRow();

  const stepItems = editorStepsFromRecipe(recipe);
  stepItems.forEach((step) => {
    createStepRow(step.text || '', step.section || '', step);
  });
  if (!stepsListEl.querySelector('.step-row')) createStepRow();

  refreshStepIngredientPickers();
  refreshPreview();
  restoringDraft = false;

  const meta = document.getElementById('admin-edit-meta');
  if (meta) {
    const updated = item.updated_at ? new Date(item.updated_at) : null;
    const updatedText =
      updated && !Number.isNaN(updated.getTime())
        ? updated.toLocaleString()
        : '';
    meta.textContent = updatedText
      ? `Inbox #${item.id} · last updated ${updatedText}`
      : `Inbox #${item.id}`;
  }

  const submit = document.getElementById('submit-recipe');
  if (submit) submit.disabled = false;

  if (pageParams.get('review') === '1') {
    setReviewOpen(true);
  }
}

async function loadAdminEditRecipe() {
  configureAdminEditUi();

  const adminToken = getRememberedPassword('admin');
  if (!adminToken) {
    showStatus('Open this recipe from the Recipe inbox after signing in as admin.', 'error');
    return false;
  }

  try {
    showStatus('Loading pending recipe…', 'info');
    const payload = await adminExportPending({ adminToken });
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.pending)
        ? payload.pending
        : [];
    const item = items.find((entry) => Number(entry?.id) === adminEditId);

    if (!item) {
      showStatus('This pending recipe is no longer in the inbox.', 'error');
      return false;
    }

    const recipe = unwrapPendingRecipe(item);
    if (!recipe) {
      showStatus('This pending recipe does not contain editable recipe data.', 'error');
      return false;
    }

    adminEditUpdatedAt = item.updated_at || '';
    hydrateAdminRecipe(recipe, item);
    showStatus('Pending recipe loaded for review.', 'success');
    return true;
  } catch (err) {
    showStatus(err.message || 'Unable to load pending recipe', 'error');
    return false;
  }
}

function resetFormForNewEntry() {
  clearDraft();
  document.getElementById('recipe-form').reset();
  document.getElementById('slug').dataset.userEdited = 'false';
  ingredientRowsEl.innerHTML = '';
  stepsListEl.innerHTML = '';
  unitSelects.clear();
  if (categorySelectEl) {
    [...categorySelectEl.options].forEach((opt) => (opt.selected = false));
    updateCategorySummary();
  }
  pendingDraftPan = '';
  if (panSelectEl) panSelectEl.value = '';
  createIngredientRow();
  createStepRow();
  touchSlugFromTitle();
  refreshPreview();
}

async function handleSubmit(evt) {
  evt.preventDefault();
  try {
    const recipe = attachEditorState(buildRecipeFromForm({ strict: true }));

    if (isAdminEditMode) {
      const adminToken = getRememberedPassword('admin');
      if (!adminToken) {
        showStatus('Your admin session is missing. Return to the Recipe inbox and sign in again.', 'error');
        return;
      }

      showStatus('Saving pending recipe…', 'info');
      const result = await adminUpdatePending({
        adminToken,
        id: adminEditId,
        recipe,
        expectedUpdatedAt: adminEditUpdatedAt,
      });
      adminEditUpdatedAt = result?.item?.updated_at || adminEditUpdatedAt;
      showStatus('Saved. This recipe is still pending and ready for another review or GitHub publish.', 'success');

      const meta = document.getElementById('admin-edit-meta');
      if (meta && result?.item) {
        const updated = result.item.updated_at ? new Date(result.item.updated_at) : null;
        const updatedText =
          updated && !Number.isNaN(updated.getTime())
            ? updated.toLocaleString()
            : '';
        meta.textContent = updatedText
          ? `Inbox #${adminEditId} · last updated ${updatedText}`
          : `Inbox #${adminEditId}`;
      }
      return;
    }

    const password = promptFamilyPassword();
    if (!password) return;
    showStatus('Submitting recipe...', 'info');
    const result = await familySubmitRecipe({ familyPassword: password, recipe });
    showStatus(`Success: submitted with id ${result?.id || recipe.id}.`, 'success');
    clearDraft();
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
      showStatus(err.message || (isAdminEditMode ? 'Unable to save pending recipe' : 'Unable to submit'), 'error');
    }
  }
}

async function bootstrap() {
  const previewDetails = document.querySelector('details.mobile-preview');
  if (previewDetails && siteBehavior.isCompactViewport()) {
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
  document.getElementById('categories').addEventListener('change', () => {
    updateCategorySummary();
    refreshPreview();
  });
  document.getElementById('notes').addEventListener('input', refreshPreview);
  document.getElementById('family').addEventListener('input', refreshPreview);
  document.getElementById('byline').addEventListener('input', refreshPreview);
  document.getElementById('default-base').addEventListener('input', refreshPreview);
  document.getElementById('default-pan').addEventListener('change', refreshPreview);
  document.getElementById('servings-per-batch').addEventListener('input', () => {
    refreshPreview();
    saveDraftSoon();
  });
  document.getElementById('recipe-form').addEventListener('input', saveDraftSoon);
  document.getElementById('recipe-form').addEventListener('change', saveDraftSoon);

  loadUnitsFromConversions();
  syncCategoryOptions();
  const existingRecipesPromise = loadExistingRecipes();
  const ingredientAutocompletePromise = loadIngredientAutocomplete().catch((err) => {
    console.warn('Could not preload ingredient autocomplete', err);
  });
  const panPromise = loadPanOptions();

  document.getElementById('add-ingredient').addEventListener('click', () => {
    const row = createIngredientRow();
    row.querySelector('.ingredient-amount')?.focus();
    refreshStepIngredientPickers();
    saveDraftSoon();
  });
  document.getElementById('category-done').addEventListener('click', () => {
    const menu = document.getElementById('category-menu');
    if (menu) menu.open = false;
  });
  document.getElementById('add-step').addEventListener('click', () => {
    const step = createStepRow();
    step.querySelector('.step-text')?.focus();
    saveDraftSoon();
  });
  document.getElementById('review-recipe').addEventListener('click', () => {
    const panel = document.getElementById('review-panel');
    setReviewOpen(Boolean(panel?.hidden));
  });
  document.getElementById('close-review').addEventListener('click', () => setReviewOpen(false));
  document.getElementById('recipe-form').addEventListener('submit', handleSubmit);

  if (isAdminEditMode) {
    await Promise.all([ingredientAutocompletePromise, panPromise, existingRecipesPromise]);
    await loadAdminEditRecipe();
    return;
  }

  if (getRememberedPassword('family')) {
    document.getElementById('remember-family').checked = true;
  }

  await ingredientAutocompletePromise;
  await panPromise;

  const restored = restoreDraft();
  if (!restored) {
    createIngredientRow();
    createStepRow();
    refreshPreview();
  }
  void existingRecipesPromise;
}

bootstrap();
