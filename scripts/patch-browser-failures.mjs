import fs from 'node:fs';

function replaceOnce(file, before, after, label) {
  let source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Patch stopped safely: ${label} marker was not found in ${file}.`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch stopped safely: ${label} marker was not unique in ${file}.`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
  fs.writeFileSync(file, source);
}

replaceOnce(
  'docs/styles.css',
  'body.add-page .admin-edit-banner {\n  display: flex;',
  'body.add-page .admin-edit-banner[hidden] {\n  display: none;\n}\n\nbody.add-page .admin-edit-banner {\n  display: flex;',
  'hidden admin edit banner'
);

replaceOnce(
  'docs/recipe.js',
  '  getRecipeTitleParts,\n  recipeHasDetails,\n} from \'./recipe-model.js\';',
  '  getRecipeTitleParts,\n  normalizeRecipeEntry,\n  recipeHasDetails,\n} from \'./recipe-model.js\';',
  'recipe model import'
);

replaceOnce(
  'docs/recipe.js',
  '  const recipe = normalizeRecipeForPage(recipeInput) || recipeInput;',
  '  const recipe = normalizeRecipeEntry(recipeInput) || recipeInput;',
  'recipe normalization call'
);

console.log('Browser-discovered regressions repaired.');
