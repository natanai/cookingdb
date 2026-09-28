import assert from 'node:assert/strict';
import * as units from './unit-conversions.js';
import * as browser from './recipe-utils.js';

// Existing page imports must resolve to the same rules used by build tools.
for (const name of ['UNIT_ALIASES', 'normalizeUnit', 'unitDefinition', 'convertUnitAmount']) {
  assert.equal(browser[name], units[name], `${name} must retain its public browser API`);
}
for (const [input, expected] of [
  [' Tablespoons ', 'tbsp'], ['FLUID OUNCES', 'fl_oz'], ['fl-oz', 'fl_oz'],
  ['pieces', 'count'], ['bunches', 'count'], ['cloves', 'clove'],
  ['dash', 'tsp'], ['drop', 'tsp'], [' Custom unit ', 'custom unit'],
  ['', null], ['  ', null], [null, null], [undefined, null],
]) assert.equal(units.normalizeUnit(input), expected);

assert.deepEqual(units.convertUnitAmount(1, 'cup', 'ml'), { amount: 240, unit: 'ml' });
assert.deepEqual(units.convertUnitAmount(1, 'lb', 'g'), { amount: 453.592, unit: 'g' });
assert.equal(units.convertUnitAmount(1, 'g', 'ml'), null, 'density requires ingredient-specific data');
assert.equal(units.convertUnitAmount(1, 'count', 'g'), null, 'count mass requires portion data');
assert.equal(units.convertUnitAmount(Infinity, 'g', 'kg'), null);
assert.equal(units.convertUnitAmount(1, 'unknown', 'g'), null);
// Alias normalization remains explicit; conversion accepts canonical IDs.
assert.equal(units.unitDefinition('cups'), null);
assert.equal(units.convertUnitAmount(1, units.normalizeUnit('cups'), 'tbsp').amount, 16);
for (const group of Object.values(units.UNIT_CONVERSIONS)) {
  for (const from of Object.keys(group.units)) {
    assert.equal(units.normalizeUnit(from), from);
    for (const to of Object.keys(group.units)) {
      const converted = units.convertUnitAmount(2.75, from, to);
      const restored = units.convertUnitAmount(converted.amount, to, from);
      assert.ok(Math.abs(restored.amount - 2.75) < 1e-10, `${from} -> ${to} round trip`);
    }
  }
}
console.log('Shared unit semantics and browser compatibility passed.');
