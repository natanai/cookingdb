import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { parse } from 'papaparse';

const RECIPES_DIR = path.resolve('recipes');
const CATALOG_PATH = path.resolve('data/ingredient_catalog.csv');
const PANS_PATH = path.resolve('data/pans.csv');

function parseCsv(content, { header = false } = {}) {
  const result = parse(content, { header, skipEmptyLines: true });
  return result;
}

function toBoolean(value) {
  return String(value).toLowerCase() === 'true';
}

async function loadCatalog() {
  const content = await fs.readFile(CATALOG_PATH, 'utf8');
  const { data, meta } = parseCsv(content, { header: true });
  const allowedHeaders = [
    'ingredient_id',
    'canonical_name',
    'contains_gluten',
    'contains_egg',
    'contains_dairy'
  ];
  const fields = meta.fields || [];

  for (const header of fields) {
    if (/substitut|alternativ|replacement|swap/i.test(header)) {
      throw new Error(`ingredient_catalog.csv contains forbidden header: ${header}`);
    }
    if (!allowedHeaders.includes(header)) {
      throw new Error(`ingredient_catalog.csv has unsupported header: ${header}`);
    }
  }

  for (const header of allowedHeaders) {
    if (!fields.includes(header)) {
      throw new Error(`ingredient_catalog.csv missing required header: ${header}`);
    }
  }

  return data;
}

async function loadPans() {
  const content = await fs.readFile(PANS_PATH, 'utf8');
  const { data, meta } = parseCsv(content, { header: true });
  const requiredHeaders = [
    'pan_id',
    'label',
    'shape',
    'width_in',
    'length_in',
    'diameter_in',
    'depth_in',
    'notes'
  ];
  const fields = meta.fields || [];

  for (const header of requiredHeaders) {
    if (!fields.includes(header)) {
      throw new Error(`pans.csv missing required header: ${header}`);
    }
  }

  const map = new Map();
  data.forEach((row) => {
    if (row.pan_id) {
      map.set(row.pan_id, row);
    }
  });
  return map;
}

function extractTokensFromSteps(stepContent) {
  const tokens = [];
  const regex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
  let match;
  while ((match = regex.exec(stepContent)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function groupIngredients(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.token) {
      throw new Error('ingredients.csv row missing token value');
    }
    const entries = map.get(row.token) || [];
    entries.push(row);
    map.set(row.token, entries);
  }
  return map;
}

async function validateRecipe(recipeDir, errors, pansMap) {
  const metaPath = path.join(recipeDir, 'meta.csv');
  const ingredientsPath = path.join(recipeDir, 'ingredients.csv');
  const stepsPath = path.join(recipeDir, 'steps.md');
  const choicesPath = path.join(recipeDir, 'choices.csv');

  for (const file of [metaPath, ingredientsPath, stepsPath]) {
    try {
      await fs.access(file);
    } catch {
      errors.push(`${recipeDir}: missing required file ${path.basename(file)}`);
      return false;
    }
  }

  const ingredientsContent = await fs.readFile(ingredientsPath, 'utf8');
  const { data: ingredientRows } = parseCsv(ingredientsContent, { header: true });
  const ingredientMap = groupIngredients(ingredientRows);

  const metaContent = await fs.readFile(metaPath, 'utf8');
  const parsedMeta = parseCsv(metaContent, { header: true });
  const metaFields = parsedMeta.meta.fields || [];
  const oldMetaHeader = ['id', 'title', 'base_kind', 'default_base', 'categories', 'notes'];
  const newMetaHeader = [
    'id',
    'title',
    'base_kind',
    'default_base',
    'categories',
    'notes',
    'uses_pan',
    'default_pan_id',
    'pan_scale_method'
  ];

  const matchesOldHeader =
    metaFields.length === oldMetaHeader.length &&
    oldMetaHeader.every((h, idx) => metaFields[idx] === h);
  const matchesNewHeader =
    metaFields.length === newMetaHeader.length &&
    newMetaHeader.every((h, idx) => metaFields[idx] === h);

  if (!matchesOldHeader && !matchesNewHeader) {
    errors.push(
      `${recipeDir}: meta.csv header must match either ${oldMetaHeader.join(',')} or ${newMetaHeader.join(',')}`
    );
  }

  const metaRow = parsedMeta.data[0] || {};

  const stepsContent = await fs.readFile(stepsPath, 'utf8');
  const stepTokens = extractTokensFromSteps(stepsContent);
  const ingredientTokens = Array.from(ingredientMap.keys());

  for (const token of ingredientTokens) {
    if (!stepTokens.includes(token)) {
      errors.push(`${recipeDir}: ingredient token ${token} not used in steps.md`);
    }
  }

  for (const token of stepTokens) {
    if (!ingredientMap.has(token)) {
      errors.push(`${recipeDir}: steps reference token ${token} not found in ingredients.csv`);
    }
  }

  if (metaFields.length === newMetaHeader.length) {
    const usesPan = toBoolean(metaRow.uses_pan || '');
    if (usesPan) {
      const defaultPanId = metaRow.default_pan_id;
      const panScaleMethod = (metaRow.pan_scale_method || 'none').toLowerCase();
      if (!defaultPanId) {
        errors.push(`${recipeDir}: uses_pan=true but default_pan_id is missing`);
      } else if (!pansMap.has(defaultPanId)) {
        errors.push(`${recipeDir}: default_pan_id ${defaultPanId} not found in pans.csv`);
      }

      const allowedMethods = new Set(['area', 'volume', 'none']);
      if (!allowedMethods.has(panScaleMethod)) {
        errors.push(`${recipeDir}: pan_scale_method must be one of area, volume, none`);
      }
    }
  }

  const optionCounts = new Map();
  for (const [token, entries] of ingredientMap.entries()) {
    const optionSet = new Set(entries.map((entry) => (entry.option ?? '').trim()));
    optionCounts.set(token, optionSet.size);
  }

  let choices = [];
  let hasChoicesFile = false;
  try {
    await fs.access(choicesPath);
    hasChoicesFile = true;
  } catch {
    hasChoicesFile = false;
  }

  if (hasChoicesFile) {
    const choicesContent = await fs.readFile(choicesPath, 'utf8');
    const parsed = parseCsv(choicesContent, { header: true });
    choices = parsed.data;
  }

  const choiceByToken = new Map(choices.map((c) => [c.token, c]));

  for (const [token, size] of optionCounts.entries()) {
    if (size > 1) {
      if (!hasChoicesFile) {
        errors.push(`${recipeDir}: token ${token} has multiple options but choices.csv is missing`);
        continue;
      }
      const choiceRow = choiceByToken.get(token);
      if (!choiceRow) {
        errors.push(`${recipeDir}: choices.csv missing entry for token ${token}`);
        continue;
      }
      const availableOptions = new Set(
        ingredientMap.get(token).map((entry) => (entry.option ?? '').trim())
      );
      if (!availableOptions.has(choiceRow.default_option)) {
        errors.push(
          `${recipeDir}: default_option for token ${token} not found among ingredient options`
        );
      }
    }
  }

  return errors.length === 0;
}

export async function validateAll() {
  const errors = [];
  await loadCatalog();
  const pansMap = await loadPans();

  let entries;
  try {
    entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Unable to read recipes directory: ${err.message}`);
  }

  const recipeDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(RECIPES_DIR, e.name));

  for (const recipeDir of recipeDirs) {
    await validateRecipe(recipeDir, errors, pansMap);
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(err);
    }
    process.exitCode = 1;
    return false;
  }

  console.log(`OK: validated ${recipeDirs.length} recipes`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateAll().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
