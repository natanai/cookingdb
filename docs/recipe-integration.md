# Recipe integration checklist

Use this page as the source of truth when adding or updating a recipe. The rules here come from
`scripts/validate.mjs`, `scripts/build.mjs`, `README.md`, and `docs/inbox/schema-notes.md`.

## Required files per recipe

Each recipe lives in `recipes/<recipe_id>/` and must include:

- `meta.csv` (required; exactly one data row).
- `ingredients.csv` (required).
- Steps content (required):
  - `steps.csv` (preferred; allows sections), **or**
  - `steps.md` (fallback).

Optional files:

- `choices.csv` (required if any ingredient token has multiple options).
- `pans.csv` (required only if the recipe is pan-scalable).

## `meta.csv` requirements

`meta.csv` must contain **exactly one data row** and the following columns/values:

- `id` must match the recipe directory name (`recipes/<recipe_id>/`).
- `title` is required.
- `categories` column must exist and contain at least one category.
- `base_kind` is required (used by the UI for scaling behavior).
- `default_base` is required (numeric in the build output).
- `servings_per_batch` is required (numeric; used by meal prep planner defaults).
- `notes` is required (empty string is allowed, but column must exist).
- `family` and/or `byline` are required **when applicable** (for family recipes or attribution).

CSV warning (from `README.md`): any field with commas (especially `notes`) must be wrapped in
quotes or columns will shift. Example: `"Serve warm, with berries."`

## Ingredient file requirements (`ingredients.csv`)

Every ingredient row must include:

- `token` (non-empty).
- `display` (non-empty; the ingredient name shown to users).
- `ingredient_id` (must exist in `data/ingredient_catalog.csv`).

Additional validations and constraints:

- `ratio` must match the format expected by validation: integers or fractions such as `1`, `1/2`, or `1 1/2`.
- Ingredient IDs must be unique in `data/ingredient_catalog.csv`. Reuse existing ingredient IDs instead of
  adding duplicates, and update recipes to point at the canonical ID when consolidating ingredients.
- Optional grouping columns (`section`, `line_group`) are supported for multi-part ingredient lists.
- Tokens can define **options** via the `option` column; options with identical `display` values cannot repeat
  for the same token (validation error).

## Steps requirements (`steps.csv` or `steps.md`)

- At least one step is required.
- `steps.csv` must have a non-empty `text` value for every row.
- Step sections are supported by adding a `section` column in `steps.csv`.
- If using `steps.md`, include one instruction per line (numbering is optional and stripped in the build).
- Step text must be complete and should not instruct using more of an ingredient than is listed in
  `ingredients.csv` (avoid double-counting unless split into multiple ingredient lines).

## Token and placeholder requirements

All ingredient tokens must be in sync with step placeholders:

- Every `{{token}}` placeholder **and** every conditional token in `{{#if token}}` / `{{#if token=option}}`
  must exist in `ingredients.csv`.
- Every ingredient token in `ingredients.csv` must appear somewhere in the steps.
- Token naming in `ingredients.csv` must match the placeholders exactly, without extra formatting.

## Choices (`choices.csv`) requirements

Use `choices.csv` when a token has multiple `option` values in `ingredients.csv`.

- Any token with **two or more** options must be listed in `choices.csv`.
- `choices.csv` rows must include `token`, `label`, and `default_option`.
- `default_option` must match one of the options listed for that token in `ingredients.csv`.
- Choices must provide **at least two options** for the token.

## Pan scaling (`pans.csv`) requirements

If a recipe can be scaled for different pan sizes:

- `pans.csv` must include at least one row.
- Each row must reference a valid pan `id` in `data/pan-sizes.json`.
- Exactly **one** row must set `default` to a truthy value.
- Pan entries must have valid dimensions in the catalog (width, and height for rectangle/square shapes).

## Compatibility and filtering expectations

Compatibility and filters are derived from ingredient tokens and options, and they affect list filtering
in the UI:

- `scripts/build.mjs` computes `compatibility_possible` using `data/ingredient_catalog.csv` dietary flags.
  - For choice tokens, at least one option must satisfy a restriction (gluten/egg/dairy free) for the
    recipe to be compatible.
- `docs/recipe-utils.js` uses the selected options (or defaults) to enforce restrictions and will
  automatically switch to compatible options where possible.
- Ingredient-level dependencies (`depends_on_token` / `depends_on_option`) restrict token/option visibility.
  Ensure dependency tokens and options exist in the same recipe so restrictions behave predictably.
- Categories and family values affect filtering:
  - The category dropdown includes all distinct `categories` plus `family` values.
  - The category filter matches either `categories` or `family` exactly.
  - Search queries match `title`, `byline`, `categories`, and `family` fields.

## Nutrition estimation inputs

Meal-prep servings estimates are calculated from nutrition fields stored directly in
`data/ingredient_catalog.csv`:

- Nutrition columns live alongside each ingredient (`nutrition_unit`, `calories_per_unit`,
  `nutrition_source`, `nutrition_notes`) so the catalog is the single source of truth.
- Provide `nutrition_unit` and `calories_per_unit` wherever possible so the build can estimate recipe calories.
- Missing or incomplete nutrition fields will reduce coverage in the recipe-level nutrition estimate.
- Serving estimates use `data/nutrition_guidelines.json` to set target calories per meal.

## Build artifacts

After adding or editing recipes, regenerate build outputs:

```bash
node scripts/validate.mjs
node scripts/build.mjs
```

These update:

- `docs/built/index.json`
- `docs/built/recipes.json`

If validation fails, consult the error message; it directly maps to the rules in `scripts/validate.mjs`.
