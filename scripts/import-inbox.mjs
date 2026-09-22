import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BUNDLE_FORMAT = 'cookingdb-recipe-import';
const BUNDLE_VERSION = 1;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = [...argv];
  let inputPath = '';
  let reportPath = '';
  let dryRun = false;

  while (args.length) {
    const arg = args.shift();
    if (arg === '--report') {
      reportPath = args.shift() || '';
      if (!reportPath) fail('--report requires a file path');
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}`);
    } else if (!inputPath) {
      inputPath = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!inputPath) {
    fail('Usage: node scripts/import-inbox.mjs <export.json> [--report <report.json>] [--dry-run]');
  }

  return { inputPath, reportPath, dryRun };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (quoted) fail('Malformed CSV: unterminated quoted field');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  );
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers, rows) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\n')}\n`;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingParenthetical(text) {
  return String(text || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function humanizeToken(token) {
  return String(token || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function addAlias(map, key, ingredientId) {
  if (!key || !ingredientId) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ingredientId);
}

function buildIngredientResolver(rootDir) {
  const catalogPath = path.join(rootDir, 'data', 'ingredient_catalog.csv');
  if (!fs.existsSync(catalogPath)) fail(`Missing ingredient catalog: ${catalogPath}`);
  const catalogRows = rowsToObjects(parseCsv(fs.readFileSync(catalogPath, 'utf8')));
  const ids = new Set();
  const aliases = new Map();

  catalogRows.forEach((row) => {
    const id = String(row.ingredient_id || '').trim();
    const name = String(row.canonical_name || '').trim();
    if (!id) return;
    ids.add(id);
    addAlias(aliases, normalizeText(name), id);
    addAlias(aliases, slugify(name), id);
    addAlias(aliases, normalizeText(id), id);
  });

  const recipesDir = path.join(rootDir, 'recipes');
  if (fs.existsSync(recipesDir)) {
    fs.readdirSync(recipesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        const ingredientsPath = path.join(recipesDir, entry.name, 'ingredients.csv');
        if (!fs.existsSync(ingredientsPath)) return;
        const rows = rowsToObjects(parseCsv(fs.readFileSync(ingredientsPath, 'utf8')));
        rows.forEach((row) => {
          const id = String(row.ingredient_id || '').trim();
          const display = String(row.display || '').trim();
          if (!id || !ids.has(id) || !display) return;
          const baseDisplay = stripTrailingParenthetical(display);
          addAlias(aliases, normalizeText(display), id);
          addAlias(aliases, normalizeText(baseDisplay), id);
          addAlias(aliases, slugify(display), id);
          addAlias(aliases, slugify(baseDisplay), id);
        });
      });
  }

  return { ids, aliases };
}

function resolveIngredientId(option, resolver, context) {
  const provided = String(option?.ingredient_id || '').trim();
  if (provided && resolver.ids.has(provided)) return provided;

  const display = String(option?.display || '').trim();
  const baseDisplay = stripTrailingParenthetical(display);
  const keys = [
    provided,
    normalizeText(display),
    normalizeText(baseDisplay),
    slugify(display),
    slugify(baseDisplay),
  ].filter(Boolean);
  const candidates = new Set();

  keys.forEach((key) => {
    const matches = resolver.aliases.get(key);
    if (matches) matches.forEach((id) => candidates.add(id));
  });

  if (candidates.size === 1) return [...candidates][0];
  if (candidates.size > 1) {
    fail(
      `${context}: ingredient “${display}” maps to multiple catalog IDs (${[...candidates].join(', ')}). Choose a canonical ingredient before publishing.`
    );
  }
  fail(
    `${context}: ingredient “${display || provided || 'unknown'}” needs catalog review before publishing. Add or map it in data/ingredient_catalog.csv, then publish again.`
  );
}

function unwrapRecipe(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.recipe && typeof item.recipe === 'object') return item.recipe;
  if (item.payload && typeof item.payload === 'object') {
    if (item.payload.payload && typeof item.payload.payload === 'object') return item.payload.payload;
    if (item.payload.recipe && typeof item.payload.recipe === 'object') return item.payload.recipe;
    return item.payload;
  }
  return item;
}

function normalizeImportRecords(data) {
  if (!data || typeof data !== 'object') fail('Import file must contain a JSON object.');
  if (data.format && data.format !== BUNDLE_FORMAT) fail(`Unsupported import format: ${data.format}`);
  if (data.format === BUNDLE_FORMAT && Number(data.version) !== BUNDLE_VERSION) {
    fail(`Unsupported ${BUNDLE_FORMAT} version: ${data.version}`);
  }

  const items = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.pending)
      ? data.pending
      : Array.isArray(data.recipes)
        ? data.recipes
        : [];

  return items.map((item, index) => {
    const recipe = unwrapRecipe(item);
    if (!recipe || typeof recipe !== 'object') fail(`Item ${index + 1} is missing a recipe payload.`);
    const recipeId = String(
      recipe.id ||
        recipe.recipe_id ||
        item.recipe_id ||
        item.slug ||
        (typeof item.id === 'string' ? item.id : '')
    ).trim();
    const inboxId = Number.isInteger(item.inbox_id)
      ? item.inbox_id
      : Number.isInteger(item.id)
        ? item.id
        : null;
    return { inboxId, recipe: { ...recipe, id: recipeId || recipe.id } };
  });
}

function normalizeIngredients(recipe) {
  if (Array.isArray(recipe.ingredients)) {
    return Object.fromEntries(
      recipe.ingredients.filter((entry) => entry?.token).map((entry) => [entry.token, entry])
    );
  }
  return recipe.ingredients && typeof recipe.ingredients === 'object' ? recipe.ingredients : {};
}

function normalizeChoices(recipe) {
  if (Array.isArray(recipe.choices)) {
    return Object.fromEntries(
      recipe.choices.filter((entry) => entry?.token).map((entry) => [entry.token, entry])
    );
  }
  return recipe.choices && typeof recipe.choices === 'object' ? recipe.choices : {};
}

function normalizeSteps(recipe) {
  if (Array.isArray(recipe.steps) && recipe.steps.length) {
    return recipe.steps.map((step) => ({
      section: step?.section || '',
      text: String(step?.text || '').trim(),
    }));
  }

  const raw = String(recipe.steps_raw || '').trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ section: '', text: line.replace(/^\d+\.\s*/, '') }));
}

