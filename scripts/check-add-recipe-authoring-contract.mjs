import fs from 'node:fs';

const html = fs.readFileSync(new URL('../docs/add.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/add.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('./build.mjs', import.meta.url), 'utf8');

const checks = [
  ['recipe title input', html.includes('id="title"')],
  ['servings/yield input', html.includes('id="servings-per-batch"')],
  ['category multiselect', html.includes('id="categories"') && html.includes('id="category-menu"')],
  ['family/source metadata', html.includes('id="family"')],
  ['byline metadata', html.includes('id="byline"')],
  ['notes metadata', html.includes('id="notes"')],
  ['batch multiplier metadata', html.includes('id="default-base"')],
  ['pan scaling metadata', html.includes('id="default-pan"')],
  ['ingredient sections', js.includes('createIngredientSection') && js.includes('start-section-here')],
  ['single contextual section creation flow', !html.includes('id="add-ingredient-section"') && js.includes('start-section-here')],
  ['ingredient prep metadata', js.includes('ingredient-prep') && js.includes('prep,')],
  ['ingredient line grouping', js.includes('ingredient-inline-group') && js.includes('line_group')],
  ['ingredient conditional dependencies', js.includes('ingredient-conditional-toggle') && js.includes('depends_on')],
  ['ingredient substitutions/choices', js.includes('ingredient-choice-toggle') && js.includes('choices')],
  ['choice defaults', js.includes('ingredient-default-choice') && js.includes('default_option')],
  ['step sections', js.includes('step-section') && js.includes('step_sections')],
  ['conditional step variations', js.includes('variation-token') && js.includes('{{#if')],
  ['structured ingredient references in steps', js.includes('{{${token}}}')],
  ['pan catalog published to Pages', build.includes("'pan-sizes.json'") && build.includes('JSON.stringify(panList')],
  ['byline emitted in inbox payload', js.includes('byline,')],
  ['default pan emitted in inbox payload', js.includes('default_pan: defaultPan || null')],
  ['pan sizes emitted in inbox payload', js.includes('pan_sizes: defaultPan')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Add Recipe authoring contract failed:');
  failed.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`Add Recipe authoring contract passed (${checks.length} capabilities checked).`);
