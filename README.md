# CookingDB

Static recipe site with CSV/Markdown sources and a simple build pipeline.

## Development

- Install dependencies (Papaparse is optional at runtime; scripts fall back to a simple parser):
  ```bash
  npm install
  ```
- Validate recipe data:
  ```bash
  npm run validate
  ```
- Build static JSON under `docs/built/` (runs validation first):
  ```bash
  npm run build
  ```

Open `docs/index.html` in a browser to view the recipes. Blintzes are included as the first example recipe with inline ingredient placeholders and per-recipe options.

## Data layout

- Global catalog: `data/ingredient_catalog.csv`
- Recipes: `recipes/<recipe_id>/` containing `meta.csv`, `ingredients.csv`, optional `choices.csv`, and `steps.md`
- Built assets: `docs/built/index.json`, `docs/built/recipes.json`

## GitHub Pages

A workflow (`.github/workflows/pages.yml`) builds the site and publishes `/docs` as the artifact. To enable Pages:
1. In the GitHub repository settings, open **Pages** and set **Source** to **Deploy from a branch**.
2. Select the default branch and set the folder to `/docs`.
3. Push changes to `main`; the workflow will run `npm run build` and deploy the generated artifact via GitHub Pages.
