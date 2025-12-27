# Ingredient conversion guide

This project uses two layers of unit conversions:

1. **Global unit conversions** live in `docs/unit-conversions.js` under `UNIT_CONVERSIONS`.
2. **Per-ingredient conversions** live in `data/ingredient_catalog.csv` and flow into `docs/built/recipes.json` as
   `nutrition.conversions`.

## Per-ingredient conversion fields

The catalog supports optional conversion fields when ingredients appear in different unit groups:

- `grams_per_count`: Bridge count ↔ mass (e.g., 1 medium onion = 110 g).
- `tsp_per_sprig`: Bridge count ↔ volume for herbs (e.g., 1 sprig thyme = 0.5 tsp).
- `grams_per_cup`: Bridge volume ↔ mass (e.g., 1 cup chopped onion = 160 g).

> Tip: Keep all conversion logic centralized in `docs/unit-conversions.js` so the build pipeline and UI share the
> same rules.

## Updating conversions

1. **Edit the catalog**
   - Update `data/ingredient_catalog.csv` with the conversion fields above.
   - Prefer values that match the nutrition source/serving size (e.g., `serving_size` = `1 cup (160g)` →
     `grams_per_cup = 160`).

2. **Run validation**
   - `npm run validate`
   - The validator reports any recipe ingredient units that cannot be converted to the catalog’s nutrition unit.

3. **Rebuild outputs**
   - `npm run build`
   - This regenerates `docs/built/recipes.json` with updated `nutrition.conversions` data.

## Fact-checking conversions

Use the validator to spot any missing coverage:

- `npm run validate`

If the validator reports a mismatch:

1. Check the ingredient’s `nutrition_unit` and `serving_size` in `data/ingredient_catalog.csv`.
2. Add or correct conversion values (`grams_per_count`, `tsp_per_sprig`, `grams_per_cup`).
3. Re-run `npm run validate` until the mismatch list is empty.

## Common pitfalls

- **Count ↔ volume**: Provide both `grams_per_count` and `grams_per_cup` so the system can bridge via grams.
- **Mass ↔ volume**: Provide `grams_per_cup` so ounces/pounds can convert to cups/tbsp.
- **Herbs in sprigs**: Use `tsp_per_sprig` instead of approximate gram weights.
