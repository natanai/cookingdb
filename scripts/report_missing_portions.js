import fs from 'fs';
import path from 'path';
import { UNIT_CONVERSIONS } from '../docs/unit-conversions.js';

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

function selectNutritionVariant(variants, normalizedUnit, amount) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { variant: null, convertible: false };
  }
  const exact = variants.find((entry) => entry?.serving_unit_norm === normalizedUnit);
  if (exact) return { variant: exact, convertible: true };

  for (const entry of variants) {
    const servingUnit = entry?.serving_unit_norm;
    if (!servingUnit) continue;
    const conversion = convertUnitAmount(amount, normalizedUnit, servingUnit);
    if (conversion) {
      return { variant: entry, convertible: true };
    }
  }

  return { variant: null, convertible: false };
}

function gramsFromVariant(amount, normalizedUnit, variant) {
  if (!variant?.serving_unit_norm) return null;
  if (!Number.isFinite(variant.serving_grams)) return null;
  const servingQty = Number.isFinite(variant.serving_qty) ? variant.serving_qty : 1;
  const conversion = convertUnitAmount(amount, normalizedUnit, variant.serving_unit_norm);
  if (!conversion) return null;
  const gramsPerServingUnit = variant.serving_grams / servingQty;
  return conversion.amount * gramsPerServingUnit;
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

function generateMissingPortionsReport(recipes, portions, recipeIndex) {
  const missing = new Map();
  const packageUnits = new Set(['bag', 'bunch', 'cube', 'packet', 'package']);
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
      const isVolume = isVolumeUnit(normalizedUnit);
      const mlAttempt = isVolume ? convertUnitAmount(amount, normalizedUnit, 'ml')?.amount ?? null : null;
      if (normalizedUnit === 'recipe' && recipeIndex.has(option.ingredient_id)) {
        return;
      }
      const nutritionVariants = Array.isArray(option.nutrition) ? option.nutrition : (option.nutrition ? [option.nutrition] : []);
      const { variant, convertible } = selectNutritionVariant(nutritionVariants, normalizedUnit, amount);
      const grams = variant ? gramsFromVariant(amount, normalizedUnit, variant) : null;
      const nutrition = variant;
      let reason = null;
      if (!Number.isFinite(grams)) {
        if (normalizedUnit === 'recipe') {
          reason = 'recipe-reference-needed';
        } else if (!convertible) {
          reason = 'missing-nutrition-variant';
        } else if (packageUnits.has(normalizedUnit)) {
          reason = 'package-ambiguous';
        } else {
          reason = 'missing-serving-grams';
        }
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
  return [...missing.values()];
}

function main() {
  const builtRecipesPath = path.join(process.cwd(), 'docs', 'built', 'recipes.json');
  const portionsPath = path.join(process.cwd(), 'data', 'ingredient_portions.csv');
  if (!fs.existsSync(builtRecipesPath)) {
    throw new Error('Missing docs/built/recipes.json. Run the build first.');
  }
  const recipes = JSON.parse(fs.readFileSync(builtRecipesPath, 'utf-8'));
  const portions = loadIngredientPortions(portionsPath);
  const recipeIndex = new Map(
    recipes
      .filter((entry) => entry && entry.id)
      .map((entry) => [String(entry.id), entry])
  );
  const missing = generateMissingPortionsReport(recipes, portions, recipeIndex);
  const outputPath = path.join(process.cwd(), 'docs', 'built', 'missing_portions.csv');
  const missingCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason,qty,isVolumeUnit,mlAttempt,resultGramsAttempt,nutritionServingUnit,nutritionServingGrams',
    ...missing.map((row) =>
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
  fs.writeFileSync(outputPath, `${missingCsv}\n`);
  const grouped = new Map();
  missing.forEach((row) => {
    const count = grouped.get(row.reason) || 0;
    grouped.set(row.reason, count + (row.count_occurrences || 0));
  });
  const groupedCsv = [
    'reason,count_occurrences',
    ...[...grouped.entries()].map(([reason, count]) => `${reason},${count}`),
  ].join('\n');
  fs.writeFileSync(path.join(process.cwd(), 'docs', 'built', 'missing_portions_by_reason.csv'), `${groupedCsv}\n`);
  console.log(`Wrote ${missing.length} missing rows to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
