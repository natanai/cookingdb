import {
  familySubmitRecipe,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';
import {
  DIETARY_TAGS,
  renderIngredientLines,
  renderStepLines,
  recipeDefaultCompatibility,
} from './recipe-utils.js';

const ingredientRowsEl = document.getElementById('ingredient-rows');
const stepsListEl = document.getElementById('steps-list');
const ingredientSuggestionsEl = document.getElementById('ingredient-suggestions');
const categorySuggestionsEl = document.getElementById('category-suggestions');
// Remove required attribute from slug input as it's auto-generated
const slugInputField = document.getElementById('slug');
if (slugInputField) slugInputField.removeAttribute('required');

const statusEl = document.getElementById('form-status');

const ingredientNameSet = new Set();
const categorySet = new Set();

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

function addOptionToDatalist(datalistEl, value) {
  if (!value || datalistEl.querySelector(`option[value="${value}"]`)) return;
  const opt = document.createElement('option');
  opt.value = value;
  datalistEl.appendChild(opt);
}

function updateSuggestions() {
  ingredientSuggestionsEl.innerHTML = '';
  ingredientNameSet.forEach((name) => addOptionToDatalist(ingredientSuggestionsEl, name));
  categorySuggestionsEl.innerHTML = '';
  categorySet.forEach((cat) => addOptionToDatalist(categorySuggestionsEl, cat));
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
          });
        });
      });
      updateSuggestions();
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
    { key: 'gluten_free', label: 'GF' },
    { key: 'egg_free', label: 'Egg-free' },
    { key: 'dairy_free', label: 'Dairy-free' },
  ];
  options.forEach((opt) => {
    const label = document.createElement('label');
    label.className = 'pill-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.dietaryKey = opt.key;
    label.appendChild(input);
    label.append(` ${opt.label}`);
    wrapper.appendChild(label);
  });
  return wrapper;
}

