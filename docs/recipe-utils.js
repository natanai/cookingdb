import { UNIT_CONVERSIONS } from './unit-conversions.js';

export const DIETARY_TAGS = {
  gluten_free: { positive: 'Gluten-free ready', negative: 'Contains gluten' },
  egg_free: { positive: 'Egg-free friendly', negative: 'Contains egg' },
  dairy_free: { positive: 'Dairy-free ready', negative: 'Contains dairy' },
};

export function restrictionsActive(prefs) {
  return prefs.gluten_free || prefs.egg_free || prefs.dairy_free;
}

export function parseRatio(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  let whole = 0;
  let fracPart = trimmed;
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(' ');
    whole = Number(parts[0]);
    fracPart = parts[1];
  }
  let num;
  let den;
  if (fracPart.includes('/')) {
    const [n, d] = fracPart.split('/');
    num = Number(n);
    den = Number(d);
  } else {
    num = Number(fracPart);
    den = 1;
  }
  if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  const totalNum = whole * den + num;
  return simplify({ num: totalNum, den });
}

export function simplify(frac) {
  const gcd = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
    return b === 0 ? a : gcd(b, a % b);
  };
  const g = gcd(Math.abs(frac.num), Math.abs(frac.den));
  return { num: frac.num / g, den: frac.den / g };
}

export function decimalToFraction(value, maxDen = 16) {
  const den = maxDen;
  const num = Math.round(value * den);
  return simplify({ num, den });
}

export function multiplyFraction(frac, multiplier) {
  if (!frac) return null;
  const multFrac = decimalToFraction(multiplier);
  return simplify({ num: frac.num * multFrac.num, den: frac.den * multFrac.den });
}

export function formatFraction(frac) {
  if (!frac) return '';
  const whole = Math.trunc(frac.num / frac.den);
  const remainder = Math.abs(frac.num % frac.den);
  if (remainder === 0) return `${whole}`;
  if (whole === 0) return `${frac.num}/${frac.den}`;
  return `${whole} ${remainder}/${frac.den}`;
}

