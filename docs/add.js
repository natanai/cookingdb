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

const ingredientRowsEl = document.getElementById('ingredient-rows');
const stepsListEl = document.getElementById('steps-list');
const ingredientSuggestionsEl = document.getElementById('ingredient-suggestions');
const categorySelectEl = document.getElementById('categories');
// Remove required attribute from slug input as it's auto-generated
const slugInputField = document.getElementById('slug');
if (slugInputField) slugInputField.removeAttribute('required');

const statusEl = document.getElementById('form-status');

const ingredientNameSet = new Set();
const categorySet = new Set();
const unitSet = new Set();
const unitSelects = new Set();

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
          tokenData.options.forEach((opt) => {
            if (opt.display) ingredientNameSet.add(opt.display);
            if (opt.unit) unitSet.add(opt.unit);
          });
        });
      });
      syncCategoryOptions();
      syncUnitSelects();
      updateIngredientSuggestions();
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

function createIngredientRow(defaults = {}) {
  const row = document.createElement('tr');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Name</span>
        <input class="ingredient-name" list="ingredient-suggestions" placeholder="Ingredient name" aria-label="Ingredient name" />
      </label>
    </td>
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Section (optional)</span>
        <input class="ingredient-section" placeholder="e.g., Chicken" aria-label="Ingredient section" />
      </label>
    </td>
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Amount</span>
        <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
      </label>
    </td>
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Unit</span>
        <select class="ingredient-unit" aria-label="Unit"></select>
      </label>
    </td>
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Alternative</span>
        <input class="ingredient-alt" placeholder="Alternative/substitution" aria-label="Alternative or substitution" />
      </label>
    </td>
    <td>
      <div class="ingredient-cell conditional-cell">
        <span class="cell-label">Show when</span>
        <div class="conditional-inputs">
          <input class="ingredient-dep-token" placeholder="Token" aria-label="Dependency token" />
          <input class="ingredient-dep-option" placeholder="Option" aria-label="Dependency option" />
        </div>
      </div>
    </td>
    <td>
      <label class="ingredient-cell">
        <span class="cell-label">Inline group</span>
        <input class="ingredient-group" placeholder="Group key" aria-label="Inline group key" />
      </label>
    </td>
    <td>
      <div class="ingredient-cell">
        <span class="cell-label">Dietary flags</span>
        <div class="dietary-slot"></div>
      </div>
    </td>
    <td class="remove-cell">
      <span class="cell-label">Remove</span>
      <button type="button" class="link-button remove-ingredient" aria-label="Remove ingredient">Remove</button>
    </td>
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

  nameInput.value = defaults.name || '';
  sectionInput.value = defaults.section || '';
  amountInput.value = defaults.amount || '';
  syncUnitSelect(unitInput, defaults.unit || '');
  unitSelects.add(unitInput);
  altInput.value = defaults.alt || '';
  depTokenInput.value = defaults.depends_on?.token || '';
  depOptionInput.value = defaults.depends_on?.option || '';
  groupInput.value = defaults.line_group || '';

  const handleChange = () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateIngredientSuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  };

  row.addEventListener('input', handleChange);
  row.addEventListener('change', handleChange);

  row.querySelector('.remove-ingredient').addEventListener('click', () => {
    unitSelects.delete(unitInput);
    row.remove();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  ingredientRowsEl.appendChild(row);
}

function createStepRow(defaultText = '', defaultSection = '') {
  const li = document.createElement('li');
  li.className = 'step-row';
  li.innerHTML = `
    <label>Instruction
      <textarea class="step-text" rows="3" placeholder="Describe the action and include ingredients"></textarea>
    </label>
    <label>Section (optional)
      <input class="step-section" placeholder="e.g., Prep Work" />
    </label>
    <div class="step-ingredients" aria-label="Ingredients used in this step"></div>
    <details class="step-variation">
      <summary>Add conditional variation (optional)</summary>
      <div class="variation-grid">
        <label>Show when ingredient is set to
          <div class="conditional-inputs">
            <input class="variation-token" placeholder="Token" aria-label="Variation token" />
            <input class="variation-option" placeholder="Option" aria-label="Variation option" />
          </div>
        </label>
        <label>Variation text (only shown when matched)
          <textarea class="variation-text" rows="2" placeholder="Extra instruction when a specific option is chosen"></textarea>
        </label>
      </div>
    </details>
    <button type="button" class="link-button remove-step">Remove step</button>
  `;
  li.querySelector('.step-text').value = defaultText;
  li.querySelector('.step-section').value = defaultSection;
  li.addEventListener('input', refreshPreview);
  li.querySelector('.remove-step').addEventListener('click', () => {
    li.remove();
    refreshPreview();
  });
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

function buildIngredientsFromForm(issues) {
  const tokenOrder = [];
  const ingredientList = [];
  const ingredientRows = [...ingredientRowsEl.querySelectorAll('.ingredient-row')];

  ingredientRows.forEach((row, idx) => {
    const nameInput = row.querySelector('.ingredient-name');
    const sectionInput = row.querySelector('.ingredient-section');
    const amountInput = row.querySelector('.ingredient-amount');
    const unitInput = row.querySelector('.ingredient-unit');
    const altInput = row.querySelector('.ingredient-alt');
    const depTokenInput = row.querySelector('.ingredient-dep-token');
    const depOptionInput = row.querySelector('.ingredient-dep-option');
    const groupInput = row.querySelector('.ingredient-group');

    const name = nameInput.value.trim();
    const section = sectionInput.value.trim();
    const amount = amountInput.value.trim();
    const unit = unitInput.value.trim();
    const alt = altInput.value.trim();
    const depToken = depTokenInput.value.trim();
    const depOption = depOptionInput.value.trim();
    const lineGroup = groupInput.value.trim();

    const allEmpty = !name && !amount && !unit && !alt;
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

    const token = slugify(name);
    if (!tokenOrder.includes(token)) tokenOrder.push(token);
    const dietary = readDietaryFlags(row);
    const optionDisplay = alt ? `${name} (${alt})` : name;
    const depends_on = depToken ? { token: slugify(depToken), option: depOption ? slugify(depOption) : null } : null;
    ingredientList.push({
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
          line_group: lineGroup || null,
          section: section || null,
        },
      ],
      isChoice: false,
      depends_on,
      line_group: lineGroup || null,
      section: section || null,
    });
  });

  if (ingredientList.length === 0) {
    issues.push('Add at least one ingredient with a name, amount, and unit.');
  }

  return { ingredientList, tokenOrder };
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

  const { ingredientList, tokenOrder } = buildIngredientsFromForm(issues);

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
    choices: {},
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

function renderPreview(recipe) {
  const titleEl = document.getElementById('preview-title');
  const notesEl = document.getElementById('preview-notes');
  const categoriesEl = document.getElementById('preview-categories');
  const metadataEl = document.getElementById('preview-metadata');
  const ingredientsEl = document.getElementById('preview-ingredients');
  const stepsEl = document.getElementById('preview-steps');

  titleEl.textContent = recipe.title || 'Recipe title';
  notesEl.textContent = recipe.notes || 'Notes will appear here.';

  categoriesEl.innerHTML = '';
  (recipe.categories || []).forEach((cat) => {
    const chip = document.createElement('span');
    chip.className = 'category-chip';
    chip.textContent = cat;
    categoriesEl.appendChild(chip);
  });

  metadataEl.innerHTML = '';
  metadataEl.appendChild(
    (() => {
      const pill = document.createElement('span');
      pill.className = 'pill neutral';
      pill.textContent = `Batch ×${recipe.default_base || 1}`;
      return pill;
    })()
  );
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.gluten_free, recipe.compatibility_possible.gluten_free));
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.egg_free, recipe.compatibility_possible.egg_free));
  metadataEl.appendChild(createMetadataPill(DIETARY_TAGS.dairy_free, recipe.compatibility_possible.dairy_free));

  ingredientsEl.innerHTML = '';
  const state = {
    multiplier: recipe.default_base || 1,
    panMultiplier: 1,
    selectedOptions: {},
    restrictions: recipe.compatibility_possible || { gluten_free: true, egg_free: true, dairy_free: true },
  };
  const ingredientLines = renderIngredientLines(recipe, state);
  const ingredientSections = groupLinesBySection(ingredientLines, recipe.ingredient_sections || []);
  ingredientSections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      ingredientsEl.appendChild(header);
    }

    section.lines.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line.text;
      if (line.alternatives.length) {
        const span = document.createElement('span');
        span.className = 'ingredient-alternatives';
        span.textContent = ` (or ${line.alternatives.join(' / ')})`;
        li.appendChild(span);
      }
      ingredientsEl.appendChild(li);
    });
  });

  stepsEl.innerHTML = '';
  const steps = renderStepLines(recipe, state);
  const stepSections = groupLinesBySection(steps, recipe.step_sections || []);
  stepSections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      stepsEl.appendChild(header);
    }
    section.lines.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line.text;
      stepsEl.appendChild(li);
    });
  });
}

function createMetadataPill(labels, value) {
  const pill = document.createElement('span');
  pill.className = value ? 'pill' : 'pill neutral';
  pill.textContent = value ? labels.positive : labels.negative;
  return pill;
}

function refreshPreview() {
  try {
    const recipe = buildPreviewRecipe();
    recipe.compatibility_possible = recipe.compatibility_possible || recipeDefaultCompatibility(recipe);
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