function parseCategories(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeRecipeFiles(recipe, resolver) {
  const id = String(recipe.id || '').trim();
  if (!id || !/^[a-z0-9_-]+$/.test(id)) fail(`Recipe has an invalid id: “${id || '(blank)'}”.`);

  const title = String(recipe.title || '').trim();
  if (!title) fail(`${id}: missing title.`);

  const categories = parseCategories(recipe.categories);
  if (!categories.length) fail(`${id}: at least one category is required.`);

  const defaultBase = Number(recipe.default_base ?? 1);
  if (!Number.isFinite(defaultBase) || defaultBase <= 0) {
    fail(`${id}: default_base must be a positive number.`);
  }

  const servings =
    recipe.servings_per_batch == null || recipe.servings_per_batch === ''
      ? ''
      : Number(recipe.servings_per_batch);
  if (servings !== '' && (!Number.isFinite(servings) || servings <= 0)) {
    fail(`${id}: servings_per_batch must be a positive number when provided.`);
  }

  const ingredientMap = normalizeIngredients(recipe);
  const initialOrder = Array.isArray(recipe.token_order) ? recipe.token_order.map(String) : [];
  const tokenOrder = [...new Set([...initialOrder, ...Object.keys(ingredientMap)])].filter(
    (token) => ingredientMap[token]
  );
  if (!tokenOrder.length) fail(`${id}: no ingredients were found.`);

  const ingredientRows = [];
  const optionsByToken = new Map();

  tokenOrder.forEach((token) => {
    const entry = ingredientMap[token] || {};
    const options = Array.isArray(entry.options) ? entry.options : [];
    if (!options.length) fail(`${id}/${token}: no ingredient options were found.`);

    const optionKeys = [];
    options.forEach((option, optionIndex) => {
      const display = String(option?.display || '').trim();
      const ratio = String(option?.ratio ?? '').trim();
      const unit = String(option?.unit || '').trim();
      if (!display) {
        fail(`${id}/${token}: ingredient option ${optionIndex + 1} is missing display text.`);
      }
      if (!unit) fail(`${id}/${token}: ingredient “${display}” is missing a unit.`);

      const optionKey = String(option?.option || '').trim();
      if (optionKey) optionKeys.push(optionKey);

      const dependency = option?.depends_on || entry.depends_on || null;
      const ingredientId = resolveIngredientId(option, resolver, `${id}/${token}`);
      ingredientRows.push({
        token,
        option: optionKey,
        display,
        ratio,
        unit,
        ingredient_id: ingredientId,
        prep: String(option?.prep || '').trim(),
        depends_on_token: String(dependency?.token || '').trim(),
        depends_on_option: String(dependency?.option || '').trim(),
        line_group: String(option?.line_group ?? entry.line_group ?? '').trim(),
        section: String(option?.section ?? entry.section ?? '').trim(),
      });
    });

    optionsByToken.set(token, [...new Set(optionKeys)]);
  });

  const steps = normalizeSteps(recipe);
  if (!steps.length || steps.some((step) => !step.text)) {
    fail(`${id}: at least one non-empty step is required.`);
  }

  const choices = normalizeChoices(recipe);
  const choiceRows = [];
  optionsByToken.forEach((optionKeys, token) => {
    if (optionKeys.length < 2) return;

    const supplied = choices[token] || {};
    const defaultOption = String(supplied.default_option || optionKeys[0]).trim();
    if (!optionKeys.includes(defaultOption)) {
      fail(
        `${id}/${token}: default choice “${defaultOption}” is not one of ${optionKeys.join(', ')}.`
      );
    }

    choiceRows.push({
      token,
      label: String(supplied.label || humanizeToken(token)).trim(),
      default_option: defaultOption,
    });
  });

  const metaHeaders = [
    'id',
    'title',
    'byline',
    'base_kind',
    'default_base',
    'servings_per_batch',
    'notes',
    'categories',
    'family',
    'default_pan',
  ];
  const metaRows = [
    {
      id,
      title,
      byline: String(recipe.byline || '').trim(),
      base_kind: String(recipe.base_kind || 'multiplier').trim() || 'multiplier',
      default_base: defaultBase,
      servings_per_batch: servings,
      notes: String(recipe.notes || ''),
      categories: categories.join('; '),
      family: String(recipe.family || '').trim(),
      default_pan: String(recipe.default_pan || '').trim(),
    },
  ];

  const files = new Map();
  files.set('meta.csv', toCsv(metaHeaders, metaRows));
  files.set(
    'ingredients.csv',
    toCsv(
      [
        'token',
        'option',
        'display',
        'ratio',
        'unit',
        'ingredient_id',
        'prep',
        'depends_on_token',
        'depends_on_option',
        'line_group',
        'section',
      ],
      ingredientRows
    )
  );
  files.set('steps.csv', toCsv(['section', 'text'], steps));
  if (choiceRows.length) {
    files.set('choices.csv', toCsv(['token', 'label', 'default_option'], choiceRows));
  }

  return { id, files };
}

function compareExistingRecipe(recipeDir, files) {
  if (!fs.existsSync(recipeDir)) return { exists: false, identical: false };
  if (!fs.statSync(recipeDir).isDirectory()) fail(`${recipeDir} exists but is not a directory.`);

  for (const [name, content] of files) {
    const target = path.join(recipeDir, name);
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      return { exists: true, identical: false };
    }
  }

  const expectedNames = new Set(files.keys());
  for (const name of ['meta.csv', 'ingredients.csv', 'steps.csv', 'choices.csv']) {
    if (!expectedNames.has(name) && fs.existsSync(path.join(recipeDir, name))) {
      return { exists: true, identical: false };
    }
  }

  return { exists: true, identical: true };
}

