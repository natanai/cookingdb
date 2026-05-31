import fs from 'node:fs';

const recipeHtml = fs.readFileSync('docs/recipe.html', 'utf8');
const styles = fs.readFileSync('docs/styles.css', 'utf8');
const recipeJs = fs.readFileSync('docs/recipe.js', 'utf8');

const requiredPrintIds = [
  'print-recipe',
  'print-recipe-title',
  'print-ingredients-list',
  'print-steps-list',
];

for (const id of requiredPrintIds) {
  if (!recipeHtml.includes(`id="${id}"`) && !recipeHtml.includes(`id='${id}'`)) {
    throw new Error(`Missing required print element: #${id}`);
  }
}

if (!recipeJs.includes('function renderPrintRecipe') && !recipeJs.includes('renderPrintRecipe =')) {
  throw new Error('Missing renderPrintRecipe() print snapshot renderer.');
}

if (!recipeJs.includes('renderPrintRecipe(recipe, state)')) {
  throw new Error('renderPrintRecipe(recipe, state) must be called from the recipe rerender flow.');
}

if (!recipeJs.includes('renderIngredientLines')) {
  throw new Error('Print rendering must use canonical renderIngredientLines().');
}

if (!recipeJs.includes('renderStepLines')) {
  throw new Error('Print rendering must use canonical renderStepLines().');
}

if (!styles.includes('#print-recipe')) {
  throw new Error('Print stylesheet must explicitly target #print-recipe.');
}

if (!styles.includes('visibility: hidden') || !styles.includes('visibility: visible')) {
  throw new Error('Print stylesheet should explicitly hide non-print UI and reveal #print-recipe.');
}

const negativeSectionHeaderMarginPattern =
  /#print-recipe\s+\.print-section-header\s*\{[^}]*margin(?:-left)?\s*:[^;}]*-\s*(?:\d|\.)/;

if (negativeSectionHeaderMarginPattern.test(styles)) {
  throw new Error('Print section headers must not use negative margins; they can be clipped in print preview.');
}

const negativePrintMarginPattern =
  /#print-recipe[^{}]*\{[^{}]*margin(?:-left)?\s*:[^;}]*-\s*(?:\d|\.)/;

if (negativePrintMarginPattern.test(styles)) {
  throw new Error('Print layout should not use negative margins inside #print-recipe.');
}

console.log('Print contract passed');
