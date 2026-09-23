import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Refactor phase 2: expected ${label}`);
  return next;
}

function migrateRecipePage() {
  const file = 'docs/recipe.js';
  let source = read(file);
  if (source.includes("from './recipe-repository.js'")) return;

  source = replaceOnce(
    source,
    "import { fetchBuiltJson } from './built-data.js';\n",
    '',
    'recipe built-data import'
  );
  source = replaceOnce(
    source,
    '  DIETARY_TAGS,\n',
    '',
    'unused recipe DIETARY_TAGS import'
  );

  const importAnchor = "} from './recipe-utils.js';\n";
  const sharedImports = `${importAnchor}import {\n  DIETARY_BADGES,\n  formatKcal,\n  formatNumber,\n  getRecipeTitleParts,\n  recipeHasDetails,\n} from './recipe-model.js';\nimport { loadRecipeCollection } from './recipe-repository.js';\n`;
  source = replaceOnce(source, importAnchor, sharedImports, 'recipe shared model imports');

  source = replaceOnce(
    source,
    /const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';[\s\S]*?async function loadRecipes\(\) \{[\s\S]*?\n\}\n\n(?=function getRecipeIdFromQuery)/,
    "async function loadRecipes() {\n  return loadRecipeCollection({ label: 'Recipe box' });\n}\n\n",
    'recipe duplicate normalization/repository block'
  );

  write(file, source);
}

function migratePlannerPage() {
  const file = 'docs/planner.js';
  let source = read(file);
  if (source.includes("from './recipe-repository.js'")) return;

  source = replaceOnce(
    source,
    "import { fetchBuiltJson } from './built-data.js';\n",
    '',
    'planner built-data import'
  );

  const importAnchor = "} from './recipe-utils.js';\n";
  const sharedImports = `${importAnchor}import {\n  DIETARY_BADGES,\n  formatKcal,\n  formatNumber,\n  getRecipeTitleParts,\n} from './recipe-model.js';\nimport { loadRecipeCollection } from './recipe-repository.js';\n`;
  source = replaceOnce(source, importAnchor, sharedImports, 'planner shared model imports');

  source = replaceOnce(
    source,
    /const INBOX_STORAGE_KEY = 'cookingdb-inbox-recipes';\n\nconst DIETARY_BADGES = \[[\s\S]*?\];\n\nfunction formatNumber\([\s\S]*?\n\}\n\nfunction formatKcal\([\s\S]*?\n\}\n\n(?=function formatPercentDV)/,
    '',
    'planner duplicate badge/format block'
  );

  source = replaceOnce(
    source,
    /function normalizeTitleKey\([\s\S]*?async function loadRecipes\(\) \{[\s\S]*?\n\}\n\n(?=function splitRecipeTitle)/,
    "async function loadRecipes() {\n  return loadRecipeCollection({ label: 'Meal prep recipes' });\n}\n\n",
    'planner duplicate normalization/repository block'
  );

  source = replaceOnce(
    source,
    /function splitRecipeTitle\([\s\S]*?function getRecipeTitleParts\([\s\S]*?\n\}\n\n(?=function recipeMatchesQuery)/,
    '',
    'planner duplicate title block'
  );

  write(file, source);
}

function migrateCookbook() {
  const file = 'docs/app.js';
  let source = read(file);
  if (source.includes("from './recipe-repository.js'")) return;

  source = replaceOnce(
    source,
    "import { buildRecipeLink, getRecipeTitleParts, normalizeRecipeEntry, normalizeTitleKey } from './recipe-model.js';\n",
    "import { buildRecipeLink, getRecipeTitleParts, normalizeTitleKey } from './recipe-model.js';\nimport { loadStoredInboxRecipes, normalizeRecipeListResult, storeInboxRecipes } from './recipe-repository.js';\n",
    'cookbook recipe-model import'
  );
  source = replaceOnce(
    source,
    "const STORAGE_KEY = 'cookingdb-inbox-recipes';\n",
    '',
    'cookbook duplicate storage key'
  );
  source = replaceOnce(
    source,
    /function loadStoredInboxRecipes\(\) \{[\s\S]*?\n\}\n\nfunction storeInboxRecipes\(recipes\) \{[\s\S]*?\n\}\n\n(?=function recipeSummary)/,
    '',
    'cookbook duplicate inbox storage block'
  );
  source = replaceOnce(
    source,
    /function normalizeIncomingList\(result\) \{[\s\S]*?\n\}\n\n(?=function dedupeInboxRecipes)/,
    '',
    'cookbook duplicate incoming normalization block'
  );
  source = replaceOnce(
    source,
    '    const incoming = normalizeIncomingList(result);',
    '    const incoming = normalizeRecipeListResult(result);',
    'cookbook incoming repository call'
  );
  source = replaceOnce(
    source,
    '  storeInboxRecipes(next);\n  const summaries = next.map((rec) => recipeSummary(rec, \'inbox\'));',
    "  inboxRecipes = storeInboxRecipes(next);\n  const summaries = inboxRecipes.map((rec) => recipeSummary(rec, 'inbox'));",
    'cookbook stored inbox assignment'
  );

  write(file, source);
}

migrateRecipePage();
migratePlannerPage();
migrateCookbook();
console.log('Refactor phase 2 migrations applied.');
