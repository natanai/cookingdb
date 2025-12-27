import fs from 'fs';
import path from 'path';
import { convertUnitAmountWithFactors } from '../docs/unit-conversions.js';
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
      nutrition_unit: row.nutrition_unit || '',
      calories_per_unit: row.calories_per_unit || '',
      nutrition_source: row.nutrition_source || '',
      nutrition_notes: row.nutrition_notes || '',
      serving_size: row.serving_size || '',
      protein_g: row.protein_g || '',
      total_fat_g: row.total_fat_g || '',
      saturated_fat_g: row.saturated_fat_g || '',
      total_carbs_g: row.total_carbs_g || '',
      sugars_g: row.sugars_g || '',
      fiber_g: row.fiber_g || '',
      sodium_mg: row.sodium_mg || '',
      calcium_mg: row.calcium_mg || '',
      iron_mg: row.iron_mg || '',
      potassium_mg: row.potassium_mg || '',
      vitamin_c_mg: row.vitamin_c_mg || '',
      grams_per_count: row.grams_per_count || '',
      tsp_per_sprig: row.tsp_per_sprig || '',
      grams_per_cup: row.grams_per_cup || '',
    });
  }
  return map;
}

function loadIngredientNutritionFromCatalog(catalogPath) {
  if (!fs.existsSync(catalogPath)) return new Map();
  const rows = fs.readFileSync(catalogPath, 'utf-8');
  const parsed = rows ? simpleParseCSV(rows) : [];
  const map = new Map();
  for (const row of parsed) {
    if (!row.ingredient_id || !row.nutrition_unit) continue;
    const calories = Number(row.calories_per_unit);
    const gramsPerCount = Number(row.grams_per_count);
    const tspPerSprig = Number(row.tsp_per_sprig);
    const gramsPerCup = Number(row.grams_per_cup);
    map.set(`${row.ingredient_id}::${row.nutrition_unit}`, {
      ingredient_id: row.ingredient_id,
      unit: row.nutrition_unit,
      calories_per_unit: Number.isFinite(calories) ? calories : null,
      source: row.nutrition_source || '',
      notes: row.nutrition_notes || '',
      conversions: {
        grams_per_count: Number.isFinite(gramsPerCount) && gramsPerCount > 0 ? gramsPerCount : null,
        tsp_per_sprig: Number.isFinite(tspPerSprig) && tspPerSprig > 0 ? tspPerSprig : null,
        grams_per_cup: Number.isFinite(gramsPerCup) && gramsPerCup > 0 ? gramsPerCup : null,
      },
    });
  }
  return map;
}

function buildNutritionIndex(nutritionCatalog) {
  const index = new Map();
  for (const entry of nutritionCatalog.values()) {
    if (!entry?.ingredient_id) continue;
    if (!index.has(entry.ingredient_id)) {
      index.set(entry.ingredient_id, []);
    }
    index.get(entry.ingredient_id).push(entry);
  }
  return index;
}

