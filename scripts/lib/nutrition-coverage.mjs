import { normalizeUnit, unitDefinition, convertUnitAmount } from '../../docs/unit-conversions.js';
import { toCsv } from './csv.mjs';

export function parseRatioToNumber(raw) {
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

export function parseNumericField(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function selectNutritionVariant(variants, normalizedUnit, amount) {
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

export function selectVariantWithFactor(ingredientId, amount, normalizedUnit, variants, unitFactors) {
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

export function selectVariantWithPortion(ingredientId, amount, normalizedUnit, variants, ingredientPortions) {
  if (!ingredientId || !Array.isArray(variants) || !ingredientPortions) return null;
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
      return {
        variant: match.variant,
        convertedAmount: match.convertedAmount,
        bridge: portion,
      };
    }
  }
  return null;
}

export function listVariantUnits(variants) {
  if (!Array.isArray(variants)) return [];
  const seen = new Set();
  variants.forEach((entry) => {
    const unit = entry?.serving_unit_norm;
    if (unit) seen.add(unit);
  });
  return [...seen];
}

export function pickSuggestedTargetUnit(normalizedUnit, variants) {
  const units = listVariantUnits(variants);
  if (!units.length) return '';
  const recipeGroup = unitDefinition(normalizedUnit)?.group || null;
  if (recipeGroup) {
    const sameGroup = units.find((unit) => unitDefinition(unit)?.group === recipeGroup);
    if (sameGroup) return sameGroup;
  }
  return units[0];
}

export function classifyUnitWorldMismatch(normalizedUnit, targetUnit) {
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

export function buildIngredientNutritionVariantsFromCatalog(rows) {
  const parsed = rows || [];
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
      source: row.nutrition_source || '',
      notes: row.nutrition_notes || '',
    });
  });
  return map;
}

export function buildIngredientUnitFactorsFromCatalog(rows) {
  const parsed = rows || [];
  const map = new Map();
  parsed.forEach((row) => {
    if (!row?.ingredient_id) return;
    const fromUnit = normalizeUnit(row.unit_factor_from_unit_norm);
    const toUnit = normalizeUnit(row.unit_factor_to_unit_norm);
    const factor = parseNumericField(row.unit_factor);
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

export function buildIngredientPortionsFromCatalog(rows) {
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

export function selectDefaultOption(tokenData, choice) {
  if (!tokenData?.options?.length) return null;
  if (!tokenData.isChoice) return tokenData.options[0];
  const preferred = choice?.default_option;
  if (preferred) {
    return tokenData.options.find((opt) => opt.option === preferred) || tokenData.options[0];
  }
  const withOption = tokenData.options.find((opt) => opt.option);
  return withOption || tokenData.options[0];
}

export function generateNutritionCoverageReport(recipes, nutritionVariants, unitFactors, ingredientPortions, recipesById = null) {
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
      const variants = nutritionVariants.get(option.ingredient_id) || [];
      let reason = null;
      const variantUnits = listVariantUnits(variants);
      const suggestedTargetUnit = pickSuggestedTargetUnit(normalizedUnit, variants);
      const mismatchType = classifyUnitWorldMismatch(normalizedUnit, suggestedTargetUnit);

      if (normalizedUnit === 'recipe') {
        if (!recipesById?.has?.(option.ingredient_id)) {
          reason = 'recipe-reference-needed';
        }
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

        if (!variant) {
          const recipeGroup = unitDefinition(normalizedUnit)?.group || null;
          const hasSameGroup = variants.some((entry) => {
            const servingGroup = unitDefinition(entry?.serving_unit_norm)?.group || null;
            return servingGroup && recipeGroup && servingGroup === recipeGroup;
          });
          reason = hasSameGroup ? 'no-convertible-variant' : 'missing-cross-factor';
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

  return [...missing.values()].sort((a, b) =>
    a.ingredient_id.localeCompare(b.ingredient_id) || a.unit_norm.localeCompare(b.unit_norm)
  );
}

export function coverageReportCSV(rows) {
  return toCsv(['ingredient_id', 'unit_norm', 'example_recipe_id', 'count_occurrences',
    'example_qty', 'reason', 'nutrition_variants_units', 'suggested_target_unit',
    'unit_world_mismatch_type'], rows);
}
