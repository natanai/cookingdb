export const UNIT_CONVERSIONS = {
  volume: {
    label: 'Volume',
    base: 'ml',
    units: {
      tsp: { label: 'teaspoon', plural: 'teaspoons', to_base: 5 },
      tbsp: { label: 'tablespoon', plural: 'tablespoons', to_base: 15 },
      cup: { label: 'cup', plural: 'cups', to_base: 240 },
      fl_oz: { label: 'fl oz', plural: 'fl oz', to_base: 30 },
      pint: { label: 'pint', plural: 'pints', to_base: 480 },
      quart: { label: 'quart', plural: 'quarts', to_base: 960 },
      gallon: { label: 'gallon', plural: 'gallons', to_base: 3840 },
      ml: { label: 'mL', plural: 'mL', to_base: 1 },
      l: { label: 'liter', plural: 'liters', to_base: 1000 }
    }
  },
  mass: {
    label: 'Mass',
    base: 'g',
    units: {
      g: { label: 'gram', plural: 'grams', to_base: 1 },
      kg: { label: 'kilogram', plural: 'kilograms', to_base: 1000 },
      oz: { label: 'ounce', plural: 'ounces', to_base: 28.3495 },
      lb: { label: 'pound', plural: 'pounds', to_base: 453.592 }
    }
  },
  count: {
    label: 'Count',
    base: 'count',
    units: {
      count: { label: 'count', plural: 'count', to_base: 1 }
    }
  }
};

// Shared by browser rendering, validation, building, and coverage reporting.
// These aliases preserve existing recipe semantics, including legacy count/dash rules.
export const UNIT_ALIASES = new Map([
  ['cloves', 'clove'],
  ['clove', 'clove'],
  ['sprigs', 'sprig'],
  ['sprig', 'sprig'],
  ['leaves', 'leaf'],
  ['leaf', 'leaf'],
  ['pieces', 'count'],
  ['piece', 'count'],
  ['packages', 'package'],
  ['package', 'package'],
  ['bags', 'bag'],
  ['bag', 'bag'],
  ['bunches', 'count'],
  ['bunch', 'count'],
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
  ['dash', 'tsp'],
  ['drop', 'tsp'],
]);

export function normalizeUnit(unit) {
  if (!unit) return null;
  const cleaned = String(unit).trim().toLowerCase();
  if (!cleaned) return null;
  return UNIT_ALIASES.get(cleaned) || cleaned;
}

export function unitDefinition(unitId) {
  if (!unitId) return null;
  const normalized = String(unitId).toLowerCase();
  for (const [groupName, group] of Object.entries(UNIT_CONVERSIONS)) {
    const def = group.units[normalized];
    if (def) return { ...def, id: normalized, group: groupName };
  }
  return null;
}

export function convertUnitAmount(amount, fromUnit, toUnit) {
  if (!Number.isFinite(amount)) return null;
  const fromDef = unitDefinition(fromUnit);
  const toDef = unitDefinition(toUnit);
  if (!fromDef || !toDef || fromDef.group !== toDef.group) return null;
  const amountInBase = amount * fromDef.to_base;
  const converted = amountInBase / toDef.to_base;
  return { amount: converted, unit: toDef.id };
}
