import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const docs = path.join(root, 'docs');

function read(name) {
  return fs.readFileSync(path.join(docs, name), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Data loading contract: ${message}`);
  }
}

const builtData = read('built-data.js');
const recipeRepository = read('recipe-repository.js');
const app = read('app.js');
const add = read('add.js');
const addHtml = read('add.html');
const planner = read('planner.js');
const plannerHtml = read('planner.html');
const recipe = read('recipe.js');
const recipeHtml = read('recipe.html');
const bread = read('bread-maker.js');
const breadHtml = read('bread-maker.html');
const nutrition = read('nutrition-engine.js');

assert(
  builtData.includes("from './built/version.js'") &&
    builtData.includes("requestBuiltJson(url, resourceLabel, 'default')") &&
    builtData.includes("requestBuiltJson(url, resourceLabel, 'reload')") &&
    builtData.includes('builtDataUrl') &&
    builtData.includes("credentials: 'same-origin'"),
  'the shared built-data loader must use versioned reusable caching with a network retry'
);

for (const [name, source] of [
  ['app.js', app],
  ['add.js', add],
  ['nutrition-engine.js', nutrition],
  ['recipe-repository.js', recipeRepository],
]) {
  assert(
    source.includes("from './built-data.js'"),
    `${name} must use the shared built-data loader`
  );
  assert(
    !/fetch\(\s*['"]\.\/built\//.test(source),
    `${name} must not directly fetch generated built JSON`
  );
}

assert(
  recipeRepository.includes("fetchBuiltJson('recipes.json'") &&
    recipeRepository.includes('loadRecipeCollection'),
  'the recipe repository must own full recipe-box loading'
);
assert(
  recipeRepository.includes("fetchBuiltJson('index.json'") &&
    recipeRepository.includes('loadRecipeSummaries'),
  'the recipe repository must own cookbook-summary loading'
);
for (const [name, source] of [
  ['planner.js', planner],
  ['recipe.js', recipe],
]) {
  assert(
    source.includes("from './recipe-repository.js'"),
    `${name} must load recipes through the recipe repository`
  );
  assert(
    !source.includes("fetchBuiltJson('recipes.json'"),
    `${name} must not bypass the recipe repository for recipes.json`
  );
}
for (const [name, source] of [
  ['app.js', app],
  ['bread-maker.js', bread],
]) {
  assert(
    source.includes("from './recipe-repository.js'"),
    `${name} must load cookbook summaries through the recipe repository`
  );
  assert(
    !source.includes("fetchBuiltJson('index.json'"),
    `${name} must not bypass the recipe repository for index.json`
  );
}

assert(
  addHtml.includes('Loading categories…') &&
    addHtml.includes('id="categories"') &&
    addHtml.includes('disabled'),
  'Add Recipe must begin with an explicit category-loading state'
);
assert(
  add.includes("categoryCatalogState === 'failed'") &&
    add.includes('Categories could not load.') &&
    add.includes('Retry categories'),
  'Add Recipe must distinguish category failure from an empty category list'
);
assert(
  add.includes("ingredientAutocompleteState !== 'ready'") &&
    add.includes('Ingredient lookup unavailable.') &&
    add.includes('Retry ingredient lookup') &&
    add.includes('Ingredient lookup could not load. Refresh the page before submitting this recipe.'),
  'ingredient lookup failure must stay explicit and block uncatalogued submission while remaining retryable in place'
);
assert(
  add.includes("fetchBuiltJson('pan-sizes.json'") &&
    add.includes("fetchBuiltJson('ingredient-autocomplete.json'") &&
    add.includes("fetchBuiltJson('authoring-options.json'") &&
    add.includes("fetchBuiltJson('index.json'") &&
    add.includes('Promise.allSettled([') &&
    !add.includes("fetchBuiltJson('recipes.json'"),
  'Add Recipe must use compact authoring data with the cookbook index as an independent category fallback'
);

assert(
  planner.includes("loadRecipeCollection({ label: 'Meal prep recipes' })"),
  'meal prep must obtain its recipe box through the shared repository'
);
assert(
  planner.includes('startPlanner().catch(showPlannerLoadError)') &&
    plannerHtml.includes('Loading recipes…'),
  'meal prep must expose loading and failure states'
);

assert(
  bread.includes("loadRecipeSummaries({ label: 'Bread maker recipes' })") &&
    bread.includes('Bread maker recipes could not load. Refresh the page to retry.') &&
    breadHtml.includes('Loading bread maker recipes…'),
  'Bread Maker must expose loading and failure states while using the shared summary repository'
);

assert(
  nutrition.includes('export function dataLoadState') &&
    nutrition.includes("'failed', 'ingredient portion estimates'") &&
    nutrition.includes("'failed', 'ingredient unit conversions'"),
  'supporting conversion data must preserve failure state'
);
assert(
  recipe.includes('Kitchen count estimates and some unit conversions could not load.') &&
    recipeHtml.includes('id="recipe-data-warning"'),
  'recipe pages must surface unavailable kitchen conversion data'
);
assert(
  planner.includes('Kitchen count estimates and some unit conversions could not load.'),
  'meal prep must surface unavailable kitchen conversion data'
);

console.log('Data loading contract passed.');
