import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts', 'baselines', 'recipe-semantics-4106cf3.json');
const correctionsPath = path.join(root, 'scripts', 'baselines', 'recipe-semantic-corrections-4106cf3.json');
const recipesPath = path.join(root, 'docs', 'built', 'recipes.json');

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'));
const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
const byId = new Map(recipes.map((recipe) => [String(recipe.id), recipe]));
const correctionById = corrections.recipes || {};

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

if (corrections.baseline_commit !== baseline.baseline_commit) {
  console.error('Recipe semantic parity failed: correction record targets a different baseline commit.');
  console.error(`Baseline: ${baseline.baseline_commit}; corrections: ${corrections.baseline_commit || '(missing)'}.`);
  process.exit(1);
}

const correctionErrors = [];
for (const [id, correction] of Object.entries(correctionById)) {
  if (!Object.hasOwn(baseline.recipes, id)) {
    correctionErrors.push(`${id}: correction refers to a recipe outside the baseline`);
    continue;
  }
  if (correction?.baseline_hash !== baseline.recipes[id]) {
    correctionErrors.push(`${id}: correction baseline_hash does not match the locked baseline`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(correction?.approved_hash || ''))) {
    correctionErrors.push(`${id}: approved_hash is missing or invalid`);
  }
  if (!String(correction?.reason || '').trim()) {
    correctionErrors.push(`${id}: correction reason is required`);
  }
  if (!Array.isArray(correction?.evidence) || !correction.evidence.length) {
    correctionErrors.push(`${id}: correction evidence is required`);
  }
}

if (correctionErrors.length) {
  console.error('Recipe semantic parity failed: reviewed correction record is invalid.');
  for (const error of correctionErrors) console.error(`- ${error}`);
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

const reviewed = [];
const unexpected = [];
const stale = [];

for (const id of baselineIds) {
  const baselineHash = baseline.recipes[id];
  const currentHash = sha256(best.serialize(byId.get(id)));
  const correction = correctionById[id];

  if (currentHash === baselineHash) {
    if (correction) stale.push(id);
    continue;
  }

  if (correction?.approved_hash === currentHash) {
    reviewed.push({ id, reason: correction.reason });
    continue;
  }

  unexpected.push({
    id,
    baselineHash,
    currentHash,
    approvedHash: correction?.approved_hash || null,
  });
}

if (stale.length || unexpected.length) {
  console.error('Recipe semantic parity failed.');
  if (stale.length) {
    console.error('Stale correction records now match the original baseline and must be removed:');
    for (const id of stale) console.error(`- ${id}`);
  }
  if (unexpected.length) {
    console.error('Unexpected recipe semantic changes:');
    for (const entry of unexpected) {
      console.error(`- ${entry.id}: baseline=${entry.baselineHash} current=${entry.currentHash}`);
      if (entry.approvedHash) console.error(`  reviewed correction expected=${entry.approvedHash}`);
    }
  }
  console.error(
    'Do not refresh the baseline or correction hashes automatically. Investigate the source difference and record a reviewed correction only when it is intentional.'
  );
  process.exit(1);
}

const unchanged = baselineIds.length - reviewed.length;
console.log(
  `Recipe semantic parity OK: ${unchanged} unchanged + ${reviewed.length} reviewed correction${reviewed.length === 1 ? '' : 's'} against baseline ${baseline.baseline_commit} using ${best.name}.`
);
for (const entry of reviewed) {
  console.log(`- reviewed ${entry.id}: ${entry.reason}`);
}
