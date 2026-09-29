import fs from 'node:fs';
import path from 'node:path';
import { parseCSVFile } from './lib/csv.mjs';
import {
  buildIngredientNutritionVariantsFromCatalog, buildIngredientUnitFactorsFromCatalog,
  buildIngredientPortionsFromCatalog, generateNutritionCoverageReport, coverageReportCSV,
} from './lib/nutrition-coverage.mjs';

const builtRecipesPath = path.join(process.cwd(), 'docs', 'built', 'recipes.json');
if (!fs.existsSync(builtRecipesPath)) {
  throw new Error('Missing docs/built/recipes.json. Run the build first.');
}
const recipes = JSON.parse(fs.readFileSync(builtRecipesPath, 'utf8'));
const catalog = parseCSVFile(path.join(process.cwd(), 'data', 'ingredient_catalog.csv'));
const missing = generateNutritionCoverageReport(
  recipes,
  buildIngredientNutritionVariantsFromCatalog(catalog),
  buildIngredientUnitFactorsFromCatalog(catalog),
  buildIngredientPortionsFromCatalog(catalog),
  new Map(recipes.map((recipe) => [recipe.id, recipe]))
);
const outputPath = path.join(process.cwd(), 'docs', 'built', 'nutrition_coverage_report.csv');
fs.writeFileSync(outputPath, coverageReportCSV(missing));
console.log(`Wrote ${missing.length} missing rows to ${outputPath}`);