function writeReport(reportPath, report) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export function importInbox({
  inputPath,
  reportPath = '',
  dryRun = false,
  rootDir = process.cwd(),
}) {
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const records = normalizeImportRecords(input);
  const resolver = buildIngredientResolver(rootDir);
  const seenIds = new Set();
  const planned = [];

  records.forEach(({ inboxId, recipe }) => {
    const built = makeRecipeFiles(recipe, resolver);
    if (seenIds.has(built.id)) fail(`Import contains duplicate recipe id: ${built.id}`);
    seenIds.add(built.id);

    const recipeDir = path.join(rootDir, 'recipes', built.id);
    const existing = compareExistingRecipe(recipeDir, built.files);
    if (existing.exists && !existing.identical) {
      fail(
        `${built.id}: recipes/${built.id} already exists with different content. The importer will not overwrite it.`
      );
    }

    planned.push({
      inboxId,
      recipeDir,
      ...built,
      alreadyPresent: existing.identical,
    });
  });

  if (!dryRun) {
    planned
      .filter((entry) => !entry.alreadyPresent)
      .forEach((entry) => {
        fs.mkdirSync(entry.recipeDir, { recursive: false });
        entry.files.forEach((content, name) => {
          fs.writeFileSync(path.join(entry.recipeDir, name), content);
        });
      });
  }

  const report = {
    format: 'cookingdb-import-report',
    version: 1,
    source_file: path.basename(inputPath),
    dry_run: dryRun,
    processed: planned.length,
    created_recipe_ids: planned
      .filter((entry) => !entry.alreadyPresent)
      .map((entry) => entry.id),
    already_present_recipe_ids: planned
      .filter((entry) => entry.alreadyPresent)
      .map((entry) => entry.id),
    inbox_ids: planned.map((entry) => entry.inboxId).filter(Number.isInteger),
  };

  writeReport(reportPath, report);
  return report;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = importInbox(options);

    if (report.processed === 0) {
      console.log('No pending recipes to import.');
    } else {
      console.log(
        `Processed ${report.processed} recipe${report.processed === 1 ? '' : 's'}.`
      );
      if (report.created_recipe_ids.length) {
        console.log(`Created: ${report.created_recipe_ids.join(', ')}`);
      }
      if (report.already_present_recipe_ids.length) {
        console.log(
          `Already present and identical: ${report.already_present_recipe_ids.join(', ')}`
        );
      }
      if (options.dryRun) console.log('Dry run only; no recipe files were written.');
    }
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
