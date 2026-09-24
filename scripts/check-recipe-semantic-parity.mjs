import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts', 'baselines', 'recipe-semantics-4106cf3.json');
const recipesPath = path.join(root, 'docs', 'built', 'recipes.json');

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
const byId = new Map(recipes.map((recipe) => [String(recipe.id), recipe]));

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function project(recipe, undefinedAsNull = false) {
  const out = {};
  for (const field of baseline.fields) {
    const value = recipe?.[field];
    if (value !== undefined || undefinedAsNull) out[field] = value === undefined ? null : value;
  }
  return out;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])])
  );
}

const serializers = {
  ordered_compact: (recipe) => JSON.stringify(project(recipe)),
  ordered_compact_nulls: (recipe) => JSON.stringify(project(recipe, true)),
  ordered_pretty: (recipe) => JSON.stringify(project(recipe), null, 2),
  sorted_compact: (recipe) => JSON.stringify(sortDeep(project(recipe, true))),
  field_values_compact: (recipe) => JSON.stringify(baseline.fields.map((field) => recipe?.[field] ?? null)),
};

const baselineIds = Object.keys(baseline.recipes);
const currentIds = [...byId.keys()];
const missing = baselineIds.filter((id) => !byId.has(id));
const added = currentIds.filter((id) => !Object.hasOwn(baseline.recipes, id));

if (recipes.length !== baseline.recipe_count || missing.length || added.length) {
  console.error('Recipe semantic parity failed: recipe identity set changed.');
  console.error(`Baseline count: ${baseline.recipe_count}; current count: ${recipes.length}.`);
  if (missing.length) console.error(`Missing recipes: ${missing.join(', ')}`);
  if (added.length) console.error(`Added recipes: ${added.join(', ')}`);
  process.exit(1);
}

const scores = Object.entries(serializers).map(([name, serialize]) => {
  const matches = baselineIds.filter((id) => sha256(serialize(byId.get(id))) === baseline.recipes[id]);
  return { name, serialize, matches };
});
scores.sort((a, b) => b.matches.length - a.matches.length);

console.log(
  `Semantic baseline serializer probe: ${scores.map((entry) => `${entry.name}=${entry.matches.length}/${baselineIds.length}`).join(', ')}`
);

const best = scores[0];
if (!best || best.matches.length < Math.floor(baselineIds.length * 0.5)) {
  console.error(
    'Recipe semantic parity could not identify the historical baseline serialization reliably. ' +
      'Do not refresh the baseline; recover the original projection/hash contract first.'
  );
  process.exit(1);
}

const mismatches = baselineIds.filter(
  (id) => sha256(best.serialize(byId.get(id))) !== baseline.recipes[id]
);

if (mismatches.length) {
  console.error(
    `Recipe semantic parity found ${mismatches.length} changed recipe${mismatches.length === 1 ? '' : 's'} using ${best.name}:`
  );
  for (const id of mismatches) {
    console.error(`- ${id}: baseline=${baseline.recipes[id]} current=${sha256(best.serialize(byId.get(id)))}`);
  }
  console.error(
    'These differences need an explicit reviewed correction record before they can pass the merge gate.'
  );
  process.exit(1);
}

console.log(
  `Recipe semantic parity OK: ${recipes.length} recipes match baseline ${baseline.baseline_commit} using ${best.name}.`
);
