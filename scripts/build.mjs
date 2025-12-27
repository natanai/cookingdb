import fs from 'fs';
import path from 'path';
import { UNIT_CONVERSIONS } from '../docs/unit-conversions.js';
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
    });
  }
  return map;
}

function loadIngredientPortions(portionsPath) {
  if (!fs.existsSync(portionsPath)) return new Map();
  const rows = fs.readFileSync(portionsPath, 'utf-8');
  const parsed = rows ? simpleParseCSV(rows) : [];
  const map = new Map();
  for (const row of parsed) {
    if (!row.ingredient_id || !row.unit) continue;
    const normalizedUnit = normalizeUnit(row.unit);
    if (!normalizedUnit) continue;
    const grams = Number(row.grams);
    if (!Number.isFinite(grams)) continue;
    map.set(`${row.ingredient_id}::${normalizedUnit}`, {
      ingredient_id: row.ingredient_id,
      unit: normalizedUnit,
      grams,
      source: row.source || '',
      notes: row.notes || '',
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
    map.set(`${row.ingredient_id}::${row.nutrition_unit}`, {
      ingredient_id: row.ingredient_id,
      unit: row.nutrition_unit,
      calories_per_unit: Number.isFinite(calories) ? calories : null,
      source: row.nutrition_source || '',
      notes: row.nutrition_notes || '',
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
  ['clove', 'clove'],
  ['sprigs', 'sprig'],
  ['sprig', 'sprig'],
  ['leaves', 'leaf'],
  ['leaf', 'leaf'],
  ['pieces', 'piece'],
  ['piece', 'piece'],
  ['packages', 'package'],
  ['package', 'package'],
  ['bags', 'bag'],
  ['bag', 'bag'],
  ['bunches', 'bunch'],
  ['bunch', 'bunch'],
  ['cans', 'can'],
  ['can', 'can'],
  ['jars', 'jar'],
  ['jar', 'jar'],
  ['bottles', 'bottle'],
  ['bottle', 'bottle'],
  ['fl oz', 'fl_oz'],
  ['fl-oz', 'fl_oz'],
  ['fluid ounce', 'fl_oz'],
  ['fluid ounces', 'fl_oz'],
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
  ['dash', 'tsp'],
  ['drop', 'tsp'],
]);

function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
}

function unitDefinition(unitId) {
  if (!unitId) return null;
  const normalized = String(unitId).toLowerCase();
  for (const [groupName, group] of Object.entries(UNIT_CONVERSIONS)) {
    const def = group.units[normalized];
    if (def) return { ...def, id: normalized, group: groupName };
  }
  return null;
}

function convertUnitAmount(amount, fromUnit, toUnit) {
  if (!Number.isFinite(amount)) return null;
  const fromDef = unitDefinition(fromUnit);
  const toDef = unitDefinition(toUnit);
  if (!fromDef || !toDef || fromDef.group !== toDef.group) return null;
  const amountInBase = amount * fromDef.to_base;
  const converted = amountInBase / toDef.to_base;
  return { amount: converted, unit: toDef.id };
}

function parseServingInfo(servingSize) {
  if (!servingSize) {
    return {
      serving_qty: 1,
      serving_unit_norm: null,
      serving_grams: null,
      serving_ml: null,
    };
  }

  const raw = String(servingSize).trim();
  const parenMatch = raw.match(/\(([^)]+)\)/);
  const paren = parenMatch ? parenMatch[1] : '';
  const gramMatch = paren.match(/([0-9]*\.?[0-9]+)\s*g/i);
  const mlMatch = paren.match(/([0-9]*\.?[0-9]+)\s*ml/i);
  const grams = gramMatch ? Number(gramMatch[1]) : null;
  const ml = mlMatch ? Number(mlMatch[1]) : null;

  const qtyMatch = raw.match(/^([\d\s./-]+)/);
  const servingQty = qtyMatch ? parseRatioToNumber(qtyMatch[1].trim()) : null;
  const servingQtyValue = Number.isFinite(servingQty) && servingQty > 0 ? servingQty : 1;

  const packageKeywords = ['can', 'package', 'bag', 'pint', 'jar', 'bottle'];
  const lower = raw.toLowerCase();
  const packageUnit = packageKeywords.find((keyword) => lower.includes(keyword));

  const unitMatch = raw.match(/^[\d\s./-]*([a-zA-Z_-]+)/);
  const unitToken = unitMatch ? unitMatch[1] : null;
  const unit = normalizeUnit(packageUnit || unitToken);

  let servingGrams = Number.isFinite(grams) ? grams : null;
  if (!Number.isFinite(servingGrams)) {
    const weightMatch = raw.match(/([0-9]*\.?[0-9]+)\s*(oz|lb|g|kg)\b/i);
    if (weightMatch) {
      const weightQty = Number(weightMatch[1]);
      const weightUnit = normalizeUnit(weightMatch[2]);
      const converted = convertUnitAmount(weightQty, weightUnit, 'g');
      servingGrams = converted?.amount ?? null;
    }
  }

  return {
    serving_qty: servingQtyValue,
    serving_unit_norm: unit || null,
    serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
    serving_ml: Number.isFinite(ml) ? ml : null,
  };
}

function gramsPerUnitFromPortions(ingredientId, unit, portions) {
  if (!ingredientId || !unit) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (!normalizedUnit) return null;
  const entry = portions.get(`${ingredientId}::${normalizedUnit}`);
  return entry?.grams ?? null;
}

function isVolumeUnit(unit) {
  const normalizedUnit = normalizeUnit(unit);
  const def = normalizedUnit ? unitDefinition(normalizedUnit) : null;
  return def?.group === 'volume';
}

function gramsPerMlFromNutrition(ingredientId, nutrition, portions) {
  const servingUnit = nutrition?.serving_unit_norm;
  const servingQty = Number.isFinite(nutrition?.serving_qty) ? nutrition.serving_qty : 1;
  const servingGrams = Number.isFinite(nutrition?.serving_grams) ? nutrition.serving_grams : null;
  if (servingUnit && Number.isFinite(servingGrams) && isVolumeUnit(servingUnit)) {
    const servingMl = convertUnitAmount(servingQty, servingUnit, 'ml');
    if (servingMl && Number.isFinite(servingMl.amount) && servingMl.amount > 0) {
      return servingGrams / servingMl.amount;
    }
  }
  const gramsPerMl = gramsPerUnitFromPortions(ingredientId, 'ml', portions);
  return Number.isFinite(gramsPerMl) ? gramsPerMl : null;
}

function amountToGrams(ingredientId, amount, unit, nutrition, portions) {
  if (!ingredientId || !Number.isFinite(amount)) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (!normalizedUnit) return null;

  const def = unitDefinition(normalizedUnit);
  if (def?.group === 'mass') {
    return convertUnitAmount(amount, normalizedUnit, 'g')?.amount ?? null;
  }

  if (def?.group === 'volume') {
    const ml = convertUnitAmount(amount, normalizedUnit, 'ml');
    if (!ml || !Number.isFinite(ml.amount)) return null;
    if (ingredientId === 'water') return ml.amount;
    const gramsPerMl = gramsPerMlFromNutrition(ingredientId, nutrition, portions);
    return Number.isFinite(gramsPerMl) ? ml.amount * gramsPerMl : null;
  }

  const servingUnit = nutrition?.serving_unit_norm;
  const servingQty = Number.isFinite(nutrition?.serving_qty) ? nutrition.serving_qty : 1;
  const servingGrams = Number.isFinite(nutrition?.serving_grams) ? nutrition.serving_grams : null;
  if (
    Number.isFinite(servingGrams)
    && servingUnit
    && normalizeUnit(servingUnit) === normalizedUnit
    && servingQty === 1
  ) {
    return amount * servingGrams;
  }

  const portion = gramsPerUnitFromPortions(ingredientId, normalizedUnit, portions);
  if (Number.isFinite(portion)) {
    return amount * portion;
  }
  return null;
}

function buildNutritionDensity(catalog, portions) {
  const map = new Map();
  for (const [ingredientId, entry] of catalog.entries()) {
    const nutritionUnit = normalizeUnit(entry.nutrition_unit || '');
    const servingInfo = parseServingInfo(entry.serving_size || '');
    const servingUnitNorm = servingInfo.serving_unit_norm;
    const servingQty = Number.isFinite(servingInfo.serving_qty) ? servingInfo.serving_qty : 1;
    let gramsPerUnit = null;

    if (Number.isFinite(servingInfo.serving_grams)) {
      gramsPerUnit = servingInfo.serving_grams;
    } else if (nutritionUnit) {
      const unitDef = unitDefinition(nutritionUnit);
      if (unitDef?.group === 'mass') {
        gramsPerUnit = convertUnitAmount(1, nutritionUnit, 'g')?.amount ?? null;
      }
    }

    if (!Number.isFinite(gramsPerUnit) && Number.isFinite(servingInfo.serving_ml)) {
      const gramsPerMl = gramsPerUnitFromPortions(ingredientId, 'ml', portions);
      if (Number.isFinite(gramsPerMl)) {
        gramsPerUnit = servingInfo.serving_ml * gramsPerMl;
      }
    }

    if (!Number.isFinite(gramsPerUnit) && servingUnitNorm) {
      const gramsFromPortion = gramsPerUnitFromPortions(ingredientId, servingUnitNorm, portions);
      if (Number.isFinite(gramsFromPortion)) gramsPerUnit = gramsFromPortion * servingQty;
    }

    if (!Number.isFinite(gramsPerUnit) && Number.isFinite(servingInfo.serving_ml) && ingredientId === 'water') {
      gramsPerUnit = servingInfo.serving_ml;
    }

    const caloriesPerUnit = parseNumericField(entry.calories_per_unit);
    const protein = parseNumericField(entry.protein_g);
    const fat = parseNumericField(entry.total_fat_g);
    const satFat = parseNumericField(entry.saturated_fat_g);
    const carbs = parseNumericField(entry.total_carbs_g);
    const sugars = parseNumericField(entry.sugars_g);
    const fiber = parseNumericField(entry.fiber_g);
    const sodium = parseNumericField(entry.sodium_mg);
    const calcium = parseNumericField(entry.calcium_mg);
    const iron = parseNumericField(entry.iron_mg);
    const potassium = parseNumericField(entry.potassium_mg);
    const vitaminC = parseNumericField(entry.vitamin_c_mg);

    const canCompute = Number.isFinite(gramsPerUnit) && gramsPerUnit > 0;
    const perGram = canCompute ? {
      kcal: Number.isFinite(caloriesPerUnit) ? caloriesPerUnit / gramsPerUnit : null,
      protein_g: Number.isFinite(protein) ? protein / gramsPerUnit : null,
      fat_g: Number.isFinite(fat) ? fat / gramsPerUnit : null,
      sat_fat_g: Number.isFinite(satFat) ? satFat / gramsPerUnit : null,
      carbs_g: Number.isFinite(carbs) ? carbs / gramsPerUnit : null,
      sugars_g: Number.isFinite(sugars) ? sugars / gramsPerUnit : null,
      fiber_g: Number.isFinite(fiber) ? fiber / gramsPerUnit : null,
      sodium_mg: Number.isFinite(sodium) ? sodium / gramsPerUnit : null,
      calcium_mg: Number.isFinite(calcium) ? calcium / gramsPerUnit : null,
      iron_mg: Number.isFinite(iron) ? iron / gramsPerUnit : null,
      potassium_mg: Number.isFinite(potassium) ? potassium / gramsPerUnit : null,
      vitamin_c_mg: Number.isFinite(vitaminC) ? vitaminC / gramsPerUnit : null,
    } : null;

    map.set(ingredientId, {
      ingredient_id: ingredientId,
      unit: nutritionUnit || null,
      grams_per_unit: Number.isFinite(gramsPerUnit) ? gramsPerUnit : null,
      serving_qty: servingQty,
      serving_unit_norm: servingUnitNorm || null,
      serving_grams: Number.isFinite(gramsPerUnit) ? gramsPerUnit : null,
      per_g: perGram,
      source: entry.nutrition_source || '',
      notes: entry.nutrition_notes || '',
      serving_size: entry.serving_size || '',
    });
  }
  return map;
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
    unit: entry.unit || null,
    grams_per_unit: Number.isFinite(entry.grams_per_unit) ? entry.grams_per_unit : null,
    serving_qty: Number.isFinite(entry.serving_qty) ? entry.serving_qty : 1,
    serving_unit_norm: entry.serving_unit_norm || null,
    serving_grams: Number.isFinite(entry.serving_grams) ? entry.serving_grams : null,
    per_g: entry.per_g || null,
    source: entry.source || '',
    notes: entry.notes || '',
    serving_size: entry.serving_size || '',
  };
}

function computeNutritionEstimate(ingredients, choices, nutritionDensity, portions, guidelines, policy) {
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
  const missing = [];
  const tokens = Object.keys(ingredients || {});
  tokens.forEach((token) => {
    const tokenData = ingredients[token];
    const option = selectDefaultOption(tokenData, choices[token]);
    if (!option || !option.ratio || !option.unit) return;
    const amount = parseRatioToNumber(option.ratio);
    if (!Number.isFinite(amount)) return;
    const nutrition = nutritionDensity.get(option.ingredient_id);
    const grams = amountToGrams(option.ingredient_id, amount, option.unit, nutrition, portions);
    if (!Number.isFinite(grams) || !nutrition?.per_g || !Number.isFinite(nutrition.per_g.kcal)) {
      missing.push({ ingredient_id: option.ingredient_id, unit: normalizeUnit(option.unit) });
      return;
    }
    totalCalories += grams * nutrition.per_g.kcal;
    covered += 1;
  });

  if (totalCalories <= 0) {
    return {
      calories_total: 0,
      calories_per_serving: null,
      servings_estimate: null,
      covered_ingredients: covered,
      total_ingredients: tokens.length,
      coverage_ratio: tokens.length ? covered / tokens.length : 0,
      target_meal_calories: targetMealCalories,
      missing_ingredients: missing,
    };
  }

  const servingsEstimate = Math.max(1, Math.round(totalCalories / targetMealCalories));
  return {
    calories_total: totalCalories,
    calories_per_serving: totalCalories / servingsEstimate,
    servings_estimate: servingsEstimate,
    covered_ingredients: covered,
    total_ingredients: tokens.length,
    coverage_ratio: tokens.length ? covered / tokens.length : 0,
    target_meal_calories: targetMealCalories,
    missing_ingredients: missing,
  };
}

function generateMissingPortionsReport(recipes, portions, nutritionDensity) {
  const missing = new Map();

  recipes.forEach((recipe) => {
    const ingredients = recipe.ingredients || {};
    const choices = recipe.choices || {};
    Object.keys(ingredients).forEach((token) => {
      const tokenData = ingredients[token];
      const option = selectDefaultOption(tokenData, choices[token]);
      if (!option || !option.ratio || !option.unit) return;
      const amount = parseRatioToNumber(option.ratio);
      if (!Number.isFinite(amount)) return;
      const normalizedUnit = normalizeUnit(option.unit);
      const nutrition = nutritionDensity.get(option.ingredient_id);
      const isVolume = isVolumeUnit(normalizedUnit);
      const mlAttempt = isVolume ? convertUnitAmount(amount, normalizedUnit, 'ml')?.amount ?? null : null;
      const grams = amountToGrams(option.ingredient_id, amount, option.unit, nutrition, portions);
      let reason = null;
      if (!Number.isFinite(grams)) {
        reason = 'missing-portion';
      } else if (!nutrition?.per_g) {
        reason = 'missing-nutrition-density';
      } else if (!Number.isFinite(nutrition.per_g.kcal)) {
        reason = 'missing-kcal-density';
      }

      if (!reason) return;
      const key = `${option.ingredient_id}::${normalizedUnit || ''}::${reason}`;
      if (!missing.has(key)) {
        missing.set(key, {
          ingredient_id: option.ingredient_id,
          unit_norm: normalizedUnit || '',
          reason,
          example_recipe_id: recipe.id,
          example_qty: option.ratio,
          qty: amount,
          is_volume_unit: isVolume,
          ml_attempt: mlAttempt,
          result_grams_attempt: Number.isFinite(grams) ? grams : null,
          nutrition_serving_unit: nutrition?.serving_unit_norm || '',
          nutrition_serving_grams: Number.isFinite(nutrition?.serving_grams) ? nutrition.serving_grams : null,
          count_occurrences: 0,
        });
      }
      missing.get(key).count_occurrences += 1;
    });
  });

  return [...missing.values()].sort((a, b) =>
    a.ingredient_id.localeCompare(b.ingredient_id) || a.unit_norm.localeCompare(b.unit_norm)
  );
}

async function build() {
  assertVolumeConversions();
  await validateAll();
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  const catalog = loadIngredientCatalog(catalogPath);
  const portionsPath = path.join(process.cwd(), 'data', 'ingredient_portions.csv');
  const ingredientPortions = loadIngredientPortions(portionsPath);
  const nutritionDensity = buildNutritionDensity(catalog, ingredientPortions);
  const nutritionGuidelines = loadNutritionGuidelines(path.join(process.cwd(), 'data', 'nutrition_guidelines.json'));
  const nutritionPolicy = loadNutritionPolicy(
    path.join(process.cwd(), 'data', 'nutrition_policy.json'),
    path.join(process.cwd(), 'data', 'nutrition_guidelines.json')
  );
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
      const nutritionProfile = buildNutritionProfile(nutritionDensity.get(row.ingredient_id));
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
      nutritionDensity,
      ingredientPortions,
      nutritionGuidelines,
      nutritionPolicy
    );
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

  const builtDir = path.join(process.cwd(), 'docs', 'built');
  if (!fs.existsSync(builtDir)) {
    fs.mkdirSync(builtDir, { recursive: true });
  }
  fs.writeFileSync(path.join(builtDir, 'nutrition-policy.json'), JSON.stringify(nutritionPolicy, null, 2));
  fs.writeFileSync(path.join(builtDir, 'nutrition-guidelines.json'), JSON.stringify(nutritionGuidelines, null, 2));
  fs.writeFileSync(
    path.join(builtDir, 'ingredient-portions.json'),
    JSON.stringify([...ingredientPortions.values()], null, 2)
  );
  fs.writeFileSync(path.join(builtDir, 'recipes.json'), JSON.stringify(recipeOutputs, null, 2));
  fs.writeFileSync(path.join(builtDir, 'index.json'), JSON.stringify(indexList, null, 2));
  const missingPortions = generateMissingPortionsReport(recipeOutputs, ingredientPortions, nutritionDensity);
  const missingCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason,qty,isVolumeUnit,mlAttempt,resultGramsAttempt,nutritionServingUnit,nutritionServingGrams',
    ...missingPortions.map((row) =>
      [
        row.ingredient_id,
        row.unit_norm,
        row.example_recipe_id,
        row.count_occurrences,
        row.example_qty,
        row.reason,
        row.qty,
        row.is_volume_unit,
        row.ml_attempt,
        row.result_grams_attempt,
        row.nutrition_serving_unit,
        row.nutrition_serving_grams,
      ].join(',')
    ),
  ].join('\n');
  fs.writeFileSync(path.join(builtDir, 'missing_portions.csv'), `${missingCsv}\n`);
  const strictMode = process.env.NUTRITION_STRICT === '1';
  fs.writeFileSync(
    path.join(builtDir, 'nutrition-coverage.json'),
    JSON.stringify({ missing_count: missingPortions.length, strict: strictMode }, null, 2)
  );
  if (strictMode && missingPortions.length) {
    throw new Error(`Nutrition coverage incomplete: ${missingPortions.length} missing portions or densities`);
  } else if (missingPortions.length) {
    console.warn(`Nutrition coverage: ${missingPortions.length} missing portion/density rows (see missing_portions.csv).`);
  }
  console.log('Build completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
