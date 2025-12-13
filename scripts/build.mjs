import fs from 'fs/promises';
import path from 'path';
import { validateAll } from './validate.mjs';
import { parse } from 'papaparse';

const RECIPES_DIR = path.resolve('recipes');
const OUTPUT_DIR = path.resolve('docs/built');
const CATALOG_PATH = path.resolve('data/ingredient_catalog.csv');

function parseCsv(content, { header = false } = {}) {
  return parse(content, { header, skipEmptyLines: true });
}

function toBoolean(value) {
  return String(value).toLowerCase() === 'true';
}

async function loadCatalog() {
  const content = await fs.readFile(CATALOG_PATH, 'utf8');
  const { data } = parseCsv(content, { header: true });
  const map = new Map();
  for (const row of data) {
    map.set(row.ingredient_id, {
      id: row.ingredient_id,
      canonical_name: row.canonical_name,
      contains_gluten: toBoolean(row.contains_gluten),
      contains_egg: toBoolean(row.contains_egg),
      contains_dairy: toBoolean(row.contains_dairy)
    });
  }
  return map;
}

async function readRecipeDir(recipeDir) {
  const metaPath = path.join(recipeDir, 'meta.csv');
  const stepsPath = path.join(recipeDir, 'steps.md');
  const ingredientsPath = path.join(recipeDir, 'ingredients.csv');
  const choicesPath = path.join(recipeDir, 'choices.csv');

  const metaContent = await fs.readFile(metaPath, 'utf8');
  const meta = parseCsv(metaContent, { header: true }).data[0];
  const stepsRaw = await fs.readFile(stepsPath, 'utf8');
  const steps = stepsRaw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim());
  const ingredients = parseCsv(await fs.readFile(ingredientsPath, 'utf8'), { header: true }).data;

  let choices = [];
  try {
    const choicesContent = await fs.readFile(choicesPath, 'utf8');
    choices = parseCsv(choicesContent, { header: true }).data;
  } catch {
    choices = [];
  }

  return { meta, steps, ingredients, choices };
}

function parseCategories(raw) {
  return (raw || '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function computeCompatibility(ingredients, catalog) {
  const optionCounts = new Map();
  for (const row of ingredients) {
    const token = row.token;
    const option = (row.option ?? '').trim();
    const set = optionCounts.get(token) || new Set();
    set.add(option);
    optionCounts.set(token, set);
  }

  const restrictions = ['gluten', 'egg', 'dairy'];
  const compat = { gluten_free: true, egg_free: true, dairy_free: true };

  for (const restriction of restrictions) {
    for (const [token, optionSet] of optionCounts.entries()) {
      const tokenRows = ingredients.filter((r) => r.token === token);
      let tokenCompatible = false;

      if (optionSet.size > 1) {
        tokenCompatible = tokenRows.some((row) => isOptionCompatible(row, restriction, catalog));
      } else {
        tokenCompatible = isOptionCompatible(tokenRows[0], restriction, catalog);
      }

      if (!tokenCompatible) {
        if (restriction === 'gluten') compat.gluten_free = false;
        if (restriction === 'egg') compat.egg_free = false;
        if (restriction === 'dairy') compat.dairy_free = false;
        break;
      }
    }
  }

  return compat;
}

function isOptionCompatible(row, restriction, catalog) {
  const optional = (!row.ratio || String(row.ratio).trim() === '') && (!row.unit || String(row.unit).trim() === '');
  if (optional) return true;
  const ingredient = catalog.get(row.ingredient_id);
  if (!ingredient) return false;
  if (restriction === 'gluten') return !ingredient.contains_gluten;
  if (restriction === 'egg') return !ingredient.contains_egg;
  if (restriction === 'dairy') return !ingredient.contains_dairy;
  return false;
}

async function main() {
  const valid = await validateAll();
  if (!valid) {
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const catalog = await loadCatalog();
  const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
  const recipeDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(RECIPES_DIR, e.name));

  const recipeObjects = [];
  for (const dir of recipeDirs) {
    const recipe = await readRecipeDir(dir);
    const categories = parseCategories(recipe.meta.categories);
    const compat = computeCompatibility(recipe.ingredients, catalog);
    recipeObjects.push({ ...recipe, meta: { ...recipe.meta, categories } , compatibility_possible: compat });
  }

  const categoryCounts = new Map();
  for (const recipe of recipeObjects) {
    for (const category of recipe.meta.categories) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }

  const allCategories = Array.from(categoryCounts.keys()).sort();

  const index = {
    all_categories: allCategories,
    category_counts: Object.fromEntries(allCategories.map((cat) => [cat, categoryCounts.get(cat) || 0])),
    recipes: recipeObjects.map((recipe) => ({
      id: recipe.meta.id,
      title: recipe.meta.title,
      categories: recipe.meta.categories,
      compatibility_possible: recipe.compatibility_possible
    }))
  };

  await fs.writeFile(path.join(OUTPUT_DIR, 'recipes.json'), JSON.stringify(recipeObjects, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log('Build complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
