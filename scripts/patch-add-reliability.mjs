import fs from 'node:fs';

const file = new URL('../docs/add.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Patch stopped safely: ${label} marker was not found.`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch stopped safely: ${label} marker was not unique.`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceRange(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Patch stopped safely: ${label} start marker was not found.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Patch stopped safely: ${label} end marker was not found.`);
  source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

replaceOnce(
  "let ingredientAutocompleteState = 'loading';\nlet categoryCatalogState = 'loading';",
  "let ingredientAutocompleteState = 'loading';\nlet categoryCatalogState = 'loading';\nlet panCatalogState = 'loading';",
  'catalog state'
);

replaceOnce(
  'let pendingDraftCategories = [];',
  `let pendingDraftCategories = [];

function currentCategoryValues() {
  const selected = categorySelectEl
    ? [...categorySelectEl.selectedOptions].map((opt) => opt.value)
    : [];
  return [...new Set([...pendingDraftCategories, ...selected].filter(Boolean))];
}

function currentPanValue() {
  return pendingDraftPan || panSelectEl?.value || '';
}`,
  'draft value helpers'
);

replaceRange(
  'function syncPanOptions({ failed = false } = {}) {',
  '\nasync function loadAuthoringOptions() {',
  `function syncPanRetryButton(failed) {
  if (!panSelectEl) return;
  let retry = document.getElementById('retry-pan-sizes');
  if (!failed) {
    retry?.remove();
    return;
  }
  if (retry) return;

  retry = document.createElement('button');
  retry.id = 'retry-pan-sizes';
  retry.type = 'button';
  retry.className = 'button secondary';
  retry.textContent = 'Retry pan sizes';
  retry.addEventListener('click', () => {
    void loadPanOptions();
  });
  panSelectEl.insertAdjacentElement('afterend', retry);
}

function syncPanOptions({ failed = false } = {}) {
  if (!panSelectEl) return;
  const current = currentPanValue();
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
  syncPanRetryButton(failed);

  if (!hasCatalog) {
    panSelectEl.value = '';
    if (current) pendingDraftPan = current;
    return;
  }

  if (!panSizeCatalog.some((pan) => pan.id === current)) {
    panSelectEl.value = '';
  }
  pendingDraftPan = '';
}

async function loadPanOptions() {
  if (!panSelectEl) return;
  panCatalogState = 'loading';
  syncPanRetryButton(false);
  panSelectEl.disabled = true;
  panSelectEl.setAttribute('aria-busy', 'true');

  try {
    const pans = await fetchBuiltJson('pan-sizes.json', { label: 'Pan sizes' });
    panSizeCatalog = Array.isArray(pans) ? pans.filter((pan) => pan?.id && pan?.label) : [];
    if (panSizeCatalog.length === 0) throw new Error('Pan catalog is empty');
    panCatalogState = 'ready';
    syncPanOptions();
  } catch (err) {
    console.warn('Could not load pan sizes', err);
    panCatalogState = 'failed';
    panSizeCatalog = [];
    syncPanOptions({ failed: true });
  }
}
`,
  'pan loading block'
);

replaceRange(
  'async function loadAuthoringOptions() {',
  '\nfunction ingredientChoices() {',
  `async function loadAuthoringOptions() {
  categoryCatalogState = 'loading';
  syncCategoryOptions();

  let loadedAny = false;
  let initialized = false;
  let authoringError = null;
  let indexError = null;

  const beginSuccessfulLoad = () => {
    if (!initialized) {
      categorySet.clear();
      sectionSet.clear();
      commonUnitByIngredient.clear();
      existingRecipeIds.clear();
      initialized = true;
    }
    loadedAny = true;
    categoryCatalogState = 'ready';
  };

  const publishAvailableOptions = () => {
    syncCategoryOptions();
    syncUnitSelects();
    updateSectionSuggestions();
    updateDependencySuggestions();
    touchSlugFromTitle();
  };

  const authoringTask = fetchBuiltJson('authoring-options.json', {
    label: 'Recipe authoring options',
  })
    .then((options) => {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('Recipe authoring options returned invalid data.');
      }
      beginSuccessfulLoad();
      (options.categories || []).forEach((category) => {
        if (category) categorySet.add(String(category));
      });
      (options.recipe_ids || []).forEach((recipeId) => {
        if (recipeId) existingRecipeIds.add(String(recipeId));
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
      publishAvailableOptions();
    })
    .catch((err) => {
      authoringError = err;
    });

  const indexTask = fetchBuiltJson('index.json', { label: 'Cookbook index' })
    .then((index) => {
      if (!Array.isArray(index)) throw new Error('Cookbook index returned invalid data.');
      beginSuccessfulLoad();
      index.forEach((recipe) => {
        if (recipe?.id) existingRecipeIds.add(String(recipe.id));
        (recipe?.categories || []).forEach((category) => {
          if (category) categorySet.add(String(category));
        });
      });
      publishAvailableOptions();
    })
    .catch((err) => {
      indexError = err;
    });

  await Promise.all([authoringTask, indexTask]);

  if (!loadedAny) {
    categoryCatalogState = 'failed';
    syncCategoryOptions();
    console.warn('Could not load recipe authoring options or cookbook index', authoringError, indexError);
    return;
  }

  categoryCatalogState = 'ready';
  publishAvailableOptions();
  pendingDraftCategories = [];

  if (authoringError) {
    console.warn(
      'Extended authoring helpers did not load; categories remain available from the cookbook index.',
      authoringError
    );
  }
  if (indexError) {
    console.warn('Cookbook index did not load; categories remain available from authoring options.', indexError);
  }
}
`,
  'authoring option loading block'
);

replaceOnce(
  `      status.textContent =
        ingredientAutocompleteState === 'failed'
          ? 'Ingredient lookup unavailable — refresh to retry'
          : 'Loading ingredients…';
      autocompleteMenu.appendChild(status);
      autocompleteMenu.hidden = false;
      nameInput.setAttribute('aria-expanded', 'true');
      return;`,
  `      const lookupFailed = ingredientAutocompleteState === 'failed';
      status.textContent = lookupFailed ? 'Ingredient lookup unavailable.' : 'Loading ingredients…';
      autocompleteMenu.appendChild(status);

      if (lookupFailed) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ingredient-autocomplete-option ingredient-autocomplete-retry';
        retry.textContent = 'Retry ingredient lookup';
        retry.addEventListener('mousedown', (event) => event.preventDefault());
        retry.addEventListener('click', () => {
          ingredientAutocompleteState = 'loading';
          renderAutocomplete();
          void loadIngredientAutocomplete()
            .then(renderAutocomplete)
            .catch((err) => {
              console.warn('Could not reload ingredient autocomplete', err);
              renderAutocomplete();
            });
        });
        autocompleteMenu.appendChild(retry);
      }

      autocompleteMenu.hidden = false;
      nameInput.setAttribute('aria-expanded', 'true');
      return;`,
  'ingredient retry block'
);

replaceOnce(
  `  const defaultPan = defaultPanInput?.value?.trim() || '';
  const categories = categoriesSelect ? [...categoriesSelect.selectedOptions].map((opt) => opt.value) : [];`,
  `  const defaultPan = defaultPanInput?.value?.trim() || currentPanValue();
  const categories = currentCategoryValues();`,
  'recipe form resilient catalog values'
);

replaceOnce(
  `    default_pan: document.getElementById('default-pan')?.value || '',
    notes: document.getElementById('notes')?.value || '',
    categories: categorySelectEl ? [...categorySelectEl.selectedOptions].map((opt) => opt.value) : [],`,
  `    default_pan: currentPanValue(),
    notes: document.getElementById('notes')?.value || '',
    categories: currentCategoryValues(),`,
  'draft resilient catalog values'
);

replaceOnce(
  `  document.getElementById('categories').addEventListener('change', () => {
    updateCategorySummary();
    refreshPreview();
  });`,
  `  document.getElementById('categories').addEventListener('change', () => {
    if (categoryCatalogState === 'ready') pendingDraftCategories = [];
    updateCategorySummary();
    refreshPreview();
  });`,
  'category edit authority'
);

replaceOnce(
  "  document.getElementById('default-pan').addEventListener('change', refreshPreview);",
  `  document.getElementById('default-pan').addEventListener('change', () => {
    pendingDraftPan = '';
    refreshPreview();
  });`,
  'pan edit authority'
);

if (panCatalogState === undefined) {
  throw new Error('Patch stopped safely: pan catalog state was not introduced.');
}

fs.writeFileSync(file, source);
console.log('Add Recipe loading and draft reliability patch applied.');
