import fs from 'fs';
import path from 'path';
import { UNIT_CONVERSIONS } from '../docs/unit-conversions.js';

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

function simpleParseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split(/\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? '';
    });
    return row;
  });
  return { headers, rows };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseNumeric(value) {
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

const NEW_COLUMNS = ['serving_grams', ...GRAMS_PER_COLUMNS.map((entry) => entry.column)];

function parseServingGrams(servingSize) {
  if (!servingSize) return null;
  const text = String(servingSize);
  const gMatch = text.match(/\((?:[^0-9]*)(\d+(?:\.\d+)?)\s*g\)/i);
  if (gMatch) return Number(gMatch[1]);
  const ozMatch = text.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) return Number(ozMatch[1]) * 28.3495;
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return Number(mlMatch[1]) * 1.0;
  return null;
}

function setIfBlank(row, column, value) {
  if (!column || value === null || value === undefined) return;
  if (row[column] === undefined || row[column] === '') {
    row[column] = String(value);
  }
}

function applyPortionRow(rowMap, portion) {
  if (!portion?.ingredient_id) return;
  const catalogRow = rowMap.get(portion.ingredient_id);
  if (!catalogRow) return;
  const unit = normalizeUnit(portion.unit);
  const grams = parseNumeric(portion.grams);
  if (!unit || !Number.isFinite(grams)) return;

  const directColumn = GRAMS_PER_COLUMNS.find((entry) => entry.unit === unit)?.column;
  if (directColumn) {
    setIfBlank(catalogRow, directColumn, grams);
    return;
  }

  const volumeConversion = convertUnitAmount(1, unit, 'ml');
  if (volumeConversion && Number.isFinite(volumeConversion.amount) && volumeConversion.amount > 0) {
    const gramsPerMl = grams / volumeConversion.amount;
    setIfBlank(catalogRow, 'grams_per_tsp', gramsPerMl * 5);
    setIfBlank(catalogRow, 'grams_per_tbsp', gramsPerMl * 15);
    setIfBlank(catalogRow, 'grams_per_cup', gramsPerMl * 240);
    setIfBlank(catalogRow, 'grams_per_pint', gramsPerMl * 480);
  }
}

function applyUnitFactorRow(rowMap, factorRow) {
  if (!factorRow?.ingredient_id) return;
  const catalogRow = rowMap.get(factorRow.ingredient_id);
  if (!catalogRow) return;
  const fromUnit = normalizeUnit(factorRow.from_unit_norm);
  const toUnit = normalizeUnit(factorRow.to_unit_norm);
  const factor = parseNumeric(factorRow.factor);
  if (!fromUnit || !toUnit || !Number.isFinite(factor)) return;
  const fromColumn = GRAMS_PER_COLUMNS.find((entry) => entry.unit === fromUnit)?.column;
  if (!fromColumn) return;
  const conversion = convertUnitAmount(1, toUnit, 'g');
  if (!conversion || !Number.isFinite(conversion.amount)) return;
  const gramsPerFrom = factor * conversion.amount;
  setIfBlank(catalogRow, fromColumn, gramsPerFrom);
}

function main() {
  const catalogPath = path.join(process.cwd(), 'data', 'ingredient_catalog.csv');
  if (!fs.existsSync(catalogPath)) {
    throw new Error('Missing data/ingredient_catalog.csv');
  }
  const { headers, rows } = simpleParseCSV(fs.readFileSync(catalogPath, 'utf-8'));
  const updatedHeaders = [...headers];
  NEW_COLUMNS.forEach((column) => {
    if (!updatedHeaders.includes(column)) updatedHeaders.push(column);
  });
  rows.forEach((row) => {
    NEW_COLUMNS.forEach((column) => {
      if (!(column in row)) row[column] = '';
    });
  });
  const rowMap = new Map(rows.map((row) => [row.ingredient_id, row]));

  rows.forEach((row) => {
    if (!row) return;
    const existing = parseNumeric(row.serving_grams);
    if (!Number.isFinite(existing)) {
      const inferred = parseServingGrams(row.serving_size);
      if (Number.isFinite(inferred)) {
        row.serving_grams = String(inferred);
      }
    }
  });

  const portionsPath = fs.existsSync(path.join(process.cwd(), 'data', 'ingredient_portions.csv'))
    ? path.join(process.cwd(), 'data', 'ingredient_portions.csv')
    : path.join(process.cwd(), 'docs', 'generated', 'ingredient_portions.csv');
  if (fs.existsSync(portionsPath)) {
    const { rows: portions } = simpleParseCSV(fs.readFileSync(portionsPath, 'utf-8').replace(/^#.*\n/, ''));
    portions.forEach((portion) => applyPortionRow(rowMap, portion));
  }

  const unitFactorsPath = fs.existsSync(path.join(process.cwd(), 'data', 'ingredient_unit_factors.csv'))
    ? path.join(process.cwd(), 'data', 'ingredient_unit_factors.csv')
    : path.join(process.cwd(), 'docs', 'generated', 'ingredient_unit_factors.csv');
  if (fs.existsSync(unitFactorsPath)) {
    const { rows: factors } = simpleParseCSV(fs.readFileSync(unitFactorsPath, 'utf-8').replace(/^#.*\n/, ''));
    factors.forEach((row) => applyUnitFactorRow(rowMap, row));
  }

  const output = [
    updatedHeaders.join(','),
    ...rows.map((row) => updatedHeaders.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ].join('\n');
  fs.writeFileSync(catalogPath, `${output}\n`);
  console.log('Updated ingredient_catalog.csv with serving_grams and grams_per_* columns.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
