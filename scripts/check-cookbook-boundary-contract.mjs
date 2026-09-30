import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const indexHtml = read('docs/index.html');
const app = read('docs/app.js');
const repository = read('docs/recipe-repository.js');
const siteBehavior = read('docs/site-behavior.js');
const recipe = read('docs/recipe.js');
const planner = read('docs/planner.js');

const violations = [];
const assert = (condition, message) => {
  if (!condition) violations.push(message);
};

assert(
  !/pull-inbox|remember-pull|Pull inbox/i.test(indexHtml),
  'the Cookbook page must not expose the retired pending-inbox pull/import UI'
);
assert(
  !/familyListPending|loadStoredInboxRecipes|storeInboxRecipes|normalizeRecipeListResult|cookingdb-inbox-recipes/.test(app),
  'the Cookbook runtime must not maintain a second local pending-recipe data source'
);
assert(
  !/inbox\/inbox-api\.js/.test(app),
  'the Cookbook runtime must not talk directly to the pending inbox service'
);
assert(
  !/localStorage|INBOX_STORAGE_KEY|includeInbox|loadStoredInboxRecipes|storeInboxRecipes/.test(repository),
  'the recipe repository must not mix unpublished/local inbox state into the published recipe collection'
);
assert(
  repository.includes("fetchBuiltJson('recipes.json'") &&
    repository.includes('const recipes = await loadBuiltRecipes({ label });'),
  'the full recipe collection must come from the generated published recipe box'
);
assert(
  recipe.includes("loadRecipeCollection({ label: 'Recipe box' })"),
  'recipe pages must consume the published recipe collection'
);
assert(
  planner.includes("loadRecipeCollection({ label: 'Meal prep recipes' })"),
  'Meal Prep must consume the same published recipe collection'
);
assert(
  siteBehavior.includes("inbox.id = 'admin-inbox-link'") &&
    siteBehavior.includes("inbox.href = 'admin.html'") &&
    siteBehavior.includes("inbox.textContent = 'Recipe inbox'"),
  'pending recipe access must remain an explicit admin destination under the shared gear menu'
);

if (violations.length) {
  console.error('Cookbook boundary contract failed:\n');
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error(
    '\nPublished recipes belong in the Cookbook. Pending recipes belong in the Recipe inbox/admin workflow. ' +
      'Do not restore a hidden or local-storage-backed alternate cookbook.'
  );
  process.exit(1);
}

console.log(
  'Cookbook boundary contract OK: published generated data is the sole cookbook/recipe/planner source and pending recipes remain in the admin inbox workflow.'
);
