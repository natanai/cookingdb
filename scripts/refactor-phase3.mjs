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
  if (next === source) throw new Error(`Refactor phase 3: expected ${label}`);
  return next;
}

function migrateCookbook() {
  const file = 'docs/app.js';
  let source = read(file);
  if (source.includes("loadRecipeSummaries")) return;

  source = replaceOnce(
    source,
    "import { builtDataUrl, fetchBuiltJson } from './built-data.js';",
    "import { builtDataUrl } from './built-data.js';",
    'Cookbook built-data import'
  );
  source = replaceOnce(
    source,
    "import { loadStoredInboxRecipes, normalizeRecipeListResult, storeInboxRecipes } from './recipe-repository.js';",
    "import { loadRecipeSummaries, loadStoredInboxRecipes, normalizeRecipeListResult, storeInboxRecipes } from './recipe-repository.js';",
    'Cookbook repository import'
  );
  source = replaceOnce(
    source,
    "async function loadIndex() {\n  return fetchBuiltJson('index.json', { label: 'Cookbook index' });\n}",
    "async function loadIndex() {\n  return loadRecipeSummaries({ label: 'Cookbook index' });\n}",
    'Cookbook index loader'
  );

  write(file, source);
}

function migrateBreadMaker() {
  const file = 'docs/bread-maker.js';
  let source = read(file);
  if (source.includes("loadRecipeSummaries")) return;

  source = replaceOnce(
    source,
    "import { fetchBuiltJson } from './built-data.js';\n",
    '',
    'Bread Maker built-data import'
  );
  source = replaceOnce(
    source,
    "import { buildRecipeLink, getRecipeTitleParts } from './recipe-model.js';",
    "import { buildRecipeLink, getRecipeTitleParts } from './recipe-model.js';\nimport { loadRecipeSummaries } from './recipe-repository.js';",
    'Bread Maker repository import'
  );
  source = replaceOnce(
    source,
    "async function loadDefaultRecipes() {\n  const data = await fetchBuiltJson('index.json', { label: 'Bread maker recipes' });\n  return Array.isArray(data) ? data : [];\n}",
    "async function loadDefaultRecipes() {\n  return loadRecipeSummaries({ label: 'Bread maker recipes' });\n}",
    'Bread Maker index loader'
  );

  write(file, source);
}

migrateCookbook();
migrateBreadMaker();
console.log('Refactor phase 3 migrations applied.');
