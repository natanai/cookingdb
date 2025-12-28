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

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function loadIngredientCatalogRows(catalogPath) {
  if (!fs.existsSync(catalogPath)) return [];
  const rows = fs.readFileSync(catalogPath, 'utf-8');
  return rows ? simpleParseCSV(rows) : [];
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
  ['medium', 'count'],
  ['large', 'count'],
  ['small', 'count'],
  ['piece', 'count'],
  ['pieces', 'count'],
  ['bunch', 'count'],
  ['bunches', 'count'],
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

function selectNutritionVariant(variants, normalizedUnit, amount) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { variant: null, convertedAmount: null, convertible: false };
  }
  const exact = variants.find((entry) => entry?.serving_unit_norm === normalizedUnit);
  if (exact) return { variant: exact, convertedAmount: amount, convertible: true };

  for (const entry of variants) {
    const servingUnit = entry?.serving_unit_norm;
    if (!servingUnit) continue;
    const conversion = convertUnitAmount(amount, normalizedUnit, servingUnit);
    if (conversion && Number.isFinite(conversion.amount)) {
      return { variant: entry, convertedAmount: conversion.amount, convertible: true };
    }
  }

  return { variant: null, convertedAmount: null, convertible: false };
}

function selectVariantWithFactor(ingredientId, amount, normalizedUnit, variants, unitFactors) {
  if (!ingredientId || !unitFactors) return null;
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
      return { variant: match.variant, convertedAmount: match.convertedAmount, bridge: factor };
    }
  }
  return null;
}

function selectVariantWithPortion(ingredientId, amount, normalizedUnit, variants, ingredientPortions) {
  if (!ingredientId || !ingredientPortions) return null;
  const portions = [...ingredientPortions.values()].filter((entry) => entry.ingredient_id === ingredientId);
  if (!portions.length) return null;
  for (const portion of portions) {
    let portionAmount = null;
    if (normalizedUnit === portion.unit) {
      portionAmount = amount;
    } else {
      const converted = convertUnitAmount(amount, normalizedUnit, portion.unit);
      if (converted && Number.isFinite(converted.amount)) {
        portionAmount = converted.amount;
      }
    }
    if (!Number.isFinite(portionAmount)) continue;
    const grams = portionAmount * portion.grams;
    if (!Number.isFinite(grams)) continue;
    const match = selectNutritionVariant(variants, 'g', grams);
    if (match?.variant && Number.isFinite(match.convertedAmount)) {
      return { variant: match.variant, convertedAmount: match.convertedAmount, bridge: portion };
    }
  }
  return null;
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

function buildIngredientUnitFactorsFromCatalog(rows) {
  const parsed = rows || [];
  const map = new Map();
  parsed.forEach((row) => {
    if (!row?.ingredient_id) return;
    const fromUnit = normalizeUnit(row.unit_factor_from_unit_norm);
    const toUnit = normalizeUnit(row.unit_factor_to_unit_norm);
    const factor = Number(row.unit_factor);
    if (!fromUnit || !toUnit || !Number.isFinite(factor)) return;
    if (!map.has(row.ingredient_id)) map.set(row.ingredient_id, []);
    map.get(row.ingredient_id).push({
      ingredient_id: row.ingredient_id,
      from_unit_norm: fromUnit,
      to_unit_norm: toUnit,
      factor,
      source: row.unit_factor_source || '',
      notes: row.unit_factor_notes || '',
    });
  });
  return map;
}

function buildIngredientPortionsFromCatalog(rows) {
  const parsed = rows || [];
  const map = new Map();
  for (const row of parsed) {
    if (!row.ingredient_id || !row.portion_unit) continue;
    const normalizedUnit = normalizeUnit(row.portion_unit);
    if (!normalizedUnit) continue;
    const grams = Number(row.portion_grams);
    if (!Number.isFinite(grams)) continue;
    map.set(`${row.ingredient_id}::${normalizedUnit}`, {
      ingredient_id: row.ingredient_id,
      unit: normalizedUnit,
      grams,
      source: row.portion_source || '',
      notes: row.portion_notes || '',
    });
  }
  return map;
}

function generateNutritionCoverageReport(recipes, unitFactors, ingredientPortions) {
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
      const variants = Array.isArray(option.nutrition) ? option.nutrition : (option.nutrition ? [option.nutrition] : []);
      let reason = null;
      const variantUnits = listVariantUnits(variants);
      const suggestedTargetUnit = pickSuggestedTargetUnit(normalizedUnit, variants);
      const mismatchType = classifyUnitWorldMismatch(normalizedUnit, suggestedTargetUnit);

      if (normalizedUnit === 'recipe') {
        reason = 'recipe-reference-needed';
      } else if (!variants.length) {
        reason = 'missing-nutrition-row';
      } else {
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
          if (!variant) {
            const recipeGroup = unitDefinition(normalizedUnit)?.group || null;
            const hasSameGroup = variants.some((entry) => {
              const servingGroup = unitDefinition(entry?.serving_unit_norm)?.group || null;
              return servingGroup && recipeGroup && servingGroup === recipeGroup;
            });
            reason = hasSameGroup ? 'no-convertible-variant' : 'missing-cross-factor';
          }
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

        if (!reason && (!variant || !Number.isFinite(convertedAmount))) {
          reason = 'no-convertible-variant';
        }

        if (!reason) {
          const required = [
            variant.calories_kcal,
            variant.protein_g,
            variant.total_fat_g,
            variant.saturated_fat_g,
            variant.total_carbs_g,
            variant.sugars_g,
            variant.fiber_g,
            variant.sodium_mg,
            variant.calcium_mg,
            variant.iron_mg,
            variant.potassium_mg,
            variant.vitamin_c_mg,
          ];
          if (required.some((value) => !Number.isFinite(value))) {
            reason = 'non-numeric-fields';
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
          nutrition_variants_units: variantUnits.join(','),
          suggested_target_unit: suggestedTargetUnit,
          unit_world_mismatch_type: mismatchType,
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
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  if (!fs.existsSync(builtRecipesPath)) {
    throw new Error('Missing docs/built/recipes.json. Run the build first.');
  }
  const recipes = JSON.parse(fs.readFileSync(builtRecipesPath, 'utf-8'));
  const catalogRows = loadIngredientCatalogRows(catalogPath);
  const unitFactors = buildIngredientUnitFactorsFromCatalog(catalogRows);
  const ingredientPortions = buildIngredientPortionsFromCatalog(catalogRows);
  const missing = generateNutritionCoverageReport(recipes, unitFactors, ingredientPortions);
  const outputPath = path.join(process.cwd(), 'docs', 'built', 'nutrition_coverage_report.csv');
  const missingCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason,nutrition_variants_units,suggested_target_unit,unit_world_mismatch_type',
    ...missing.map((row) =>
      [
        csvEscape(row.ingredient_id),
        csvEscape(row.unit_norm),
        csvEscape(row.example_recipe_id),
        csvEscape(row.count_occurrences),
        csvEscape(row.example_qty),
        csvEscape(row.reason),
        csvEscape(row.nutrition_variants_units),
        csvEscape(row.suggested_target_unit),
        csvEscape(row.unit_world_mismatch_type),
      ].join(',')
    ),
  ].join('\n');
  fs.writeFileSync(outputPath, `${missingCsv}\n`);
  console.log(`Wrote ${missing.length} missing rows to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
