import fs from 'fs';
import path from 'path';
import { validateAll } from './validate.mjs';

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

async function parseCSVFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
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

function parseCategories(raw) {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractTokensFromSteps(stepsRaw) {
  const tokenRegex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
  const tokens = [];
  let match;
  while ((match = tokenRegex.exec(stepsRaw)) !== null) {
    tokens.push(match[1]);
  }
  const conditionRegex = /{{#if\s+([a-zA-Z0-9_-]+)/g;
  while ((match = conditionRegex.exec(stepsRaw)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function loadIngredientCatalog(catalogPath) {
  const rows = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf-8') : '';
  const parsed = rows ? simpleParseCSV(rows) : [];
  const map = new Map();
  for (const row of parsed) {
    map.set(row.ingredient_id, {
      contains_gluten: row.contains_gluten === 'true',
      contains_egg: row.contains_egg === 'true',
      contains_dairy: row.contains_dairy === 'true',
      canonical_name: row.canonical_name,
    });
  }
  return map;
}

function loadPanCatalog(catalogPath) {
  const raw = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf-8') : '';
  if (!raw) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse pan catalog at ${catalogPath}: ${err?.message || err}`);
  }
  const map = new Map();
  parsed.forEach((entry) => {
    if (!entry?.id) return;
    map.set(entry.id, {
      id: entry.id,
      label: entry.label || entry.id,
      shape: (entry.shape || 'rectangle').toLowerCase(),
      width: Number(entry.width),
      height: entry.height === null || entry.height === undefined ? null : Number(entry.height),
      unit: entry.unit || 'in',
    });
  });
  return map;
}

function ingredientCompatible(flags, restriction) {
  if (!flags) return false;
  if (restriction === 'gluten_free') return flags.contains_gluten === false;
  if (restriction === 'egg_free') return flags.contains_egg === false;
  if (restriction === 'dairy_free') return flags.contains_dairy === false;
  return true;
}

function parseBoolean(value) {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function computeCompatibility(ingredients, catalog) {
  const restrictions = ['gluten_free', 'egg_free', 'dairy_free'];
  const result = { gluten_free: true, egg_free: true, dairy_free: true };

  for (const restriction of restrictions) {
    for (const tokenData of Object.values(ingredients)) {
      if (tokenData.isChoice) {
        const compatibleOption = tokenData.options.some((opt) =>
          ingredientCompatible(catalog.get(opt.ingredient_id), restriction)
        );
        if (!compatibleOption) {
          result[restriction] = false;
          break;
        }
      } else {
        const flags = catalog.get(tokenData.options[0].ingredient_id);
        if (!ingredientCompatible(flags, restriction)) {
          result[restriction] = false;
          break;
        }
      }
    }
  }

  return result;
}

async function build() {
  await validateAll();
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  const catalog = loadIngredientCatalog(catalogPath);
  const panCatalog = loadPanCatalog(path.join(process.cwd(), 'data', 'pan-sizes.json'));
  const recipesDir = path.join(process.cwd(), 'recipes');
  const recipeDirs = fs.readdirSync(recipesDir, { withFileTypes: true }).filter((ent) => ent.isDirectory());

  const recipeOutputs = [];
  const indexList = [];

  for (const dirEnt of recipeDirs) {
    const recipeId = dirEnt.name;
    const baseDir = path.join(recipesDir, recipeId);
    const meta = (await parseCSVFile(path.join(baseDir, 'meta.csv')))[0];
    const ingredientRows = await parseCSVFile(path.join(baseDir, 'ingredients.csv'));
    const choiceRows = fs.existsSync(path.join(baseDir, 'choices.csv'))
      ? await parseCSVFile(path.join(baseDir, 'choices.csv'))
      : [];
    const stepsCsvPath = path.join(baseDir, 'steps.csv');
    const hasStepsCsv = fs.existsSync(stepsCsvPath);
    const stepRows = hasStepsCsv ? await parseCSVFile(stepsCsvPath) : null;
    const steps = stepRows
      ? stepRows.map((row) => ({ section: row.section || null, text: row.text || '' }))
      : fs
          .readFileSync(path.join(baseDir, 'steps.md'), 'utf-8')
          .split(/\n/)
          .filter((line) => line.trim() !== '')
          .map((line) => ({ section: null, text: line.replace(/^\d+\.\s*/, '') }));
    const stepsRaw = hasStepsCsv
      ? steps.map((step, idx) => `${idx + 1}. ${step.text}`).join('\n')
      : fs.readFileSync(path.join(baseDir, 'steps.md'), 'utf-8');
    const tokensUsed = steps.flatMap((step) => extractTokensFromSteps(step.text));

    const ingredients = {};
    const ingredientSections = [];
    for (const row of ingredientRows) {
      if (!ingredients[row.token]) {
        ingredients[row.token] = { token: row.token, options: [], isChoice: false };
      }
      const flags = catalog.get(row.ingredient_id);
      const dependency = row.depends_on_token
        ? { token: row.depends_on_token, option: row.depends_on_option || null }
        : null;
      const optionEntry = {
        option: row.option,
        display: row.display,
        ratio: row.ratio,
        unit: row.unit,
        ingredient_id: row.ingredient_id,
        depends_on: dependency,
        line_group: row.line_group || null,
        section: row.section || null,
        dietary: {
          gluten_free: ingredientCompatible(flags, 'gluten_free'),
          egg_free: ingredientCompatible(flags, 'egg_free'),
          dairy_free: ingredientCompatible(flags, 'dairy_free'),
        },
      };
      ingredients[row.token].options.push(optionEntry);
      if (row.section) {
        ingredients[row.token].section = ingredients[row.token].section || row.section;
        if (!ingredientSections.includes(row.section)) {
          ingredientSections.push(row.section);
        }
      }
      if (row.line_group) {
        ingredients[row.token].line_group = row.line_group;
      }
      if (dependency) {
        ingredients[row.token].depends_on = dependency;
      }
    }

    for (const token of Object.keys(ingredients)) {
      const options = ingredients[token].options.filter((opt) => opt.option);
      ingredients[token].isChoice = options.length >= 2 || (options.length === ingredients[token].options.length && options.length > 0);
    }

    const choices = {};
    for (const row of choiceRows) {
      choices[row.token] = {
        token: row.token,
        label: row.label,
        default_option: row.default_option,
      };
    }

    const pansPath = path.join(baseDir, 'pans.csv');
    let panSizes = [];
    let defaultPanId = null;
    if (fs.existsSync(pansPath)) {
      const panRows = await parseCSVFile(pansPath);
      panSizes = panRows
        .map((row) => {
          const catalogEntry = panCatalog.get(row.id);
          if (!catalogEntry) {
            console.warn(`Unknown pan id "${row.id}" in ${recipeId}; skipping.`);
            return null;
          }
          return {
            ...catalogEntry,
            label: row.label || catalogEntry.label,
            is_default: parseBoolean(row.default),
          };
        })
        .filter(Boolean);
      const defaultPan = panSizes.find((p) => p.is_default) || panSizes[0];
      defaultPanId = defaultPan?.id || null;
    }

    const compatibility = computeCompatibility(ingredients, catalog);
    const uniqueTokenOrder = [];
    const seen = new Set();
    tokensUsed.forEach((token) => {
      if (!seen.has(token)) {
        uniqueTokenOrder.push(token);
        seen.add(token);
      }
    });

    const stepSections = [];
    steps.forEach((step) => {
      if (step.section && !stepSections.includes(step.section)) {
        stepSections.push(step.section);
      }
    });

    recipeOutputs.push({
      id: meta.id,
      title: meta.title,
      byline: meta.byline || '',
      base_kind: meta.base_kind,
      default_base: Number(meta.default_base) || 1,
      categories: parseCategories(meta.categories),
      family: meta.family || '',
      notes: meta.notes,
      steps_raw: stepsRaw,
      steps,
      step_sections: stepSections,
      tokens_used: tokensUsed,
      token_order: uniqueTokenOrder,
      ingredients,
      ingredient_sections: ingredientSections,
      choices,
      pan_sizes: panSizes,
      default_pan: defaultPanId,
      compatibility_possible: compatibility,
    });

    indexList.push({
      id: meta.id,
      title: meta.title,
      byline: meta.byline || '',
      categories: parseCategories(meta.categories),
      family: meta.family || '',
      compatibility_possible: compatibility,
    });
  }

  const builtDir = path.join(process.cwd(), 'docs', 'built');
  if (!fs.existsSync(builtDir)) {
    fs.mkdirSync(builtDir, { recursive: true });
  }
  fs.writeFileSync(path.join(builtDir, 'recipes.json'), JSON.stringify(recipeOutputs, null, 2));
  fs.writeFileSync(path.join(builtDir, 'index.json'), JSON.stringify(indexList, null, 2));
  console.log('Build completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
