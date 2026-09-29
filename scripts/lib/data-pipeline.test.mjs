import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCSV, toCsv } from './csv.mjs';
import { generateNutritionCoverageReport } from './nutrition-coverage.mjs';

const rows = [{ section: 'main', text: 'Mix, then say "ready".\nBake.\rCool.' }];
assert.deepEqual(parseCSV(toCsv(['section', 'text'], rows)), rows);
assert.deepEqual(parseCSV('\uFEFFsection,text\r\nmain,"Mix, then bake"\r\n'), [{section:'main', text:'Mix, then bake'}]);
for (const bad of ['a,b\n1,2,3', 'a,b\n1', 'a,b\n1,"unclosed', 'a,a\n1,2']) {
  assert.throws(() => parseCSV(bad, 'fixture.csv'), /CSV parse error in fixture.csv/);
}
const variant = Object.fromEntries(['calories_kcal','protein_g','total_fat_g','saturated_fat_g','total_carbs_g','sugars_g','fiber_g','sodium_mg','calcium_mg','iron_mg','potassium_mg','vitamin_c_mg'].map(key=>[key,1]));
variant.serving_unit_norm = 'g';
const recipes = [{id:'portion-test', ingredients:{carrot:{options:[{ingredient_id:'carrot',ratio:'2',unit:'count'}]}}}];
const variants = new Map([['carrot',[variant]]]);
const portions = new Map([['carrot::count',{ingredient_id:'carrot',unit:'count',grams:61}]]);
assert.equal(generateNutritionCoverageReport(recipes,variants,new Map(),portions).length,0,
  'a successful portion bridge must not retain an earlier missing-factor error');
assert.equal(generateNutritionCoverageReport(recipes,variants,new Map(),new Map())[0].reason,'missing-cross-factor');
const reportPath = new URL('../../docs/built/nutrition_coverage_report.csv', import.meta.url);
const builtReport = fs.readFileSync(reportPath,'utf8');
execFileSync(process.execPath,['scripts/report_missing_portions.js']);
assert.equal(fs.readFileSync(reportPath,'utf8'),builtReport,'standalone report must agree with the build');
console.log('CSV round-trip, malformed input, portion regression, and build/report parity passed.');
