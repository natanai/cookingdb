import { parseRatioToNumber, selectNutritionVariant, selectVariantWithFactor, selectVariantWithPortion, buildIngredientNutritionVariantsFromCatalog, buildIngredientUnitFactorsFromCatalog, buildIngredientPortionsFromCatalog, selectDefaultOption, generateNutritionCoverageReport, coverageReportCSV } from './lib/nutrition-coverage.mjs';
import { parseCSV, parseCSVFile } from './lib/csv.mjs';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { normalizeUnit, unitDefinition, convertUnitAmount } from '../docs/unit-conversions.js';
import { validateAll } from './validate.mjs';

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

function loadIngredientCatalogRows(catalogPath) {
  const rows = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf-8') : '';
  return rows ? parseCSV(rows, catalogPath) : [];
}

function buildIngredientCatalog(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row?.ingredient_id) return;
    if (map.has(row.ingredient_id)) return;
    map.set(row.ingredient_id, {
      contains_gluten: row.contains_gluten === 'true',
      contains_egg: row.contains_egg === 'true',
      contains_dairy: row.contains_dairy === 'true',
      canonical_name: row.canonical_name,
    });
  });
  return map;
}

function loadNutritionGuidelines(guidelinesPath) {
  if (!fs.existsSync(guidelinesPath)) {
    return {
      daily_calories_default: 2000,
      meals_per_day_default: 3,
      daily_sodium_mg_default: 2300,
      daily_saturated_fat_g_default: 20,
      serving_targets: {
        calories_kcal: 'daily_calories_default / meals_per_day_default',
        sodium_mg: 'daily_sodium_mg_default / meals_per_day_default',
        saturated_fat_g: 'daily_saturated_fat_g_default / meals_per_day_default',
      },
    };
  }
  try {
    const raw = fs.readFileSync(guidelinesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed || {
      daily_calories_default: 2000,
      meals_per_day_default: 3,
      daily_sodium_mg_default: 2300,
      daily_saturated_fat_g_default: 20,
      serving_targets: {
        calories_kcal: 'daily_calories_default / meals_per_day_default',
        sodium_mg: 'daily_sodium_mg_default / meals_per_day_default',
        saturated_fat_g: 'daily_saturated_fat_g_default / meals_per_day_default',
      },
    };
  } catch (err) {
    console.warn(`Unable to read nutrition guidelines at ${guidelinesPath}: ${err?.message || err}`);
    return {
      daily_calories_default: 2000,
      meals_per_day_default: 3,
      daily_sodium_mg_default: 2300,
      daily_saturated_fat_g_default: 20,
      serving_targets: {
        calories_kcal: 'daily_calories_default / meals_per_day_default',
        sodium_mg: 'daily_sodium_mg_default / meals_per_day_default',
        saturated_fat_g: 'daily_saturated_fat_g_default / meals_per_day_default',
      },
    };
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
  const defaultDailyCalories = Number(guidelines?.daily_calories_default);
  return {
    default_daily_kcal: (Number.isFinite(defaultDailyCalories) && defaultDailyCalories > 0) ? defaultDailyCalories : 1800,
    default_meals_per_day: Number(guidelines?.meals_per_day_default) || 3,
    meal_fractions_default: { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 },
  };
}

function deriveServingTargets(settings, guidelines) {
  const dailyCalories = Number(settings?.daily_kcal) || Number(guidelines?.daily_calories_default) || 2000;
  const mealsPerDay = Number(guidelines?.meals_per_day_default) || 3;
  const dailySodium = Number(guidelines?.daily_sodium_mg_default) || 2300;
  const dailySatFat = Number(guidelines?.daily_saturated_fat_g_default) || 20;
  const meals = mealsPerDay > 0 ? mealsPerDay : 3;
  return {
    calories_kcal: dailyCalories / meals,
    sodium_mg: dailySodium / meals,
    saturated_fat_g: dailySatFat / meals,
  };
}

function suggestServingsFromTotals(totals, targets) {
  if (!totals || !targets || !Number.isFinite(totals.kcal) || totals.kcal <= 0) return null;
  const candidates = [Math.ceil(totals.kcal / targets.calories_kcal)];
  if (Number.isFinite(totals.sodium_mg) && totals.sodium_mg > 0 && Number.isFinite(targets.sodium_mg)) {
    candidates.push(Math.ceil(totals.sodium_mg / targets.sodium_mg));
  }
  if (Number.isFinite(totals.sat_fat_g) && totals.sat_fat_g > 0 && Number.isFinite(targets.saturated_fat_g)) {
    candidates.push(Math.ceil(totals.sat_fat_g / targets.saturated_fat_g));
  }
  return Math.max(1, ...candidates.filter((value) => Number.isFinite(value) && value > 0));
}

function buildNutritionProfile(entries) {
  if (!entries) return [];
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map((entry) => ({
    serving_qty: Number.isFinite(entry.serving_qty) ? entry.serving_qty : 1,
    serving_unit_norm: entry.serving_unit_norm || null,
    calories_kcal: entry.calories_kcal ?? null,
    protein_g: entry.protein_g ?? null,
    total_fat_g: entry.total_fat_g ?? null,
    saturated_fat_g: entry.saturated_fat_g ?? null,
    total_carbs_g: entry.total_carbs_g ?? null,
    sugars_g: entry.sugars_g ?? null,
    fiber_g: entry.fiber_g ?? null,
    sodium_mg: entry.sodium_mg ?? null,
    calcium_mg: entry.calcium_mg ?? null,
    iron_mg: entry.iron_mg ?? null,
    potassium_mg: entry.potassium_mg ?? null,
    vitamin_c_mg: entry.vitamin_c_mg ?? null,
    source: entry.source || '',
    notes: entry.notes || '',
  }));
}

function assertVolumeConversions() {
  const checks = [
    ['tsp', 5],
    ['tbsp', 15],
    ['cup', 240],
    ['pint', 480],
  ];
  const tolerance = 1e-6;
  checks.forEach(([unit, expected]) => {
    const converted = convertUnitAmount(1, unit, 'ml');
    if (!converted || !Number.isFinite(converted.amount)) {
      throw new Error(`Unit conversion failed for ${unit} -> ml`);
    }
    if (Math.abs(converted.amount - expected) > tolerance) {
      throw new Error(`Unit conversion ${unit} -> ml expected ${expected} got ${converted.amount}`);
    }
  });
}

function loadPanCatalog(catalogPath) {
  const raw = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf-8') : '';
  if (!raw) return { panCatalog: new Map(), panList: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse pan catalog at ${catalogPath}: ${err?.message || err}`);
  }
  const map = new Map();
  const list = [];
  parsed.forEach((entry) => {
    if (!entry?.id) return;
    const normalized = {
      id: entry.id,
      label: entry.label || entry.id,
      shape: (entry.shape || 'rectangle').toLowerCase(),
      width: Number(entry.width),
      height: entry.height === null || entry.height === undefined ? null : Number(entry.height),
      unit: entry.unit || 'in',
    };
    map.set(entry.id, normalized);
    list.push(normalized);
  });
  return { panCatalog: map, panList: list };
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

function computeNutritionEstimate(
  ingredients,
  choices,
  nutritionVariants,
  unitFactors,
  ingredientPortions,
  guidelines,
  recipesById = null,
  visited = new Set()
) {
  const targets = deriveServingTargets(null, guidelines);
  let covered = 0;
  const missing = [];
  const totals = {
    kcal: 0,
    sodium_mg: 0,
    sat_fat_g: 0,
  };
  let totalIngredients = 0;
  const tokens = Object.keys(ingredients || {});
  tokens.forEach((token) => {
    const tokenData = ingredients[token];
    const option = selectDefaultOption(tokenData, choices[token]);
    if (!option || !option.ratio || !option.unit) return;
    const amount = parseRatioToNumber(option.ratio);
    if (!Number.isFinite(amount)) return;
    const normalizedUnit = normalizeUnit(option.unit);
    if (!normalizedUnit) return;

    if (normalizedUnit === 'recipe') {
      const recipeId = option.ingredient_id;
      const recipe = recipesById?.get?.(recipeId);
      if (recipe && !visited.has(recipeId)) {
        visited.add(recipeId);
        const nested = computeNutritionEstimate(
          recipe.ingredients,
          recipe.choices,
          nutritionVariants,
          unitFactors,
          ingredientPortions,
          guidelines,
          recipesById,
          visited
        );
        visited.delete(recipeId);
        totals.kcal += amount * (nested.calories_total || 0);
        totals.sodium_mg += amount * (nested.sodium_total_mg || 0);
        totals.sat_fat_g += amount * (nested.sat_fat_total_g || 0);
        covered += nested.covered_ingredients || 0;
        totalIngredients += nested.total_ingredients || 0;
        if (Array.isArray(nested.missing_ingredients)) {
          missing.push(...nested.missing_ingredients);
        }
        return;
      }

      missing.push({ ingredient_id: recipeId, unit: normalizedUnit || option.unit });
      totalIngredients += 1;
      return;
    }

    const variants = nutritionVariants.get(option.ingredient_id) || [];
    const selection = selectNutritionVariant(variants, normalizedUnit, amount);
    let variant = selection.variant;
    let convertedAmount = selection.convertedAmount;

    if (!variant) {
      const factorMatch = selectVariantWithFactor(
        option.ingredient_id,
        amount,
        normalizedUnit,
        variants,
        unitFactors
      );
      variant = factorMatch?.variant || null;
      convertedAmount = factorMatch?.convertedAmount ?? null;
    }

    if (!variant) {
      const portionMatch = selectVariantWithPortion(
        option.ingredient_id,
        amount,
        normalizedUnit,
        variants,
        ingredientPortions
      );
      variant = portionMatch?.variant || null;
      convertedAmount = portionMatch?.convertedAmount ?? null;
    }

    if (!variant || !Number.isFinite(convertedAmount)) {
      missing.push({ ingredient_id: option.ingredient_id, unit: normalizedUnit || option.unit });
      totalIngredients += 1;
      return;
    }

    if (![variant.calories_kcal, variant.sodium_mg, variant.saturated_fat_g].every(Number.isFinite)) {
      missing.push({ ingredient_id: option.ingredient_id, unit: normalizedUnit || option.unit });
      totalIngredients += 1;
      return;
    }

    const servingQty = Number.isFinite(variant.serving_qty) ? variant.serving_qty : 1;
    const multiplier = servingQty ? convertedAmount / servingQty : 0;
    totals.kcal += multiplier * variant.calories_kcal;
    totals.sodium_mg += multiplier * variant.sodium_mg;
    totals.sat_fat_g += multiplier * variant.saturated_fat_g;
    covered += 1;
    totalIngredients += 1;
  });

  const suggestedServings = suggestServingsFromTotals(totals, targets);
  const perServing = suggestedServings
    ? {
        kcal: totals.kcal / suggestedServings,
        sodium_mg: totals.sodium_mg / suggestedServings,
        sat_fat_g: totals.sat_fat_g / suggestedServings,
      }
    : null;

  return {
    calories_total: totals.kcal,
    calories_per_serving: perServing?.kcal ?? null,
    sodium_total_mg: totals.sodium_mg,
    sat_fat_total_g: totals.sat_fat_g,
    servings_estimate: suggestedServings,
    covered_ingredients: covered,
    total_ingredients: totalIngredients,
    coverage_ratio: totalIngredients ? covered / totalIngredients : 0,
    target_meal_calories: targets.calories_kcal,
    missing_ingredients: missing,
  };
}

async function build() {
  assertVolumeConversions();
  await validateAll();
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  const catalogRows = loadIngredientCatalogRows(catalogPath);
  const catalog = buildIngredientCatalog(catalogRows);
  const ingredientPortions = buildIngredientPortionsFromCatalog(catalogRows);
  const nutritionVariants = buildIngredientNutritionVariantsFromCatalog(catalogRows);
  const ingredientUnitFactors = buildIngredientUnitFactorsFromCatalog(catalogRows);
  const nutritionGuidelines = loadNutritionGuidelines(path.join(process.cwd(), 'data', 'nutrition_guidelines.json'));
  const nutritionPolicy = loadNutritionPolicy(
    path.join(process.cwd(), 'data', 'nutrition_policy.json'),
    path.join(process.cwd(), 'data', 'nutrition_guidelines.json')
  );
  const { panCatalog, panList } = loadPanCatalog(path.join(process.cwd(), 'data', 'pan-sizes.json'));
  const recipesDir = path.join(process.cwd(), 'recipes');
  const recipeDirs = fs.readdirSync(recipesDir, { withFileTypes: true }).filter((ent) => ent.isDirectory());

  const recipeOutputs = [];
  const indexList = [];
  const metaServingsPerBatchById = new Map();

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
      const nutritionProfile = buildNutritionProfile(nutritionVariants.get(row.ingredient_id));
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

    let panSizes = [];
    let defaultPanId = String(meta.default_pan || '').trim() || null;
    if (defaultPanId) {
      if (!panCatalog.has(defaultPanId)) {
        console.warn(`Unknown default pan id "${defaultPanId}" in ${recipeId}; disabling pan scaling.`);
        defaultPanId = null;
      } else {
        panSizes = panList.map((pan) => ({
          ...pan,
          is_default: pan.id === defaultPanId,
        }));
      }
    }

    const compatibility = computeCompatibility(ingredients, catalog);
    const metaServingsPerBatchRaw = Number(meta.servings_per_batch);
    const metaServingsPerBatch =
      Number.isFinite(metaServingsPerBatchRaw) && metaServingsPerBatchRaw > 0 ? metaServingsPerBatchRaw : null;
    metaServingsPerBatchById.set(meta.id, metaServingsPerBatch);
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
      nutrition_estimate: null,
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
      servings_per_batch: null,
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

  const recipesById = new Map(recipeOutputs.map((recipe) => [recipe.id, recipe]));
  recipeOutputs.forEach((recipe) => {
    const nutritionEstimate = computeNutritionEstimate(
      recipe.ingredients,
      recipe.choices,
      nutritionVariants,
      ingredientUnitFactors,
      ingredientPortions,
      nutritionGuidelines,
      recipesById
    );
    const metaServingsPerBatch = metaServingsPerBatchById.get(recipe.id);
    const servingsPerBatch =
      Number.isFinite(metaServingsPerBatch) && metaServingsPerBatch > 0 ? metaServingsPerBatch : null;
    recipe.nutrition_estimate = nutritionEstimate;
    recipe.servings_per_batch = servingsPerBatch;
  });

  const ingredientAutocompleteMap = new Map();
  const addIngredientAutocompleteEntry = (label, ingredientId, unit = '') => {
    const cleanLabel = String(label || '').trim();
    const cleanId = String(ingredientId || '').trim();
    if (!cleanLabel || !cleanId) return;
    const key = cleanLabel.toLocaleLowerCase();
    if (ingredientAutocompleteMap.has(key)) return;
    const flags = catalog.get(cleanId);
    ingredientAutocompleteMap.set(key, {
      label: cleanLabel,
      ingredient_id: cleanId,
      unit: String(unit || '').trim(),
      dietary: flags
        ? {
            gluten_free: ingredientCompatible(flags, 'gluten_free'),
            egg_free: ingredientCompatible(flags, 'egg_free'),
            dairy_free: ingredientCompatible(flags, 'dairy_free'),
          }
        : null,
    });
  };

  catalogRows.forEach((row) => {
    addIngredientAutocompleteEntry(row.canonical_name, row.ingredient_id, row.serving_unit_norm);
  });

  recipeOutputs.forEach((recipe) => {
    Object.values(recipe.ingredients || {}).forEach((tokenData) => {
      (tokenData.options || []).forEach((option) => {
        addIngredientAutocompleteEntry(option.display, option.ingredient_id, option.unit);
      });
    });
  });

  const ingredientAutocomplete = [...ingredientAutocompleteMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  const authoringCategorySet = new Set();
  const authoringSectionSet = new Set();
  const authoringUnitSet = new Set();
  const unitFrequencyByIngredient = new Map();

  recipeOutputs.forEach((recipe) => {
    (recipe.categories || []).forEach((category) => {
      if (category) authoringCategorySet.add(category);
    });

    Object.values(recipe.ingredients || {}).forEach((tokenData) => {
      if (tokenData?.section) authoringSectionSet.add(tokenData.section);
      (tokenData?.options || []).forEach((option) => {
        if (option?.section) authoringSectionSet.add(option.section);
        if (option?.unit) authoringUnitSet.add(option.unit);
        if (!option?.ingredient_id || !option?.unit) return;
        if (!unitFrequencyByIngredient.has(option.ingredient_id)) {
          unitFrequencyByIngredient.set(option.ingredient_id, new Map());
        }
        const counts = unitFrequencyByIngredient.get(option.ingredient_id);
        counts.set(option.unit, (counts.get(option.unit) || 0) + 1);
      });
    });
  });

  const commonUnitsByIngredient = {};
  [...unitFrequencyByIngredient.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([ingredientId, counts]) => {
      const ranked = [...counts.entries()].sort(
        ([unitA, countA], [unitB, countB]) => countB - countA || unitA.localeCompare(unitB)
      );
      if (ranked.length) commonUnitsByIngredient[ingredientId] = ranked[0][0];
    });

  const authoringOptions = {
    categories: [...authoringCategorySet].sort((a, b) => a.localeCompare(b)),
    sections: [...authoringSectionSet].sort((a, b) => a.localeCompare(b)),
    units: [...authoringUnitSet].sort((a, b) => a.localeCompare(b)),
    common_units_by_ingredient: commonUnitsByIngredient,
    recipe_ids: recipeOutputs.map((recipe) => recipe.id).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };

  const builtDir = path.join(process.cwd(), 'docs', 'built');
  if (!fs.existsSync(builtDir)) {
    fs.mkdirSync(builtDir, { recursive: true });
  }
  fs.writeFileSync(path.join(builtDir, 'ingredient-autocomplete.json'), JSON.stringify(ingredientAutocomplete, null, 2));
  fs.writeFileSync(path.join(builtDir, 'authoring-options.json'), JSON.stringify(authoringOptions, null, 2));
  fs.writeFileSync(path.join(builtDir, 'pan-sizes.json'), JSON.stringify(panList, null, 2));
  fs.writeFileSync(path.join(builtDir, 'nutrition-policy.json'), JSON.stringify(nutritionPolicy, null, 2));
  fs.writeFileSync(path.join(builtDir, 'nutrition-guidelines.json'), JSON.stringify(nutritionGuidelines, null, 2));
  fs.writeFileSync(
    path.join(builtDir, 'ingredient-portions.json'),
    JSON.stringify([...ingredientPortions.values()], null, 2)
  );
  fs.writeFileSync(
    path.join(builtDir, 'ingredient-unit-factors.json'),
    JSON.stringify([...ingredientUnitFactors.values()].flat(), null, 2)
  );
  fs.writeFileSync(path.join(builtDir, 'recipes.json'), JSON.stringify(recipeOutputs, null, 2));
  fs.writeFileSync(path.join(builtDir, 'index.json'), JSON.stringify(indexList, null, 2));
  const coverageReport = generateNutritionCoverageReport(
    recipeOutputs,
    nutritionVariants,
    ingredientUnitFactors,
    ingredientPortions,
    recipesById
  );
  fs.writeFileSync(path.join(builtDir, 'nutrition_coverage_report.csv'), coverageReportCSV(coverageReport));
  const strictMode = process.env.NUTRITION_STRICT === '1';
  fs.writeFileSync(
    path.join(builtDir, 'nutrition-coverage.json'),
    JSON.stringify({ missing_count: coverageReport.length, strict: strictMode }, null, 2)
  );

  const versionedBuiltFiles = [
    'authoring-options.json',
    'index.json',
    'ingredient-autocomplete.json',
    'ingredient-portions.json',
    'ingredient-unit-factors.json',
    'nutrition-coverage.json',
    'nutrition-guidelines.json',
    'nutrition-policy.json',
    'pan-sizes.json',
    'recipes.json',
  ];
  const versionHash = createHash('sha256');
  versionedBuiltFiles.forEach((fileName) => {
    versionHash.update(fileName);
    versionHash.update('\0');
    versionHash.update(fs.readFileSync(path.join(builtDir, fileName)));
    versionHash.update('\0');
  });
  const builtDataVersion = versionHash.digest('hex').slice(0, 16);
  fs.writeFileSync(
    path.join(builtDir, 'version.js'),
    `export const BUILT_DATA_VERSION = '${builtDataVersion}';\n`
  );

  if (strictMode && coverageReport.length) {
    throw new Error(`Nutrition coverage incomplete: ${coverageReport.length} missing nutrition matches`);
  } else if (coverageReport.length) {
    console.warn(`Nutrition coverage: ${coverageReport.length} missing nutrition matches (see nutrition_coverage_report.csv).`);
  }
  console.log('Build completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
