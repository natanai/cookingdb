import fs from 'fs';
import path from 'path';

async function loadPapa() {
  const module = await import('papaparse').catch(() => null);
  return module ? module.default || module : null;
}

function simpleParseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split(/\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? '';
    });
    return row;
  });
}

function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

const UNIT_ALIASES = new Map([
  ['cloves', 'clove'],
  ['clove', 'clove'],
  ['sprigs', 'sprig'],
  ['sprig', 'sprig'],
  ['leaves', 'leaf'],
  ['leaf', 'leaf'],
  ['pieces', 'count'],
  ['piece', 'count'],
  ['packages', 'package'],
  ['package', 'package'],
  ['bags', 'bag'],
  ['bag', 'bag'],
  ['bunches', 'count'],
  ['bunch', 'count'],
  ['cans', 'can'],
  ['can', 'can'],
  ['jars', 'jar'],
  ['jar', 'jar'],
  ['bottles', 'bottle'],
  ['bottle', 'bottle'],
  ['tablespoons', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['teaspoons', 'tsp'],
  ['teaspoon', 'tsp'],
  ['cups', 'cup'],
  ['pints', 'pint'],
  ['pint', 'pint'],
  ['quarts', 'quart'],
  ['quart', 'quart'],
  ['qt', 'quart'],
  ['ounces', 'oz'],
  ['ounce', 'oz'],
  ['pounds', 'lb'],
  ['pound', 'lb'],
  ['liters', 'l'],
  ['liter', 'l'],
  ['milliliters', 'ml'],
  ['milliliter', 'ml'],
  ['ml', 'ml'],
  ['l', 'l'],
  ['medium', 'count'],
  ['large', 'count'],
  ['small', 'count'],
]);

function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
}

function ensureNoExtraColumns(content, filePath, label) {
  const lines = content.replace(/\r\n/g, '\n').split(/\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return;
  const headers = parseLine(lines[0]);
  const headerCount = headers.length;
  lines.slice(1).forEach((line, idx) => {
    const values = parseLine(line);
    if (values.length > headerCount) {
      const rowNumber = idx + 2;
      throw new Error(
        `${label || filePath}: detected extra columns in row ${rowNumber}. ` +
          'Check for unquoted commas in fields like notes.',
      );
    }
  });
}

async function parseCSVFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (options.expectNoExtraColumns) {
    ensureNoExtraColumns(content, filePath, options.label);
  }
  const Papa = await loadPapa();
  if (Papa) {
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      throw new Error(`CSV parse error in ${filePath}: ${parsed.errors[0].message}`);
    }
    return parsed.data;
  }
  return simpleParseCSV(content);
}

