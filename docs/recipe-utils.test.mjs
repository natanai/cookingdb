import assert from 'node:assert/strict';
import {
  convertUnitAmount,
  formatAmountForDisplay,
  formatUnitLabel,
  ingredientDisplay,
} from './recipe-utils.js';

function runTests() {
  const fracFriendly = formatAmountForDisplay(1.5);
  assert.equal(fracFriendly, '1 1/2', 'should keep simple cooking fractions');

  const gramsToOz = convertUnitAmount(100, 'g', 'oz');
  assert(gramsToOz, 'conversion for grams to ounces should succeed');
  const roundedOz = formatAmountForDisplay(gramsToOz.amount);
  assert.equal(roundedOz, '3.53', 'awkward conversions should use rounded decimals');

  const mlToCup = convertUnitAmount(500, 'ml', 'cup');
  assert(mlToCup, 'conversion for milliliters to cups should succeed');
  const decimalCup = formatAmountForDisplay(mlToCup.amount);
  assert.equal(decimalCup, '2.08', 'metric to imperial should allow decimal display');

  assert.equal(formatUnitLabel('tbsp', 1), 'tablespoon', 'singular labels stay singular');
  assert.equal(formatUnitLabel('tbsp', 2), 'tablespoons', 'plural labels switch for larger amounts');

  const sugar = { ratio: '1', unit: 'cup', display: 'sugar' };
  const sugarDisplay = ingredientDisplay(sugar, 1, 'tbsp');
  assert.equal(sugarDisplay.amountStr, '16.23', 'converted amount should be rounded when not near a neat fraction');
  assert.equal(sugarDisplay.convertedUnitLabel, 'tablespoons', 'converted unit label should pluralize');
  assert.equal(sugarDisplay.baseUnitLabel, 'cup', 'base unit label should stay singular');

  return 'All tests passed';
}

console.log(runTests());