function createIngredientRow(defaults = {}) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <label class="ingredient-cell">
      <span class="cell-label">Name</span>
      <input class="ingredient-name" list="ingredient-suggestions" placeholder="Ingredient name" aria-label="Ingredient name" />
    </label>
    <label class="ingredient-cell">
      <span class="cell-label">Amount</span>
      <input class="ingredient-amount" placeholder="1 1/2" aria-label="Amount" />
    </label>
    <label class="ingredient-cell">
      <span class="cell-label">Unit</span>
      <input class="ingredient-unit" placeholder="cup" aria-label="Unit" />
    </label>
    <label class="ingredient-cell">
      <span class="cell-label">Alternative</span>
      <input class="ingredient-alt" placeholder="Alternative/substitution" aria-label="Alternative or substitution" />
    </label>
    <div class="ingredient-cell">
      <span class="cell-label">Dietary flags</span>
      <div class="dietary-slot"></div>
    </div>
    <div class="ingredient-cell remove-cell">
      <span class="cell-label">Remove</span>
      <button type="button" class="link-button remove-ingredient" aria-label="Remove ingredient">Remove</button>
    </div>
  `;
  row.querySelector('.dietary-slot').replaceWith(buildDietaryCheckboxes());
  const nameInput = row.querySelector('.ingredient-name');
  const amountInput = row.querySelector('.ingredient-amount');
  const unitInput = row.querySelector('.ingredient-unit');
  const altInput = row.querySelector('.ingredient-alt');

  nameInput.value = defaults.name || '';
  amountInput.value = defaults.amount || '';
  unitInput.value = defaults.unit || '';
  altInput.value = defaults.alt || '';

  row.addEventListener('input', () => {
    ingredientChoices().forEach(({ name }) => ingredientNameSet.add(name));
    updateSuggestions();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  row.querySelector('.remove-ingredient').addEventListener('click', () => {
    row.remove();
    refreshStepIngredientPickers();
    refreshPreview();
  });

  ingredientRowsEl.appendChild(row);
}

function createStepRow(defaultText = '') {
  const li = document.createElement('li');
  li.className = 'step-row';
  li.innerHTML = `
    <label>Instruction
      <textarea class="step-text" rows="3" placeholder="Describe the action and include ingredients"></textarea>
    </label>
    <div class="step-ingredients" aria-label="Ingredients used in this step"></div>
    <button type="button" class="link-button remove-step">Remove step</button>
  `;
  li.querySelector('.step-text').value = defaultText;
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

function buildIngredientsFromForm() {
  const tokenOrder = [];
  const ingredientList = [];
  const ingredientRows = [...ingredientRowsEl.querySelectorAll('.ingredient-row')];

  ingredientRows.forEach((row) => {
    const name = row.querySelector('.ingredient-name').value.trim();
    const amount = row.querySelector('.ingredient-amount').value.trim();
    const unit = row.querySelector('.ingredient-unit').value.trim();
    const alt = row.querySelector('.ingredient-alt').value.trim();
    if (!name) return;
    const token = slugify(name);
    if (!tokenOrder.includes(token)) tokenOrder.push(token);
    const dietary = readDietaryFlags(row);
    const optionDisplay = alt ? `${name} (${alt})` : name;
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
        },
      ],
      isChoice: false,
    });
  });

  return { ingredientList, tokenOrder };
}

function buildRecipeFromForm({ strict = true } = {}) {
  const title = document.getElementById('title').value.trim();
  const slug = document.getElementById('slug').value.trim();
  const notes = document.getElementById('notes').value.trim();
  const categoriesRaw = document.getElementById('categories').value.trim();
  const defaultBase = Number(document.getElementById('default-base').value) || 1;
  const categories = categoriesRaw
    ? categoriesRaw
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  if (strict && !title) throw new Error('Please add a recipe title.');
  if (strict && !slug) throw new Error('Please set a recipe ID.');

  const { ingredientList, tokenOrder } = buildIngredientsFromForm();

  if (strict && tokenOrder.length === 0) {
    throw new Error('Add at least one ingredient.');
  }

  const stepsRawLines = [];
  const tokenUsage = [];
  const stepRows = [...stepsListEl.querySelectorAll('.step-row')];
  stepRows.forEach((row, index) => {
    const text = row.querySelector('.step-text').value.trim();
    const selectedTokens = [...row.querySelectorAll('.step-ingredients input:checked')].map((cb) => cb.value);
    if (strict && !text) throw new Error(`Step ${index + 1} needs instructions.`);
    if (strict && selectedTokens.length === 0) throw new Error(`Select ingredients for step ${index + 1}.`);
    let stepText = text;
    selectedTokens.forEach((token) => {
      const tokenPattern = new RegExp(`{{\\s*${token}\\s*}}`);
      if (!tokenPattern.test(stepText)) {
        stepText = `${stepText} {{${token}}}`.trim();
      }
    });
    const numbered = `${index + 1}. ${stepText}`;
    stepsRawLines.push(numbered);
    const regex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
    let match;
    while ((match = regex.exec(stepText)) !== null) {
      tokenUsage.push(match[1]);
    }
  });

  if (strict && stepsRawLines.length === 0) {
    throw new Error('Add at least one step.');
  }

  const compatibility = { gluten_free: true, egg_free: true, dairy_free: true };
  ingredientList.forEach((tokenData) => {
    tokenData.options.forEach((opt) => {
      ['gluten_free', 'egg_free', 'dairy_free'].forEach((key) => {
        if (opt.dietary && opt.dietary[key] === false) {
          compatibility[key] = false;
        }
      });
    });
  });

  return {
    id: slug,
    title,
    base_kind: 'multiplier',
    default_base: defaultBase,
    categories,
    notes,
    steps_raw: stepsRawLines.join('\n'),
    tokens_used: tokenUsage,
    token_order: tokenOrder,
    ingredients: ingredientList,
    choices: {},
    pan_sizes: [],
    default_pan: null,
    compatibility_possible: compatibility,
  };
}

function buildPreviewRecipe() {
  const recipe = buildRecipeFromForm({ strict: false });
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
  ingredientLines.forEach((line) => {
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

  stepsEl.innerHTML = '';
  const steps = renderStepLines(recipe, state);
  steps.forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    stepsEl.appendChild(li);
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
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function resetFormForNewEntry() {
  document.getElementById('recipe-form').reset();
  document.getElementById('slug').dataset.userEdited = 'false';
  ingredientRowsEl.innerHTML = '';
  stepsListEl.innerHTML = '';
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
    showStatus(err.message || 'Unable to submit', 'error');
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
  document.getElementById('categories').addEventListener('input', refreshPreview);
  document.getElementById('notes').addEventListener('input', refreshPreview);
  document.getElementById('default-base').addEventListener('input', refreshPreview);

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
