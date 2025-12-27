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

function parseNumericField(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildIngredientDb(rows) {
  const db = new Map();
  rows.forEach((row) => {
    if (!row?.ingredient_id) return;
    if (db.has(row.ingredient_id)) return;
    const servingGrams = parseNumericField(row.serving_grams);
    const gramsPerUnit = {};
    GRAMS_PER_COLUMNS.forEach(({ column, unit }) => {
      const grams = parseNumericField(row[column]);
      if (Number.isFinite(grams) && grams > 0) {
        gramsPerUnit[unit] = grams;
      }
    });
    const calories = parseNumericField(row.calories_per_unit);
    db.set(row.ingredient_id, {
      ingredient_id: row.ingredient_id,
      nutrition_unit_norm: normalizeUnit(row.nutrition_unit) || null,
      serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
      grams_per_unit: gramsPerUnit,
      calories_per_g: Number.isFinite(servingGrams) && Number.isFinite(calories)
        ? calories / servingGrams
        : null,
    });
  });
  return db;
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
        } else if (!Number.isFinite(ingredient?.calories_per_g)) {
          if (!Number.isFinite(ingredient?.serving_grams)) {
            reason = 'missing-serving-grams';
            suggestedColumn = 'serving_grams';
          } else {
            reason = 'missing-nutrition';
            suggestedColumn = 'calories_per_unit';
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
  return [...missing.values()];
}

function main() {
  const builtRecipesPath = path.join(process.cwd(), 'docs', 'built', 'recipes.json');
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  if (!fs.existsSync(builtRecipesPath)) {
    throw new Error('Missing docs/built/recipes.json. Run the build first.');
  }
  if (!fs.existsSync(catalogPath)) {
    throw new Error('Missing data/ingredient_catalog.csv.');
  }
  const recipes = JSON.parse(fs.readFileSync(builtRecipesPath, 'utf-8'));
  const catalogRows = simpleParseCSV(fs.readFileSync(catalogPath, 'utf-8'));
  const ingredientDb = buildIngredientDb(catalogRows);
  const recipeIndex = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const missing = generateNutritionCoverageReport(recipes, ingredientDb, recipeIndex);
  const outputPath = path.join(process.cwd(), 'docs', 'built', 'nutrition_coverage_report.csv');
  const missingCsv = [
    'ingredient_id,unit_norm,example_recipe_id,count_occurrences,example_qty,reason,suggested_column_to_fill,notes',
    ...missing.map((row) =>
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
  fs.writeFileSync(outputPath, `${missingCsv}\n`);
  console.log(`Wrote ${missing.length} missing rows to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