function extractTokensFromSteps(stepsRaw) {
  const tokenRegex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
  const conditionRegex = /{{#if\s+([a-zA-Z0-9_-]+)/g;
  const tokens = [];
  let match;
  while ((match = tokenRegex.exec(stepsRaw)) !== null) {
    tokens.push(match[1]);
  }
  while ((match = conditionRegex.exec(stepsRaw)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseBoolean(value) {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function parseCategories(raw) {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadPanCatalog(catalogPath) {
  ensure(fs.existsSync(catalogPath), 'Missing pan sizes catalog');
  const raw = fs.readFileSync(catalogPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse pan catalog: ${err?.message || err}`);
  }
  const map = new Map();
  parsed.forEach((entry) => {
    if (!entry?.id) return;
    map.set(entry.id, entry);
  });
  return map;
}

export async function validateAll() {
  const recipesDir = path.join(process.cwd(), 'recipes');
  const recipeDirs = fs.readdirSync(recipesDir, { withFileTypes: true }).filter((ent) => ent.isDirectory());
  const ingredientCatalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  const nutritionGuidelinesPath = path.join(process.cwd(), 'data', 'nutrition_guidelines.json');
  const nutritionPolicyPath = path.join(process.cwd(), 'data', 'nutrition_policy.json');
  ensure(fs.existsSync(ingredientCatalogPath), 'Missing ingredient_catalog.csv');
  ensure(fs.existsSync(nutritionGuidelinesPath), 'Missing nutrition_guidelines.json');
  ensure(fs.existsSync(nutritionPolicyPath), 'Missing nutrition_policy.json');
  const ingredientCatalogRows = await parseCSVFile(ingredientCatalogPath);
  const ingredientCatalog = new Set(ingredientCatalogRows.map((row) => row.ingredient_id));
  const ingredientCatalogIds = new Set();
  ingredientCatalogRows.forEach((row) => {
    ensure(row.ingredient_id, 'ingredient_catalog.csv missing ingredient_id');
    ensure(
      [
        'serving_qty',
        'serving_unit_norm',
        'serving_size',
        'calories_kcal',
        'protein_g',
        'total_fat_g',
        'saturated_fat_g',
        'total_carbs_g',
        'sugars_g',
        'fiber_g',
        'sodium_mg',
        'calcium_mg',
        'iron_mg',
        'potassium_mg',
        'vitamin_c_mg',
        'nutrition_source',
        'nutrition_notes',
        'unit_factor_from_unit_norm',
        'unit_factor_to_unit_norm',
        'unit_factor',
        'unit_factor_source',
        'unit_factor_notes',
        'portion_unit',
        'portion_grams',
        'portion_source',
        'portion_notes',
      ].every((field) => Object.prototype.hasOwnProperty.call(row, field)),
      'ingredient_catalog.csv missing nutrition columns'
    );
    ensure(row.serving_qty, 'ingredient_catalog.csv missing serving_qty');
    ensure(row.serving_unit_norm, 'ingredient_catalog.csv missing serving_unit_norm');
    ensure(!ingredientCatalogIds.has(row.ingredient_id), `ingredient_catalog.csv duplicate ingredient_id ${row.ingredient_id}`);
    ingredientCatalogIds.add(row.ingredient_id);
  });
  const unitFactorFromUnits = new Map();
  ingredientCatalogRows.forEach((row, idx) => {
    const numericFields = [
      'serving_qty',
      'calories_kcal',
      'protein_g',
      'total_fat_g',
      'saturated_fat_g',
      'total_carbs_g',
      'sugars_g',
      'fiber_g',
      'sodium_mg',
      'calcium_mg',
      'iron_mg',
      'potassium_mg',
      'vitamin_c_mg',
    ];
    numericFields.forEach((field) => {
      ensure(
        Number.isFinite(Number(row[field])),
        `ingredient_catalog.csv non-numeric ${field} on row ${idx + 2}`
      );
    });
    if (row.portion_unit || row.portion_grams || row.portion_source || row.portion_notes) {
      ensure(row.portion_unit, `ingredient_catalog.csv missing portion_unit on row ${idx + 2}`);
      ensure(row.portion_grams, `ingredient_catalog.csv missing portion_grams on row ${idx + 2}`);
      ensure(Number.isFinite(Number(row.portion_grams)), `ingredient_catalog.csv non-numeric portion_grams on row ${idx + 2}`);
    }
    if (
      row.unit_factor_from_unit_norm ||
      row.unit_factor_to_unit_norm ||
      row.unit_factor ||
      row.unit_factor_source ||
      row.unit_factor_notes
    ) {
      ensure(row.unit_factor_from_unit_norm, `ingredient_catalog.csv missing unit_factor_from_unit_norm on row ${idx + 2}`);
      ensure(row.unit_factor_to_unit_norm, `ingredient_catalog.csv missing unit_factor_to_unit_norm on row ${idx + 2}`);
      ensure(row.unit_factor, `ingredient_catalog.csv missing unit_factor on row ${idx + 2}`);
      ensure(
        Number.isFinite(Number(row.unit_factor)),
        `ingredient_catalog.csv non-numeric unit_factor on row ${idx + 2}`
      );
      const fromUnit = normalizeUnit(row.unit_factor_from_unit_norm);
      if (!unitFactorFromUnits.has(row.ingredient_id)) {
        unitFactorFromUnits.set(row.ingredient_id, new Set());
      }
      if (fromUnit) unitFactorFromUnits.get(row.ingredient_id).add(fromUnit);
    }
  });

  const produceHerbPattern =
    /(basil|parsley|cilantro|coriander|thyme|rosemary|oregano|sage|dill|mint|chive|bay|garlic|onion|shallot|leek|scallion|carrot|celery|pepper|potato|tomato|squash|zucchini|cucumber|lettuce|spinach|kale|cabbage|broccoli|cauliflower|mushroom|lemon|lime|orange|apple|pear|banana|berry|herb)/;
  const produceHerbIds = new Set();
  ingredientCatalogRows.forEach((row) => {
    const name = `${row.canonical_name || ''} ${row.ingredient_id || ''}`.toLowerCase();
    if (produceHerbPattern.test(name)) {
      produceHerbIds.add(row.ingredient_id);
    }
  });
  const panCatalog = loadPanCatalog(path.join(process.cwd(), 'data', 'pan-sizes.json'));
  const ratioPattern = /^\d+(?: \d+\/\d+|\/\d+)?$/;
  const unitLintWarnings = [];

  for (const dirEnt of recipeDirs) {
    const recipeId = dirEnt.name;
    const baseDir = path.join(recipesDir, recipeId);
    const metaPath = path.join(baseDir, 'meta.csv');
    const ingredientsPath = path.join(baseDir, 'ingredients.csv');
    const stepsPath = path.join(baseDir, 'steps.md');
    const stepsCsvPath = path.join(baseDir, 'steps.csv');
    ensure(fs.existsSync(metaPath), `Missing meta.csv for recipe ${recipeId}`);
    ensure(fs.existsSync(ingredientsPath), `Missing ingredients.csv for recipe ${recipeId}`);
    ensure(fs.existsSync(stepsPath) || fs.existsSync(stepsCsvPath), `Missing steps for recipe ${recipeId}`);

    const metaRows = await parseCSVFile(metaPath, {
      expectNoExtraColumns: true,
      label: `${recipeId}: meta.csv`,
    });
    ensure(metaRows.length === 1, `${recipeId}: meta.csv must contain exactly one data row`);
    const metaRow = metaRows[0];
    ensure(metaRow.id === recipeId, `${recipeId}: meta id must match directory name`);
    ensure(Object.prototype.hasOwnProperty.call(metaRow, 'categories'), `${recipeId}: meta.csv missing categories column`);
    ensure(
      Object.prototype.hasOwnProperty.call(metaRow, 'servings_per_batch'),
      `${recipeId}: meta.csv missing servings_per_batch column`
    );
    ensure(
      parseCategories(metaRow.categories).length > 0,
      `${recipeId}: meta.csv must include at least one category`
    );
    const servingsPerBatch = Number(metaRow.servings_per_batch);
    ensure(
      Number.isFinite(servingsPerBatch) && servingsPerBatch > 0,
      `${recipeId}: servings_per_batch must be a positive number`
    );

    const ingredientRows = await parseCSVFile(ingredientsPath);
    const stepsRaw = fs.existsSync(stepsCsvPath)
      ? null
      : fs.readFileSync(stepsPath, 'utf-8');
    const stepRows = fs.existsSync(stepsCsvPath) ? await parseCSVFile(stepsCsvPath) : null;
    const stepTokens = [];
    if (stepRows) {
      ensure(stepRows.length > 0, `${recipeId}: steps.csv must include at least one row`);
      stepRows.forEach((row, idx) => {
        ensure(row.text, `${recipeId}: steps.csv row ${idx + 1} missing text`);
        extractTokensFromSteps(row.text).forEach((token) => stepTokens.push(token));
      });
    } else {
      extractTokensFromSteps(stepsRaw).forEach((token) => stepTokens.push(token));
    }
    const stepTokenSet = new Set(stepTokens);

    const tokenOptions = new Map();
    const tokenDisplayOptions = new Map();
    for (const row of ingredientRows) {
      const requiredFields = ['token', 'display', 'ingredient_id'];
      for (const field of requiredFields) {
        ensure(row[field], `${recipeId}: ingredient row missing ${field}: ${JSON.stringify(row)}`);
      }
      const token = row.token;
      const display = (row.display || '').trim();
      ensure(display, `${recipeId}: ingredient row missing display value: ${JSON.stringify(row)}`);
      const ratio = (row.ratio || '').trim();
      ensure(!ratio || ratioPattern.test(ratio), `${recipeId}: invalid ratio for ${token}: ${row.ratio} | Row: ${JSON.stringify(row)}`);
      ensure(
        ingredientCatalog.has(row.ingredient_id),
        `${recipeId}: unknown ingredient_id ${row.ingredient_id} for token ${token} | Row: ${JSON.stringify(row)}`,
      );
      ensure(token, `${recipeId}: ingredient row missing token`);
      if (!tokenOptions.has(token)) {
        tokenOptions.set(token, new Set());
      }
      if (row.option) {
        tokenOptions.get(token).add(row.option);
      }
      if (!tokenDisplayOptions.has(token)) {
        tokenDisplayOptions.set(token, new Map());
      }
      const displayOptions = tokenDisplayOptions.get(token);
      if (!displayOptions.has(display)) {
        displayOptions.set(display, { options: new Set() });
      }
      const displayEntry = displayOptions.get(display);
      if (row.option) {
        displayEntry.options.add(row.option);
      }
      ensure(stepTokenSet.has(token), `${recipeId}: ingredient token ${token} not found in steps`);
      const normalizedUnit = normalizeUnit(row.unit);
      const disallowedUnits = new Set(['sprig', 'bunch', 'medium', 'large', 'piece']);
      if (normalizedUnit && disallowedUnits.has(normalizedUnit) && produceHerbIds.has(row.ingredient_id)) {
        const allowedUnits = unitFactorFromUnits.get(row.ingredient_id) || new Set();
        if (!allowedUnits.has(normalizedUnit)) {
          unitLintWarnings.push(
            `${recipeId}: ${row.ingredient_id} uses "${row.unit}" (token ${token}). ` +
            'Prefer mass/volume units for produce/herbs or add an explicit unit factor.'
          );
        }
      }
    }

    const ingredientTokenSet = new Set([...tokenOptions.keys()]);
    for (const token of stepTokenSet) {
      ensure(ingredientTokenSet.has(token), `${recipeId}: steps token ${token} missing in ingredients`);
    }

    const choicesPath = path.join(baseDir, 'choices.csv');
    const choiceRows = fs.existsSync(choicesPath) ? await parseCSVFile(choicesPath) : [];
    const choicesMap = new Map(choiceRows.map((row) => [row.token, row]));

    for (const [token, displayMap] of tokenDisplayOptions.entries()) {
      const options = tokenOptions.get(token) || new Set();
      if (options.size < 2) continue;
      for (const [displayLabel, info] of displayMap.entries()) {
        if (info.options.size >= 2) {
          const optionList = [...info.options].join(', ');
          ensure(
            false,
            `${recipeId}: ingredient token ${token} has multiple options (${optionList}) with identical display "${displayLabel}"`,
          );
        }
      }
    }

    for (const [token, options] of tokenOptions.entries()) {
      if (options.size >= 2) {
        ensure(choicesMap.has(token), `${recipeId}: token ${token} has multiple options but is missing from choices.csv`);
        const choice = choicesMap.get(token);
        ensure(options.has(choice.default_option), `${recipeId}: default option ${choice.default_option} for ${token} not found in ingredients`);
      }
    }

    for (const row of choiceRows) {
      ensure(tokenOptions.has(row.token), `${recipeId}: choices token ${row.token} missing in ingredients`);
      const options = tokenOptions.get(row.token);
      ensure(options.size >= 2, `${recipeId}: choices token ${row.token} must have at least two options in ingredients.csv`);
      ensure(options.has(row.default_option), `${recipeId}: default option ${row.default_option} for ${row.token} not found among ingredient options`);
    }

    const defaultPanId = String(metaRow.default_pan || '').trim();
    if (defaultPanId) {
      ensure(panCatalog.has(defaultPanId), `${recipeId}: default pan ${defaultPanId} not found in pan catalog`);
      const panDef = panCatalog.get(defaultPanId);
      ensure(Number.isFinite(panDef.width) && panDef.width > 0, `${recipeId}: pan ${defaultPanId} missing width`);
      if (['rectangle', 'square'].includes((panDef.shape || '').toLowerCase())) {
        ensure(Number.isFinite(panDef.height) && panDef.height > 0, `${recipeId}: pan ${defaultPanId} missing height`);
      }
    }
  }

  if (unitLintWarnings.length) {
    unitLintWarnings.forEach((warning) => console.warn(`Unit lint: ${warning}`));
  }

  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateAll()
    .then(() => {
      console.log('Validation passed');
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
