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
  ['tablespoons', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['teaspoons', 'tsp'],
  ['teaspoon', 'tsp'],
  ['cups', 'cup'],
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

function amountToGrams(ingredientId, amount, unit, portions) {
  if (!ingredientId || !Number.isFinite(amount)) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (!normalizedUnit) return null;

  const def = unitDefinition(normalizedUnit);
  if (def?.group === 'mass') {
    return convertUnitAmount(amount, normalizedUnit, 'g')?.amount ?? null;
  }

  if (def?.group === 'volume') {
    const direct = gramsPerUnitFromPortions(ingredientId, normalizedUnit, portions);
    if (Number.isFinite(direct)) {
      return amount * direct;
    }
    const asMl = convertUnitAmount(amount, normalizedUnit, 'ml');
    const gramsPerMl = gramsPerUnitFromPortions(ingredientId, 'ml', portions);
    if (asMl && Number.isFinite(gramsPerMl)) {
      return asMl.amount * gramsPerMl;
    }
    const asTsp = convertUnitAmount(amount, normalizedUnit, 'tsp');
    const gramsPerTsp = gramsPerUnitFromPortions(ingredientId, 'tsp', portions);
    if (asTsp && Number.isFinite(gramsPerTsp)) {
      return asTsp.amount * gramsPerTsp;
    }
    return null;
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

function generateMissingPortionsReport(recipes, portions) {
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
      const grams = amountToGrams(option.ingredient_id, amount, option.unit, portions);
      const nutrition = option.nutrition;
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
  const missing = generateMissingPortionsReport(recipes, portions);
  const outputPath = path.join(process.cwd(), 'docs', 'built', 'missing_portions.csv');
  const missingCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason',
    ...missing.map((row) =>
      [
        row.ingredient_id,
        row.unit_norm,
        row.example_recipe_id,
        row.count_occurrences,
        row.example_qty,
        row.reason,
      ].join(',')
    ),
  ].join('\n');
  fs.writeFileSync(outputPath, `${missingCsv}\n`);
  console.log(`Wrote ${missing.length} missing rows to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
