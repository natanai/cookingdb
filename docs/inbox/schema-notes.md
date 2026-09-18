<!--
Schema notes for inbox payloads:
- Store the recipe object in the same shape produced by scripts/build.mjs and loaded by docs/recipe.js.
- Required fields: id (primary key string), title, base_kind (e.g., "multiplier"), default_base (number), servings_per_batch (number), categories (array of strings), notes (string), steps_raw (string with numbered lines), tokens_used (array of token strings from steps), token_order (array of unique ingredient tokens in recipe order), ingredients (object keyed by token).
- Each ingredients[token] entry: { token, options: [ { option ("" for single), display, ratio (string amount), unit, ingredient_id, dietary: { gluten_free, egg_free, dairy_free } } ], isChoice (boolean) }.
- Optional maps: choices (token -> { token, label, default_option }), pan_sizes (array of { id, label, shape, width, height, unit, is_default }), default_pan (pan id or null), compatibility_possible (object with gluten_free/egg_free/dairy_free booleans), nutrition_estimate (object with calories/serving estimates).
- Structured fields: ingredient_sections (ordered array of section labels) and step_sections (ordered array of section labels). Steps may also be provided as an array of { section, text } objects (steps_raw should still contain a numbered text fallback).
- Steps rely on {{token}} placeholders matching ingredient tokens; keep tokens_used in sync with steps_raw/steps to ensure rendering works in docs/recipe.js.
-->

## Inbox payload mapping to CSV schema

Inbox payloads map to the CSV recipe schema used by `scripts/build.mjs`:

- `token_order`, `ingredients`, and option data map to `recipes/<id>/ingredients.csv` (tokens, options, ratios, units, dependencies, line groups, and sections).
- `steps_raw` and/or `steps` map to `recipes/<id>/steps.csv` (including step sections).
- `choices` maps to `choices.csv`.
- Recipe metadata maps to `meta.csv`; `default_pan` references the shared `data/pan-sizes.json` list.

## Official JSON import bundle

The browser admin export wraps Worker results in a stable, versioned envelope:

```json
{
  "format": "cookingdb-recipe-import",
  "version": 1,
  "exported_at": "ISO-8601 timestamp",
  "source": "cookingdb-inbox",
  "items": [
    {
      "inbox_id": 123,
      "recipe_id": "example-recipe",
      "title": "Example Recipe",
      "recipe": {}
    }
  ]
}
```

`recipe` contains the complete structured submission. `inbox_id` is retained so the official workflow can delete only rows that were safely integrated.

`scripts/import-inbox.mjs` accepts this bundle and also accepts the raw current Worker `{ items: [...] }` response (plus the older `{ pending: [...] }` response) so direct database publishing and downloaded exports share one importer.

Published recipes must pass `scripts/validate.mjs` and be rebuilt via `scripts/build.mjs` to appear in `docs/built/recipes.json`. The importer refuses to overwrite an existing recipe with different content. If an existing recipe is byte-for-byte identical to the generated canonical files, it is treated as already integrated so a failed inbox-cleanup run can be retried safely.

Ingredient IDs are checked against `data/ingredient_catalog.csv`. The importer also uses canonical catalog names and display names already used by existing recipes as aliases (for example, a familiar display name can resolve to an older canonical ingredient ID). Ambiguous or genuinely new ingredients stop publication and require catalog work rather than being guessed.
