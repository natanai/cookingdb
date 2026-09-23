import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

const root = process.cwd();

function fail(message) {
  throw new Error(`Legacy CSV repair stopped safely: ${message}`);
}

function writeIfChanged(file, before, after) {
  if (before === after) return false;
  fs.writeFileSync(file, after);
  console.log(`Repaired ${path.relative(root, file).replaceAll('\\', '/')}`);
  return true;
}

function parserShapeErrors(source) {
  return Papa.parse(source, { header: true, skipEmptyLines: true }).errors.filter(
    (error) => error.code === 'TooFewFields' || error.code === 'TooManyFields'
  );
}

function repairCatalog() {
  const file = path.join(root, 'data', 'ingredient_catalog.csv');
  const before = fs.readFileSync(file, 'utf8');
  const lines = before.split(/\r?\n/);
  const edits = [
    { line: 78, prefix: 'ground-chicken,', kind: 'append-comma' },
    { line: 131, prefix: 'purple-cabbage,', kind: 'append-comma' },
    { line: 197, prefix: 'zucchini,', kind: 'remove-comma' },
    { line: 198, prefix: 'lemon-juice,', kind: 'remove-comma' },
  ];

  for (const edit of edits) {
    const index = edit.line - 1;
    const current = lines[index];
    if (!current?.startsWith(edit.prefix)) {
      fail(`expected ${edit.prefix} on ingredient catalog line ${edit.line}`);
    }
    if (edit.kind === 'append-comma') {
      lines[index] = `${current},`;
    } else {
      if (!current.endsWith(',,,,,')) {
        fail(`expected five trailing commas on ingredient catalog line ${edit.line}`);
      }
      lines[index] = current.slice(0, -1);
    }
  }

  const after = lines.join('\n');
  const remaining = parserShapeErrors(after);
  if (remaining.length) {
    fail(`ingredient catalog still has ${remaining.length} field-count parser issue(s)`);
  }
  return writeIfChanged(file, before, after);
}

function quoteUnquotedStepRows(relativePath) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const lines = before.split(/\r?\n/);
  if (lines[0] !== 'section,text') fail(`${relativePath} has an unexpected header`);

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) fail(`${relativePath}:${index + 1} is missing the section/text delimiter`);
    const section = line.slice(0, comma);
    const text = line.slice(comma + 1);
    if (text.startsWith('"') && text.endsWith('"')) continue;
    lines[index] = `${section},"${text.replaceAll('"', '""')}"`;
  }

  const after = lines.join('\n');
  const remaining = parserShapeErrors(after);
  if (remaining.length) {
    fail(`${relativePath} still has ${remaining.length} field-count parser issue(s)`);
  }
  return writeIfChanged(file, before, after);
}

let changed = 0;
if (repairCatalog()) changed += 1;
for (const relativePath of [
  'recipes/anti-histamine-turkey-kale-sweet-potato-skillet/steps.csv',
  'recipes/brown-rice/steps.csv',
  'recipes/nanaimo-bars/steps.csv',
  'recipes/russian-teacakes/steps.csv',
  'recipes/veggie-teriyaki-stir-fry-noodles/steps.csv',
]) {
  if (quoteUnquotedStepRows(relativePath)) changed += 1;
}

console.log(`Legacy CSV repair complete: ${changed} file${changed === 1 ? '' : 's'} changed.`);