function loadNutritionGuidelines(guidelinesPath) {
  if (!fs.existsSync(guidelinesPath)) {
    return { meal_calories_target: 600 };
  }
  try {
    const raw = fs.readFileSync(guidelinesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed || { meal_calories_target: 600 };
  } catch (err) {
    console.warn(`Unable to read nutrition guidelines at ${guidelinesPath}: ${err?.message || err}`);
    return { meal_calories_target: 600 };
  }
}

function loadNutritionPolicy(policyPath, guidelinesPath) {
  if (fs.existsSync(policyPath)) {
    try {
      const raw = fs.readFileSync(policyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
      console.warn(`Unable to read nutrition policy at ${policyPath}: ${err?.message || err}`);
    }
  }
  const guidelines = loadNutritionGuidelines(guidelinesPath);
  return {
    default_daily_kcal: Number(guidelines?.meal_calories_target) * 3 || 1800,
    default_meals_per_day: 3,
    meal_fractions_default: { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 },
  };
}

function parseRatioToNumber(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(' ');
  let whole = 0;
  let frac = parts[0];
  if (parts.length === 2) {
    whole = Number(parts[0]);
    frac = parts[1];
  }
  let num;
  let den;
  if (frac.includes('/')) {
    const [n, d] = frac.split('/');
    num = Number(n);
    den = Number(d);
  } else {
    num = Number(frac);
    den = 1;
  }
  if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return whole + num / den;
}

function parseNumericField(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const UNIT_ALIASES = new Map([
  ['cloves', 'clove'],
  ['medium', 'count'],
  ['large', 'count'],
  ['small', 'count'],
  ['piece', 'count'],
  ['package', 'count'],
  ['bag', 'count'],
  ['bunch', 'count'],
  ['sprig', 'count'],
  ['can', 'count'],
  ['dash', 'tsp'],
  ['drop', 'tsp'],
]);

function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
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

function selectDefaultOption(tokenData, choice) {
  if (!tokenData?.options?.length) return null;
  if (!tokenData.isChoice) return tokenData.options[0];
  const preferred = choice?.default_option;
  if (preferred) {
    return tokenData.options.find((opt) => opt.option === preferred) || tokenData.options[0];
  }
  const withOption = tokenData.options.find((opt) => opt.option);
  return withOption || tokenData.options[0];
}

function buildNutritionProfile(entry) {
  if (!entry) return null;
  return {
    unit: entry.nutrition_unit || '',
    calories_per_unit: parseNumericField(entry.calories_per_unit),
    protein_g: parseNumericField(entry.protein_g),
    total_fat_g: parseNumericField(entry.total_fat_g),
    saturated_fat_g: parseNumericField(entry.saturated_fat_g),
    total_carbs_g: parseNumericField(entry.total_carbs_g),
    sugars_g: parseNumericField(entry.sugars_g),
    fiber_g: parseNumericField(entry.fiber_g),
    sodium_mg: parseNumericField(entry.sodium_mg),
    conversions: {
      grams_per_count: (() => {
        const gramsPerCount = parseNumericField(entry.grams_per_count);
        return Number.isFinite(gramsPerCount) && gramsPerCount > 0 ? gramsPerCount : null;
      })(),
      tsp_per_sprig: (() => {
        const tspPerSprig = parseNumericField(entry.tsp_per_sprig);
        return Number.isFinite(tspPerSprig) && tspPerSprig > 0 ? tspPerSprig : null;
      })(),
      grams_per_cup: (() => {
        const gramsPerCup = parseNumericField(entry.grams_per_cup);
        return Number.isFinite(gramsPerCup) && gramsPerCup > 0 ? gramsPerCup : null;
      })(),
    },
  };
}

function computeNutritionEstimate(ingredients, choices, nutritionCatalog, nutritionIndex, guidelines, policy) {
  const defaultDailyKcal = Number(policy?.default_daily_kcal);
  const defaultFractions = policy?.meal_fractions_default || null;
  const fallbackTarget = Number(guidelines?.meal_calories_target) || 600;
  const fraction =
    defaultFractions && typeof defaultFractions === 'object'
      ? (Number(defaultFractions.dinner) || Number(Object.values(defaultFractions)[0]) || 1 / 3)
      : 1 / 3;
  const targetMealCalories =
    (Number.isFinite(defaultDailyKcal) && defaultDailyKcal > 0 ? defaultDailyKcal * fraction : null) ||
    fallbackTarget;
  let totalCalories = 0;
  let covered = 0;
  let totalIngredients = 0;
  const tokens = Object.keys(ingredients || {});
  tokens.forEach((token) => {
    const tokenData = ingredients[token];
    const option = selectDefaultOption(tokenData, choices[token]);
    if (!option || !option.ratio || !option.unit) return;
    totalIngredients += 1;
    const amount = parseRatioToNumber(option.ratio);
    if (!Number.isFinite(amount)) return;
    const normalizedUnit = normalizeUnit(option.unit);
    if (!normalizedUnit) return;
    let caloriesForOption = null;
    const directEntry = nutritionCatalog.get(`${option.ingredient_id}::${normalizedUnit}`);
    if (directEntry && Number.isFinite(directEntry.calories_per_unit)) {
      caloriesForOption = amount * directEntry.calories_per_unit;
    } else {
      const entries = nutritionIndex.get(option.ingredient_id) || [];
      for (const entry of entries) {
        if (!Number.isFinite(entry.calories_per_unit)) continue;
        const conversion = convertUnitAmountWithFactors(amount, normalizedUnit, entry.unit, entry.conversions);
        if (!conversion) continue;
        caloriesForOption = conversion.amount * entry.calories_per_unit;
        break;
      }
    }
    if (!Number.isFinite(caloriesForOption)) return;
    totalCalories += caloriesForOption;
    covered += 1;
  });

  if (totalCalories <= 0) {
    return {
      calories_total: 0,
      calories_per_serving: null,
      servings_estimate: null,
      covered_ingredients: covered,
      total_ingredients: totalIngredients,
      coverage_ratio: totalIngredients ? covered / totalIngredients : 0,
      target_meal_calories: targetMealCalories,
    };
  }

  const servingsEstimate = Math.max(1, Math.round(totalCalories / targetMealCalories));
  return {
    calories_total: totalCalories,
    calories_per_serving: totalCalories / servingsEstimate,
    servings_estimate: servingsEstimate,
    covered_ingredients: covered,
    total_ingredients: totalIngredients,
    coverage_ratio: totalIngredients ? covered / totalIngredients : 0,
    target_meal_calories: targetMealCalories,
  };
}

async function build() {
  await validateAll();
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  const catalog = loadIngredientCatalog(catalogPath);
  const nutritionCatalog = loadIngredientNutritionFromCatalog(catalogPath);
  const nutritionGuidelines = loadNutritionGuidelines(path.join(process.cwd(), 'data', 'nutrition_guidelines.json'));
  const nutritionPolicy = loadNutritionPolicy(
    path.join(process.cwd(), 'data', 'nutrition_policy.json'),
    path.join(process.cwd(), 'data', 'nutrition_guidelines.json')
  );
  const panCatalog = loadPanCatalog(path.join(process.cwd(), 'data', 'pan-sizes.json'));
  const nutritionIndex = buildNutritionIndex(nutritionCatalog);
  const recipesDir = path.join(process.cwd(), 'recipes');
  const recipeDirs = fs.readdirSync(recipesDir, { withFileTypes: true }).filter((ent) => ent.isDirectory());

  const recipeOutputs = [];
  const indexList = [];
  const coverageIssues = [];

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
      const nutritionProfile = buildNutritionProfile(flags);
      const dependency = row.depends_on_token
        ? { token: row.depends_on_token, option: row.depends_on_option || null }
        : null;
      const optionEntry = {
        option: row.option,
        display: row.display,
        ratio: row.ratio,
        unit: row.unit,
        ingredient_id: row.ingredient_id,
        prep: row.prep || '',
        depends_on: dependency,
        line_group: row.line_group || null,
        section: row.section || null,
        dietary: {
          gluten_free: ingredientCompatible(flags, 'gluten_free'),
          egg_free: ingredientCompatible(flags, 'egg_free'),
          dairy_free: ingredientCompatible(flags, 'dairy_free'),
        },
        nutrition: nutritionProfile,
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
    const nutritionEstimate = computeNutritionEstimate(
      ingredients,
      choices,
      nutritionCatalog,
      nutritionIndex,
      nutritionGuidelines,
      nutritionPolicy
    );
    if (nutritionEstimate.coverage_ratio < 1) {
      coverageIssues.push({
        id: meta.id,
        covered: nutritionEstimate.covered_ingredients,
        total: nutritionEstimate.total_ingredients,
      });
    }
    const metaServingsPerBatch = Number(meta.servings_per_batch);
    const servingsPerBatch =
      (Number.isFinite(metaServingsPerBatch) && metaServingsPerBatch > 0 ? metaServingsPerBatch : null) ||
      (Number.isFinite(nutritionEstimate.servings_estimate) && nutritionEstimate.servings_estimate > 0
        ? nutritionEstimate.servings_estimate
        : null) ||
      4;
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
      servings_per_batch: servingsPerBatch,
      categories: parseCategories(meta.categories),
      family: meta.family || '',
      notes: meta.notes,
      nutrition_estimate: nutritionEstimate,
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

  if (coverageIssues.length > 0) {
    const lines = coverageIssues
      .map((entry) => `- ${entry.id}: ${entry.covered}/${entry.total} ingredients covered`)
      .join('\n');
    throw new Error(`Nutrition coverage incomplete. Fix ingredient conversions or nutrition data:\n${lines}`);
  }

  const builtDir = path.join(process.cwd(), 'docs', 'built');
  if (!fs.existsSync(builtDir)) {
    fs.mkdirSync(builtDir, { recursive: true });
  }
  fs.writeFileSync(path.join(builtDir, 'nutrition-policy.json'), JSON.stringify(nutritionPolicy, null, 2));
  fs.writeFileSync(path.join(builtDir, 'nutrition-guidelines.json'), JSON.stringify(nutritionGuidelines, null, 2));
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
