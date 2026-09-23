import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const docs = path.join(root, 'docs');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Architecture contract: ${message}`);
}

assert(fs.existsSync(path.join(docs, 'architecture.md')), 'docs/architecture.md must describe the real application architecture');
assert(fs.existsSync(path.join(docs, 'recipe-model.js')), 'shared recipe-model.js must own cross-page recipe normalization/presentation semantics');
assert(fs.existsSync(path.join(docs, 'recipe-repository.js')), 'shared recipe-repository.js must own browser recipe loading and pending-recipe storage');
assert(fs.existsSync(path.join(root, 'cloudflare', 'worker.js')), 'cloudflare/worker.js must remain the canonical inbox worker');
assert(!fs.existsSync(path.join(root, 'inbox-worker.js')), 'the obsolete duplicate root inbox-worker.js must not return');

const recipeModel = read('docs/recipe-model.js');
for (const exportedConcept of [
  'normalizeTitleKey',
  'splitRecipeTitle',
  'getRecipeTitleParts',
  'normalizeIngredients',
  'recipeHasDetails',
  'unwrapRecipeEntry',
  'normalizeRecipeEntry',
]) {
  assert(
    recipeModel.includes(`export function ${exportedConcept}`),
    `recipe-model.js must own ${exportedConcept}`
  );
}

const recipeRepository = read('docs/recipe-repository.js');
for (const exportedConcept of [
  'normalizeRecipeListResult',
  'loadStoredInboxRecipes',
  'storeInboxRecipes',
  'buildRecipeIndex',
  'loadRecipeSummaries',
  'loadBuiltRecipes',
  'loadRecipeCollection',
]) {
  assert(
    recipeRepository.includes(`export function ${exportedConcept}`) ||
      recipeRepository.includes(`export async function ${exportedConcept}`),
    `recipe-repository.js must own ${exportedConcept}`
  );
}

for (const page of ['docs/app.js', 'docs/bread-maker.js', 'docs/planner.js', 'docs/recipe.js']) {
  const source = read(page);
  assert(source.includes("from './recipe-model.js'"), `${page} must consume the shared recipe model`);
  assert(source.includes("from './recipe-repository.js'"), `${page} must consume the shared recipe repository`);
  assert(!source.includes('function splitRecipeTitle('), `${page} must not redefine splitRecipeTitle`);
  assert(!source.includes('function getRecipeTitleParts('), `${page} must not redefine getRecipeTitleParts`);
}

for (const page of ['docs/app.js', 'docs/planner.js', 'docs/recipe.js']) {
  const source = read(page);
  assert(!source.includes("const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes'"), `${page} must not own the inbox storage key`);
  assert(!source.includes('function loadStoredInboxRecipes('), `${page} must not redefine pending-recipe storage loading`);
}

for (const page of ['docs/planner.js', 'docs/recipe.js']) {
  const source = read(page);
  assert(!source.includes("fetchBuiltJson('recipes.json'"), `${page} must load recipe data through recipe-repository.js`);
  assert(!source.includes('function normalizeRecipeFor'), `${page} must not redefine browser recipe normalization`);
}

for (const page of ['docs/app.js', 'docs/bread-maker.js']) {
  const source = read(page);
  assert(!source.includes("fetchBuiltJson('index.json'"), `${page} must load cookbook summaries through recipe-repository.js`);
  assert(source.includes('loadRecipeSummaries'), `${page} must use the shared summary repository`);
}

const workerReadme = read('cloudflare/README.md');
assert(
  workerReadme.includes('worker.js'),
  'Cloudflare documentation must continue to identify the canonical worker implementation'
);

console.log('Architecture consolidation contract passed.');
