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
2. Add `meta.csv` with `id,title,base_kind,default_base,categories,notes`. The `categories` field is a semicolon-separated list (e.g. `Breakfast; Brunch; Quick`) and empty entries are ignored during the build.
3. Add `ingredients.csv` with `token,option,display,ratio,unit,ingredient_id`.
4. Add `steps.md` using `{{token}}` placeholders that match ingredients.
5. If any token has multiple options, add `choices.csv` with `token,label,default_option` and ensure every `default_option` exists among the ingredient rows for that token.
6. Update `data/ingredient_catalog.csv` only with classification columns; do not add substitution/alternative columns.
7. Run validation and build before committing.

### Categories / Chapters
- Categories behave like cookbook "chapters" and come directly from the semicolon-separated values in each recipe's `meta.csv`.
- The build step trims whitespace, drops empty entries, and emits:
  - `all_categories`: sorted unique list across all recipes
  - `category_counts`: how many recipes belong to each category
- On the homepage you can click multiple chapters to filter recipes (combined with dietary toggles using AND logic). Selecting none is equivalent to "All".
- Filtering state persists to `localStorage` under `cookingdb.filters` and `cookingdb.categories`.
- Deep links are supported via query parameters: `?cat=Soup&cat=Breakfast&gf=1&df=1`.
- To add a new chapter, just include it in a recipe's `categories` field; it will appear automatically after rebuilding.

## Commands
- `npm run validate` — enforce schema rules and placeholder invariants.
- `npm run build` — validate then emit `/docs/built/index.json` and `/docs/built/recipes.json`.
- `npm run dev` — serve `/docs` locally at http://localhost:4173 (uses relative assets for GitHub Pages).

## Recipe Card Maker
- Open `docs/convert.html` (or `npm run dev` → `/convert.html`) to turn any recipe into a CookingDB-ready ZIP.
- Fill in the slug, title, categories, base, and notes. Paste the source recipe in the scratchpad if you want to keep it handy.
- Build ingredients by declaring tokens, optional options, and linking to `ingredient_id` from the helper catalog (emitted as `docs/built/ingredient_catalog.json` after `npm run build`).
- Any token with multiple options must be paired with a per-recipe choice group that includes a valid `default_option`.
- Write `steps.md` using `{{token}}` placeholders. The checklist will flag any missing or unknown tokens and ratio formatting issues.
- Click **Download Recipe ZIP** to receive `recipes/<id>/meta.csv`, `ingredients.csv`, optional `choices.csv`, and `steps.md`. Unzip into the repo, then run `npm run validate` (and `npm run build`) before committing.

## GitHub Pages setup
- Settings → Pages → Source: **Deploy from a branch**
- Branch: `main`
- Folder: `/docs`
