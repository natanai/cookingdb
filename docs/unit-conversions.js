export const UNIT_CONVERSIONS = {
  volume: {
    label: 'Volume',
    base: 'ml',
    units: {
      tsp: { label: 'teaspoon', plural: 'teaspoons', to_base: 4.92892 },
      tbsp: { label: 'tablespoon', plural: 'tablespoons', to_base: 14.7868 },
      cup: { label: 'cup', plural: 'cups', to_base: 240 },
      fl_oz: { label: 'fl oz', plural: 'fl oz', to_base: 29.5735 },
      pint: { label: 'pint', plural: 'pints', to_base: 473.176 },
      quart: { label: 'quart', plural: 'quarts', to_base: 946.353 },
      gallon: { label: 'gallon', plural: 'gallons', to_base: 3785.41 },
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
      count: { label: 'count', plural: 'count', to_base: 1 },
      clove: { label: 'clove', plural: 'cloves', to_base: 1 },
      cube: { label: 'cube', plural: 'cubes', to_base: 1 },
      recipe: { label: 'recipe', plural: 'recipes', to_base: 1 }
    }
  }
};

export const INGREDIENT_CONVERSION_FIELDS = [
  'grams_per_count',
  'tsp_per_sprig',
  'grams_per_cup'
];

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

export function convertUnitAmountWithFactors(amount, fromUnit, toUnit, conversions) {
  const direct = convertUnitAmount(amount, fromUnit, toUnit);
  if (direct) return direct;
  const fromDef = unitDefinition(fromUnit);
  const toDef = unitDefinition(toUnit);
  if (!fromDef || !toDef) return null;

  const gramsPerCount = coerceNumber(conversions?.grams_per_count);
  if (fromDef.group === 'count' && toDef.group === 'mass' && Number.isFinite(gramsPerCount) && gramsPerCount > 0) {
    const grams = amount * gramsPerCount;
    return convertUnitAmount(grams, 'g', toUnit);
  }
  if (fromDef.group === 'mass' && toDef.group === 'count' && Number.isFinite(gramsPerCount) && gramsPerCount > 0) {
    const grams = convertUnitAmount(amount, fromUnit, 'g');
    if (!grams) return null;
    return { amount: grams.amount / gramsPerCount, unit: toUnit };
  }

  const tspPerSprig = coerceNumber(conversions?.tsp_per_sprig);
  if (fromDef.group === 'count' && toDef.group === 'volume' && Number.isFinite(tspPerSprig) && tspPerSprig > 0) {
    const tsp = amount * tspPerSprig;
    return convertUnitAmount(tsp, 'tsp', toUnit);
  }
  if (fromDef.group === 'volume' && toDef.group === 'count' && Number.isFinite(tspPerSprig) && tspPerSprig > 0) {
    const tsp = convertUnitAmount(amount, fromUnit, 'tsp');
    if (!tsp) return null;
    return { amount: tsp.amount / tspPerSprig, unit: toUnit };
  }

  const gramsPerCup = coerceNumber(conversions?.grams_per_cup);
  if (fromDef.group === 'volume' && toDef.group === 'mass' && Number.isFinite(gramsPerCup) && gramsPerCup > 0) {
    const cups = convertUnitAmount(amount, fromUnit, 'cup');
    if (!cups) return null;
    const grams = cups.amount * gramsPerCup;
    return convertUnitAmount(grams, 'g', toUnit);
  }
  if (fromDef.group === 'mass' && toDef.group === 'volume' && Number.isFinite(gramsPerCup) && gramsPerCup > 0) {
    const grams = convertUnitAmount(amount, fromUnit, 'g');
    if (!grams) return null;
    const cups = grams.amount / gramsPerCup;
    return convertUnitAmount(cups, 'cup', toUnit);
  }

  if (fromDef.group === 'count' && toDef.group === 'volume' && Number.isFinite(gramsPerCount) && gramsPerCount > 0) {
    const grams = amount * gramsPerCount;
    return convertUnitAmountWithFactors(grams, 'g', toUnit, conversions);
  }
  if (fromDef.group === 'volume' && toDef.group === 'count' && Number.isFinite(gramsPerCount) && gramsPerCount > 0) {
    const grams = convertUnitAmountWithFactors(amount, fromUnit, 'g', conversions);
    if (!grams) return null;
    return { amount: grams.amount / gramsPerCount, unit: toUnit };
  }

  return null;
}
