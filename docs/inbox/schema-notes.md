<!--
Schema notes for inbox payloads:
- Store the recipe object in the same shape produced by scripts/build.mjs and loaded by docs/recipe.js.
- Required fields: id (primary key string), title, base_kind (e.g., "multiplier"), default_base (number), categories (array of strings), notes (string), steps_raw (string with numbered lines), tokens_used (array of token strings from steps), token_order (array of unique ingredient tokens in recipe order), ingredients (object keyed by token).
- Each ingredients[token] entry: { token, options: [ { option ("" for single), display, ratio (string amount), unit, ingredient_id, dietary: { gluten_free, egg_free, dairy_free } } ], isChoice (boolean) }.
- Optional maps: choices (token -> { token, label, default_option }), pan_sizes (array of { id, label, shape, width, height, unit, is_default }), default_pan (pan id or null), compatibility_possible (object with gluten_free/egg_free/dairy_free booleans).
- Structured fields: ingredient_sections (ordered array of section labels) and step_sections (ordered array of section labels). Steps may also be provided as an array of { section, text } objects (steps_raw should still contain a numbered text fallback).
- Steps rely on {{token}} placeholders matching ingredient tokens; keep tokens_used in sync with steps_raw/steps to ensure rendering works in docs/recipe.js.
-->
