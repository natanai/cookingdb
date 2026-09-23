import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

const root = process.cwd();
const files = [path.join(root, 'data', 'ingredient_catalog.csv')];
const recipesDir = path.join(root, 'recipes');

for (const entry of fs.readdirSync(recipesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(recipesDir, entry.name);
  for (const name of ['meta.csv', 'ingredients.csv', 'choices.csv', 'steps.csv']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) files.push(file);
  }
}

let issueCount = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: true });
  for (const error of parsed.errors || []) {
    issueCount += 1;
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const physicalRow = Number.isInteger(error.row) ? error.row + 2 : '?';
    console.log(`${relative}:${physicalRow} [${error.code || error.type || 'CSV'}] ${error.message}`);
  }
}

console.log(`CSV audit complete: ${issueCount} parser issue${issueCount === 1 ? '' : 's'} across ${files.length} files.`);
