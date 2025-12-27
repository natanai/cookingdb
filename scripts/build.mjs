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

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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

function loadIngredientCatalogRows(catalogPath) {
  const rows = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf-8') : '';
  return rows ? simpleParseCSV(rows) : [];
}

const GRAMS_PER_COLUMNS = [
  { column: 'grams_per_count', unit: 'count' },
  { column: 'grams_per_medium', unit: 'medium' },
  { column: 'grams_per_large', unit: 'large' },
  { column: 'grams_per_piece', unit: 'piece' },
  { column: 'grams_per_clove', unit: 'clove' },
  { column: 'grams_per_sprig', unit: 'sprig' },
  { column: 'grams_per_bunch', unit: 'bunch' },
  { column: 'grams_per_leaf', unit: 'leaf' },
  { column: 'grams_per_inch', unit: 'inch' },
  { column: 'grams_per_can', unit: 'can' },
  { column: 'grams_per_package', unit: 'package' },
  { column: 'grams_per_bag', unit: 'bag' },
  { column: 'grams_per_pint', unit: 'pint' },
  { column: 'grams_per_cup', unit: 'cup' },
  { column: 'grams_per_tbsp', unit: 'tbsp' },
  { column: 'grams_per_tsp', unit: 'tsp' },
];

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

function buildNutrientsPerGram(row, servingGrams) {
  const nutrients = {
    calories_kcal_per_g: null,
    protein_g_per_g: null,
    total_fat_g_per_g: null,
    saturated_fat_g_per_g: null,
    total_carbs_g_per_g: null,
    sugars_g_per_g: null,
    fiber_g_per_g: null,
    sodium_mg_per_g: null,
    calcium_mg_per_g: null,
    iron_mg_per_g: null,
    potassium_mg_per_g: null,
    vitamin_c_mg_per_g: null,
  };
  if (!Number.isFinite(servingGrams) || servingGrams <= 0) return nutrients;
  const calories = parseNumericField(row.calories_per_unit);
  const protein = parseNumericField(row.protein_g);
  const totalFat = parseNumericField(row.total_fat_g);
  const satFat = parseNumericField(row.saturated_fat_g);
  const totalCarbs = parseNumericField(row.total_carbs_g);
  const sugars = parseNumericField(row.sugars_g);
  const fiber = parseNumericField(row.fiber_g);
  const sodium = parseNumericField(row.sodium_mg);
  const calcium = parseNumericField(row.calcium_mg);
  const iron = parseNumericField(row.iron_mg);
  const potassium = parseNumericField(row.potassium_mg);
  const vitaminC = parseNumericField(row.vitamin_c_mg);

  if (Number.isFinite(calories)) nutrients.calories_kcal_per_g = calories / servingGrams;
  if (Number.isFinite(protein)) nutrients.protein_g_per_g = protein / servingGrams;
  if (Number.isFinite(totalFat)) nutrients.total_fat_g_per_g = totalFat / servingGrams;
  if (Number.isFinite(satFat)) nutrients.saturated_fat_g_per_g = satFat / servingGrams;
  if (Number.isFinite(totalCarbs)) nutrients.total_carbs_g_per_g = totalCarbs / servingGrams;
  if (Number.isFinite(sugars)) nutrients.sugars_g_per_g = sugars / servingGrams;
  if (Number.isFinite(fiber)) nutrients.fiber_g_per_g = fiber / servingGrams;
  if (Number.isFinite(sodium)) nutrients.sodium_mg_per_g = sodium / servingGrams;
  if (Number.isFinite(calcium)) nutrients.calcium_mg_per_g = calcium / servingGrams;
  if (Number.isFinite(iron)) nutrients.iron_mg_per_g = iron / servingGrams;
  if (Number.isFinite(potassium)) nutrients.potassium_mg_per_g = potassium / servingGrams;
  if (Number.isFinite(vitaminC)) nutrients.vitamin_c_mg_per_g = vitaminC / servingGrams;

  return nutrients;
}