export function pluralize(display, amount, unit) {
  if (unit === 'count') {
    if (Math.abs(amount - 1) < 1e-9) return display;
    if (display.endsWith('s')) return display;
    return `${display}s`;
  }
  return display;
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

export function unitOptionsFor(unitId) {
  const def = unitDefinition(unitId);
  if (!def) return [];
  const group = UNIT_CONVERSIONS[def.group];
  return Object.entries(group.units).map(([id, meta]) => ({
    id,
    label: meta.plural || meta.label || id,
  }));
}

export function formatUnitLabel(unitId) {
  const def = unitDefinition(unitId);
  if (!def) return unitId || '';
  return def.label || unitId;
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

export function formatAmountForDisplay(amount) {
  if (!Number.isFinite(amount)) return '';
  const frac = decimalToFraction(amount);
  return formatFraction(frac);
}

export function getEffectiveMultiplier(state) {
  return (Number(state.multiplier) || 1) * (Number(state.panMultiplier) || 1);
}

export function optionMeetsRestrictions(option, restrictions) {
  if (!option || !option.dietary) return true;
  if (restrictions.gluten_free && !option.dietary.gluten_free) return false;
  if (restrictions.egg_free && !option.dietary.egg_free) return false;
  if (restrictions.dairy_free && !option.dietary.dairy_free) return false;
  return true;
}

export function alternativeOptions(tokenData, state, selectedOption) {
  if (!tokenData?.isChoice) return [];
  const choiceOptions = tokenData.options.filter((opt) => opt.option);
  const compatible = restrictionsActive(state.restrictions)
    ? choiceOptions.filter((opt) => optionMeetsRestrictions(opt, state.restrictions))
    : choiceOptions;
  return compatible.filter((opt) => opt.option !== selectedOption?.option);
}

export function defaultOptionForToken(token, recipe) {
  const tokenData = recipe.ingredients[token];
  if (!tokenData) return null;
  if (!tokenData.isChoice) return tokenData.options[0] || null;

  const options = tokenData.options.filter((opt) => opt.option);
  const preferred = recipe.choices?.[token]?.default_option;
  return (
    options.find((opt) => opt.option === preferred) || options[0] || tokenData.options[0] || null
  );
}

export function recipeDefaultCompatibility(recipe) {
  const restrictions = { gluten_free: true, egg_free: true, dairy_free: true };
  Object.keys(recipe.ingredients || {}).forEach((token) => {
    const option = defaultOptionForToken(token, recipe);
    Object.keys(restrictions).forEach((restriction) => {
      if (option?.dietary && option.dietary[restriction] === false) {
        restrictions[restriction] = false;
      }
    });
  });
  return restrictions;
}

export function hasNonCompliantAlternative(recipe, restriction) {
  return Object.values(recipe.ingredients || {}).some((tokenData) => {
    if (!tokenData.isChoice) return false;
    return tokenData.options.some((opt) => opt.option && opt.dietary && opt.dietary[restriction] === false);
  });
}

export function selectOptionForToken(token, recipe, state) {
  const tokenData = recipe.ingredients[token];
  if (!tokenData) return null;
  if (!tokenData.isChoice) return tokenData.options[0];

  const selectedKey = state.selectedOptions[token] || recipe.choices?.[token]?.default_option;
  const options = tokenData.options.filter((opt) => opt.option);
  let selected = options.find((opt) => opt.option === selectedKey) || options[0];

  const compatibleOptions = options.filter((opt) => optionMeetsRestrictions(opt, state.restrictions));
  if (restrictionsActive(state.restrictions) && compatibleOptions.length > 0) {
    if (!optionMeetsRestrictions(selected, state.restrictions)) {
      selected =
        compatibleOptions.find((opt) => opt.option === state.selectedOptions[token]) ||
        compatibleOptions.find((opt) => opt.option === recipe.choices?.[token]?.default_option) ||
        compatibleOptions[0];
    }
  }

  if (selected && selected.option && state.selectedOptions[token] !== selected.option) {
    state.selectedOptions[token] = selected.option;
  }

  return selected || tokenData.options[0];
}

export function renderIngredientEntry(option, multiplier, selectedUnit) {
  if (!option) return '';
  if (!option.ratio) return option.display;
  const baseFraction = parseRatio(option.ratio);
  if (!baseFraction) return option.display;
  const scaled = multiplyFraction(baseFraction, multiplier);
  const baseAmount = scaled ? scaled.num / scaled.den : null;

  const targetUnit = selectedUnit || option.unit;
  let displayAmount = baseAmount;
  let displayUnit = option.unit;

  if (baseAmount !== null && targetUnit && option.unit) {
    const converted = convertUnitAmount(baseAmount, option.unit, targetUnit);
    if (converted) {
      displayAmount = converted.amount;
      displayUnit = converted.unit;
    } else {
      displayUnit = option.unit;
    }
  } else {
    displayUnit = targetUnit || option.unit;
  }

  const amountStr = displayAmount !== null ? formatAmountForDisplay(displayAmount) : '';
  const unitLabel = displayUnit ? ` ${formatUnitLabel(displayUnit)}` : '';
  const displayName = pluralize(option.display, displayAmount ?? 0, option.unit);
  return `${amountStr}${unitLabel} ${displayName}`.trim();
}

export function formatStepText(stepText, recipe, state) {
  const multiplier = getEffectiveMultiplier(state);
  return stepText.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (match, token) => {
    const option = selectOptionForToken(token, recipe, state);
    const selectedUnit = state?.unitSelections?.[token];
    return renderIngredientEntry(option, multiplier, selectedUnit);
  });
}

export function renderIngredientLines(recipe, state) {
  const lines = [];
  const multiplier = getEffectiveMultiplier(state);
  (recipe.token_order || []).forEach((token) => {
    const tokenData = recipe.ingredients[token];
    if (!tokenData) return;
    const option = selectOptionForToken(token, recipe, state);
    const selectedUnit = state?.unitSelections?.[token];
    const line = { text: renderIngredientEntry(option, multiplier, selectedUnit), alternatives: [] };
    const alternatives = alternativeOptions(tokenData, state, option);
    if (alternatives.length) {
      line.alternatives = alternatives.map((opt) => renderIngredientEntry(opt, multiplier, selectedUnit));
    }
    lines.push(line);
  });
  return lines;
}

export function renderStepLines(recipe, state) {
  const lines = [];
  const stepLines = (recipe.steps_raw || '').split(/\n/).filter((line) => line.trim() !== '');
  stepLines.forEach((line) => {
    lines.push(formatStepText(line.replace(/^\d+\.\s*/, ''), recipe, state));
  });
  return lines;
}
