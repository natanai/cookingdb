# CookingDB

CookingDB is a printable, homemade-style cookbook that keeps every recipe consistent and dietary-aware. GitHub Pages publishes directly from `/docs`, so the built site and JSON live there.

## Invariants (v1)
- **Inline ingredient rule:** every ingredient token in `ingredients.csv` must be referenced in `steps.md` with `{{token}}`, and every placeholder must exist in `ingredients.csv`.
- **Per-recipe alternatives only:** the global `data/ingredient_catalog.csv` only contains classification columns. Any token with multiple options must declare them in the recipe's `choices.csv` with a valid `default_option`.
- **No grams:** keep measurements in cups/tbsp/tsp/count (blank allowed for "as needed").
- **Commentary stripped:** author commentary is omitted by default; only concise, imperative steps remain.
- **Docs-first:** built JSON and pages stay inside `/docs` with relative URLs for GitHub Pages.

## Repository layout
- `data/ingredient_catalog.csv` — global ingredient classification (allergen flags only).
- `recipes/<id>/` — each recipe folder includes `meta.csv`, `ingredients.csv`, `steps.md`, and optional `choices.csv`.
- `scripts/validate.mjs` — schema + cross-file validation.
- `scripts/build.mjs` — runs validation and emits `/docs/built/index.json` and `/docs/built/recipes.json`.
- `docs/` — static site (home + recipe view) served from GitHub Pages.

## Adding a recipe
1. Create `recipes/<your-id>/`.
2. Add `meta.csv` with `id,title,base_kind,default_base,categories,notes`.
3. Add `ingredients.csv` with `token,option,display,ratio,unit,ingredient_id`.
4. Add `steps.md` using `{{token}}` placeholders that match ingredients.
5. If any token has multiple options, add `choices.csv` with `token,label,default_option` and ensure every `default_option` exists among the ingredient rows for that token.
6. Update `data/ingredient_catalog.csv` only with classification columns; do not add substitution/alternative columns.
7. Run validation and build before committing.

## Commands
- `npm run validate` — enforce schema rules and placeholder invariants.
- `npm run build` — validate then emit `/docs/built/index.json` and `/docs/built/recipes.json`.
- `npm run dev` — serve `/docs` locally at http://localhost:4173 (uses relative assets for GitHub Pages).

## GitHub Pages setup
- Settings → Pages → Source: **Deploy from a branch**
- Branch: `main`
- Folder: `/docs`
