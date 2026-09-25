import fs from 'node:fs';

const html = fs.readFileSync(new URL('../docs/add.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/add.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('./build.mjs', import.meta.url), 'utf8');

const checks = [
  ['recipe title input', html.includes('id="title"')],
  ['servings/yield input', html.includes('id="servings-per-batch"')],
  ['category multiselect', html.includes('id="categories"') && html.includes('id="category-menu"')],
  ['family/source metadata', html.includes('id="family"')],
  ['byline metadata', html.includes('id="byline"')],
  ['notes metadata', html.includes('id="notes"')],
  ['batch multiplier metadata', html.includes('id="default-base"')],
  ['pan scaling metadata', html.includes('id="default-pan"')],
  ['pan selector gated until catalog is ready', html.includes('id="default-pan" name="default-pan" disabled aria-busy="true"') && html.includes('Loading pan sizes…')],
  ['pan catalog uses shared fresh-data loader', js.includes("fetchBuiltJson('pan-sizes.json'")],
  ['normal authoring renders before helper catalogs settle', js.includes('const restored = restoreDraft();') && js.includes('void Promise.allSettled([') && js.indexOf('const restored = restoreDraft();') < js.indexOf('void Promise.allSettled([', js.indexOf('const restored = restoreDraft();'))],
  ['pan catalog failure is explicit and retryable', js.includes("'Pan sizes unavailable'") && js.includes('Retry pan sizes') && js.includes("id = 'retry-pan-sizes'")],
  ['saved pan survives catalog failure', js.includes('function currentPanValue()') && js.includes('if (current) pendingDraftPan = current') && js.includes('default_pan: currentPanValue()')],
  ['ingredient sections', js.includes('createIngredientSection') && js.includes('start-section-here')],
  ['single contextual section creation flow', !html.includes('id="add-ingredient-section"') && js.includes('start-section-here')],
  ['prebuilt ingredient autocomplete index', build.includes("'ingredient-autocomplete.json'") && build.includes('ingredientAutocompleteMap')],
  ['compact authoring options index', build.includes("'authoring-options.json'") && build.includes('common_units_by_ingredient') && js.includes("fetchBuiltJson('authoring-options.json'") && !js.includes("fetchBuiltJson('recipes.json'")],
  ['content-versioned generated data', build.includes("'version.js'") && build.includes("createHash('sha256')")],
  ['ingredient autocomplete starts without blocking editing', js.includes("loadIngredientAutocomplete()") && js.includes('const ingredientAutocompletePromise') && js.includes('const restored = restoreDraft();')],
  ['ingredient lookup failure is explicit and retryable', js.includes("ingredientAutocompleteState !== 'ready'") && js.includes('Ingredient lookup unavailable.') && js.includes('Retry ingredient lookup')],
  ['categories have explicit readiness and retry state', html.includes('Loading categories…') && js.includes("categoryCatalogState === 'failed'") && js.includes('Categories could not load.') && js.includes('Retry categories')],
  ['categories become usable after either source succeeds', js.includes('beginSuccessfulLoad') && js.includes('publishAvailableOptions') && js.includes("categoryCatalogState = 'ready'") && js.includes('authoringTask') && js.includes('indexTask')],
  ['categories fall back to cookbook index', js.includes("fetchBuiltJson('index.json'") && js.includes('categories remain available from the cookbook index')],
  ['saved categories survive catalog loading', js.includes('function currentCategoryValues()') && js.includes('categories: currentCategoryValues()') && js.includes('pendingDraftCategories = []')],
  ['custom ingredient dropdown replaces native datalist', js.includes('ingredient-autocomplete-menu') && !html.includes('id="ingredient-suggestions"')],
  ['ingredient typing avoids recipe-wide input handler', !js.includes("row.addEventListener('input', handleChange)")],
  ['compact unit placeholder', js.includes("placeholder.textContent = 'Unit'")],
  ['ingredient prep metadata', js.includes('ingredient-prep') && js.includes('prep,')],
  ['ingredient line grouping', js.includes('ingredient-inline-group') && js.includes('line_group')],
  ['ingredient conditional dependencies', js.includes('ingredient-conditional-toggle') && js.includes('depends_on')],
  ['ingredient substitutions/choices', js.includes('ingredient-choice-toggle') && js.includes('choices')],
  ['choice defaults', js.includes('ingredient-default-choice') && js.includes('default_option')],
  ['step sections', js.includes('step-section') && js.includes('step_sections')],
  ['conditional step variations', js.includes('variation-token') && js.includes('{{#if')],
  ['structured ingredient references in steps', js.includes('{{${token}}}')],
  ['pan catalog published to Pages', build.includes("'pan-sizes.json'") && build.includes('JSON.stringify(panList')],
  ['byline emitted in inbox payload', js.includes('byline,')],
  ['default pan emitted in inbox payload', js.includes('default_pan: defaultPan || null')],
  ['pan sizes emitted in inbox payload', js.includes('pan_sizes: defaultPan')],
  ['new ingredients visibly require catalog review', js.includes('catalog review is required before publishing') && js.includes('catalog_review_required')],
  ['dietary authority comes from canonical ingredient data', !js.includes('Dietary compatibility') && js.includes('dietaryFlagsForIngredientId')],
  ['autocomplete supports listbox keyboard navigation', js.includes("event.key === 'ArrowDown'") && js.includes('aria-activedescendant') && js.includes("setAttribute('aria-selected'")],
  ['conditional references are validated', js.includes('validateDependencyReference') && js.includes('does not exist') && js.includes('is not a substitution group')],
  ['published recipe ids are auto-deconflicted', js.includes('uniqueRecipeSlug') && js.includes('existingRecipeIds')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Add Recipe authoring contract failed:');
  failed.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`Add Recipe authoring contract passed (${checks.length} capabilities checked).`);