function buildIngredientDb(rows) {
  const db = new Map();
  const rowMap = new Map();
  rows.forEach((row) => {
    if (!row?.ingredient_id) return;
    if (db.has(row.ingredient_id)) return;
    rowMap.set(row.ingredient_id, row);
    const servingGrams = parseNumericField(row.serving_grams);
    const gramsPerUnit = {};
    GRAMS_PER_COLUMNS.forEach(({ column, unit }) => {
      const grams = parseNumericField(row[column]);
      if (Number.isFinite(grams) && grams > 0) {
        gramsPerUnit[unit] = grams;
      }
    });
    db.set(row.ingredient_id, {
      ingredient_id: row.ingredient_id,
      canonical_name: row.canonical_name || '',
      contains_gluten: row.contains_gluten === 'true',
      contains_egg: row.contains_egg === 'true',
      contains_dairy: row.contains_dairy === 'true',
      nutrition_unit_norm: normalizeUnit(row.nutrition_unit) || null,
      serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
      grams_per_unit: gramsPerUnit,
      nutrients_per_gram: buildNutrientsPerGram(row, servingGrams),
    });
  });
  return { ingredientDb: db, ingredientRows: rowMap };
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

function gramsPerMlFromIngredient(ingredient) {
  if (!ingredient) return null;
  const gramsPerUnit = ingredient.grams_per_unit || {};
  if (Number.isFinite(gramsPerUnit.tsp)) return gramsPerUnit.tsp / 5;
  if (Number.isFinite(gramsPerUnit.tbsp)) return gramsPerUnit.tbsp / 15;
  if (Number.isFinite(gramsPerUnit.cup)) return gramsPerUnit.cup / 240;
  if (Number.isFinite(gramsPerUnit.pint)) return gramsPerUnit.pint / 480;

  const nutritionUnit = ingredient.nutrition_unit_norm;
  if (nutritionUnit && Number.isFinite(ingredient.serving_grams)) {
    const conversion = convertUnitAmount(1, nutritionUnit, 'ml');
    if (conversion && Number.isFinite(conversion.amount) && conversion.amount > 0) {
      return ingredient.serving_grams / conversion.amount;
    }
  }
  return null;
}

function gramsForIngredient(ingredient, qty, unitNorm) {
  if (!ingredient || !Number.isFinite(qty)) return null;
  const def = unitDefinition(unitNorm);
  if (def?.group === 'mass') {
    const conversion = convertUnitAmount(qty, unitNorm, 'g');
    return conversion && Number.isFinite(conversion.amount) ? conversion.amount : null;
  }
  if (def?.group === 'volume') {
    const direct = ingredient.grams_per_unit?.[unitNorm];
    if (Number.isFinite(direct)) return qty * direct;
    const conversion = convertUnitAmount(qty, unitNorm, 'ml');
    if (!conversion || !Number.isFinite(conversion.amount)) return null;
    const gramsPerMl = gramsPerMlFromIngredient(ingredient);
    return Number.isFinite(gramsPerMl) ? conversion.amount * gramsPerMl : null;
  }
  const countLike = new Set(['count', 'medium', 'large', 'piece', 'clove', 'sprig', 'bunch', 'leaf', 'inch']);
  if (countLike.has(unitNorm)) {
    const direct = ingredient.grams_per_unit?.[unitNorm];
    if (Number.isFinite(direct)) return qty * direct;
    if (Number.isFinite(ingredient.grams_per_unit?.count)) return qty * ingredient.grams_per_unit.count;
    if (ingredient.nutrition_unit_norm === unitNorm && Number.isFinite(ingredient.serving_grams)) {
      return qty * ingredient.serving_grams;
    }
    return null;
  }
  const packageLike = new Set(['can', 'package', 'bag']);
  if (packageLike.has(unitNorm)) {
    const direct = ingredient.grams_per_unit?.[unitNorm];
    if (Number.isFinite(direct)) return qty * direct;
    if (ingredient.nutrition_unit_norm === unitNorm && Number.isFinite(ingredient.serving_grams)) {
      return qty * ingredient.serving_grams;
    }
    return null;
  }
  return null;
}

function selectNutritionVariant(variants, normalizedUnit, amount) {
  if (!Array.isArray(variants) || !variants.length) {
    return { variant: null, convertedAmount: null, matchedUnit: null, convertible: false };
  }
  const exact = variants.find((entry) => entry?.serving_unit_norm === normalizedUnit);
  if (exact) {
    return { variant: exact, convertedAmount: amount, matchedUnit: normalizedUnit, convertible: true };
  }

  for (const entry of variants) {
    const servingUnit = entry?.serving_unit_norm;
    if (!servingUnit) continue;
    const conversion = convertUnitAmount(amount, normalizedUnit, servingUnit);
    if (conversion && Number.isFinite(conversion.amount)) {
      return { variant: entry, convertedAmount: conversion.amount, matchedUnit: servingUnit, convertible: true };
    }
  }

  return { variant: null, convertedAmount: null, matchedUnit: null, convertible: false };
}

function selectVariantWithFactor(ingredientId, amount, normalizedUnit, variants, unitFactors) {
  if (!ingredientId || !Array.isArray(variants) || !unitFactors) return null;
  const factors = unitFactors.get(ingredientId) || [];
  for (const factor of factors) {
    let bridgedAmount = null;
    if (normalizedUnit === factor.from_unit_norm) {
      bridgedAmount = amount * factor.factor;
    } else {
      const fromConversion = convertUnitAmount(amount, normalizedUnit, factor.from_unit_norm);
      if (!fromConversion || !Number.isFinite(fromConversion.amount)) continue;
      bridgedAmount = fromConversion.amount * factor.factor;
    }
    const match = selectNutritionVariant(variants, factor.to_unit_norm, bridgedAmount);
    if (match?.variant && Number.isFinite(match.convertedAmount)) {
      return {
        variant: match.variant,
        convertedAmount: match.convertedAmount,
        bridge: factor,
      };
    }
  }
  return null;
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

function listVariantUnits(variants) {
  if (!Array.isArray(variants)) return [];
  const seen = new Set();
  variants.forEach((entry) => {
    const unit = entry?.serving_unit_norm;
    if (unit) seen.add(unit);
  });
  return [...seen];
}

function pickSuggestedTargetUnit(normalizedUnit, variants) {
  const units = listVariantUnits(variants);
  if (!units.length) return '';
  const recipeGroup = unitDefinition(normalizedUnit)?.group || null;
  if (recipeGroup) {
    const sameGroup = units.find((unit) => unitDefinition(unit)?.group === recipeGroup);
    if (sameGroup) return sameGroup;
  }
  return units[0];
}

function classifyUnitWorldMismatch(normalizedUnit, targetUnit) {
  if (!normalizedUnit || !targetUnit) return '';
  const packageUnits = new Set(['bag', 'bunch', 'can', 'cube', 'jar', 'packet', 'package', 'bottle']);
  if (packageUnits.has(normalizedUnit)) return 'package';
  const recipeGroup = unitDefinition(normalizedUnit)?.group || null;
  const targetGroup = unitDefinition(targetUnit)?.group || null;
  if (!recipeGroup || !targetGroup || recipeGroup === targetGroup) return '';
  if (recipeGroup === 'count' && targetGroup === 'volume') return 'count-vs-volume';
  if (recipeGroup === 'count' && targetGroup === 'mass') return 'count-vs-mass';
  if (recipeGroup === 'volume' && targetGroup === 'mass') return 'volume-vs-mass';
  if (recipeGroup === 'mass' && targetGroup === 'volume') return 'volume-vs-mass';
  return '';
}

function loadIngredientNutritionVariants(nutritionPath) {
  if (!fs.existsSync(nutritionPath)) return new Map();
  const rows = fs.readFileSync(nutritionPath, 'utf-8');
  const parsed = rows ? simpleParseCSV(rows) : [];
  const map = new Map();
  parsed.forEach((row) => {
    if (!row?.ingredient_id) return;
    const ingredientId = row.ingredient_id;
    const servingQty = parseNumericField(row.serving_qty);
    const servingUnitNorm = normalizeUnit(row.serving_unit_norm);
    if (!map.has(ingredientId)) {
      map.set(ingredientId, []);
    }
    map.get(ingredientId).push({
      ingredient_id: ingredientId,
      serving_qty: Number.isFinite(servingQty) && servingQty > 0 ? servingQty : 1,
      serving_unit_norm: servingUnitNorm || null,
      calories_kcal: parseNumericField(row.calories_kcal),
      protein_g: parseNumericField(row.protein_g),
      total_fat_g: parseNumericField(row.total_fat_g),
      saturated_fat_g: parseNumericField(row.saturated_fat_g),
      total_carbs_g: parseNumericField(row.total_carbs_g),
      sugars_g: parseNumericField(row.sugars_g),
      fiber_g: parseNumericField(row.fiber_g),
      sodium_mg: parseNumericField(row.sodium_mg),
      calcium_mg: parseNumericField(row.calcium_mg),
      iron_mg: parseNumericField(row.iron_mg),
      potassium_mg: parseNumericField(row.potassium_mg),
      vitamin_c_mg: parseNumericField(row.vitamin_c_mg),
      source: row.source || '',
      notes: row.notes || '',
    });
  });
  return map;
}

function loadIngredientUnitFactors(factorsPath) {
  if (!fs.existsSync(factorsPath)) return new Map();
  const rows = fs.readFileSync(factorsPath, 'utf-8');
  const parsed = rows ? simpleParseCSV(rows) : [];
  const map = new Map();
  parsed.forEach((row) => {
    if (!row?.ingredient_id) return;
    const fromUnit = normalizeUnit(row.from_unit_norm);
    const toUnit = normalizeUnit(row.to_unit_norm);
    const factor = parseNumericField(row.factor);
    if (!fromUnit || !toUnit || !Number.isFinite(factor)) return;
    if (!map.has(row.ingredient_id)) map.set(row.ingredient_id, []);
    map.get(row.ingredient_id).push({
      ingredient_id: row.ingredient_id,
      from_unit_norm: fromUnit,
      to_unit_norm: toUnit,
      factor,
      source: row.source || '',
      notes: row.notes || '',
    });
  });
  return map;
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

function computeNutritionEstimate(ingredients, choices, ingredientDb, guidelines) {
  const targets = deriveServingTargets(null, guidelines);
  let covered = 0;
  const missing = [];
  const totals = {
    kcal: 0,
    sodium_mg: 0,
    sat_fat_g: 0,
  };
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
      missing.push({ ingredient_id: option.ingredient_id, unit: normalizedUnit });
      return;
    }

    const ingredient = ingredientDb.get(option.ingredient_id);
    const grams = gramsForIngredient(ingredient, amount, normalizedUnit);
    const caloriesPerG = ingredient?.nutrients_per_gram?.calories_kcal_per_g;
    const sodiumPerG = ingredient?.nutrients_per_gram?.sodium_mg_per_g;
    const satFatPerG = ingredient?.nutrients_per_gram?.saturated_fat_g_per_g;

    if (!Number.isFinite(grams) || !Number.isFinite(caloriesPerG)) {
      missing.push({ ingredient_id: option.ingredient_id, unit: normalizedUnit || option.unit });
      return;
    }

    totals.kcal += grams * caloriesPerG;
    if (Number.isFinite(sodiumPerG)) totals.sodium_mg += grams * sodiumPerG;
    if (Number.isFinite(satFatPerG)) totals.sat_fat_g += grams * satFatPerG;
    covered += 1;
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
    servings_estimate: suggestedServings,
    covered_ingredients: covered,
    total_ingredients: tokens.length,
    coverage_ratio: tokens.length ? covered / tokens.length : 0,
    target_meal_calories: targets.calories_kcal,
    missing_ingredients: missing,
  };
}

function suggestedGramsColumnForUnit(unitNorm) {
  const match = GRAMS_PER_COLUMNS.find((entry) => entry.unit === unitNorm);
  if (match) return match.column;
  if (unitDefinition(unitNorm)?.group === 'volume') {
    return 'grams_per_cup';
  }
  if (unitNorm) return 'grams_per_count';
  return '';
}

function generateNutritionCoverageReport(recipes, ingredientDb, recipeIndex) {
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
      if (!normalizedUnit) return;
      let reason = null;
      let suggestedColumn = '';
      let notes = '';

      if (normalizedUnit === 'recipe') {
        if (!recipeIndex?.has(option.ingredient_id)) {
          reason = 'recipe-reference-needed';
        }
      } else {
        const ingredient = ingredientDb.get(option.ingredient_id);
        const grams = gramsForIngredient(ingredient, amount, normalizedUnit);
        if (!Number.isFinite(grams)) {
          reason = 'missing-grams-mapping';
          suggestedColumn = suggestedGramsColumnForUnit(normalizedUnit);
          const nutritionUnit = ingredient?.nutrition_unit_norm;
          if (nutritionUnit) {
            notes = `nutrition unit is ${nutritionUnit}; recipe uses ${normalizedUnit}`;
          }
        } else {
          const caloriesPerG = ingredient?.nutrients_per_gram?.calories_kcal_per_g;
          if (!Number.isFinite(caloriesPerG)) {
            if (!Number.isFinite(ingredient?.serving_grams)) {
              reason = 'missing-serving-grams';
              suggestedColumn = 'serving_grams';
            } else {
              reason = 'missing-nutrition';
              suggestedColumn = 'calories_per_unit';
            }
          }
        }
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
          suggested_column_to_fill: suggestedColumn,
          notes,
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
  const catalogRows = loadIngredientCatalogRows(catalogPath);
  const catalog = buildIngredientCatalog(catalogRows);
  const { ingredientDb } = buildIngredientDb(catalogRows);
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
    const nutritionEstimate = computeNutritionEstimate(ingredients, choices, ingredientDb, nutritionGuidelines);
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
    path.join(builtDir, 'ingredient_db.json'),
    JSON.stringify(Object.fromEntries(ingredientDb.entries()), null, 2)
  );
  fs.writeFileSync(path.join(builtDir, 'recipes.json'), JSON.stringify(recipeOutputs, null, 2));
  fs.writeFileSync(path.join(builtDir, 'index.json'), JSON.stringify(indexList, null, 2));
  const recipeIndex = new Map(recipeOutputs.map((recipe) => [recipe.id, recipe]));
  const coverageReport = generateNutritionCoverageReport(recipeOutputs, ingredientDb, recipeIndex);
  const coverageCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason,suggested_column_to_fill,notes',
    ...coverageReport.map((row) =>
      [
        csvEscape(row.ingredient_id),
        csvEscape(row.unit_norm),
        csvEscape(row.example_recipe_id),
        csvEscape(row.count_occurrences),
        csvEscape(row.example_qty),
        csvEscape(row.reason),
        csvEscape(row.suggested_column_to_fill),
        csvEscape(row.notes),
      ].join(',')
    ),
  ].join('\n');
  fs.writeFileSync(path.join(builtDir, 'nutrition_coverage_report.csv'), `${coverageCsv}\n`);
  const strictMode = process.env.NUTRITION_STRICT === '1';
  fs.writeFileSync(
    path.join(builtDir, 'nutrition-coverage.json'),
    JSON.stringify({ missing_count: coverageReport.length, strict: strictMode }, null, 2)
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
