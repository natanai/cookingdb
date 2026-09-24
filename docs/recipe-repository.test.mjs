import assert from 'node:assert/strict';
import { buildRecipeIndex } from './recipe-repository.js';

const recipeIndex = buildRecipeIndex([
  { id: 'one', title: 'One' },
  { id: 'two', title: 'Two' },
  { id: 'one', title: 'One override' },
]);
assert.equal(recipeIndex.size, 2);
assert.equal(recipeIndex.get('one').title, 'One override');

console.log('Recipe repository tests passed.');
