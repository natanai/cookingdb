# CookingDB v0.1

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
- Recipes: `recipes/<recipe_id>/` containing `meta.csv`, `ingredients.csv`, optional `choices.csv`, and `steps.csv` (preferred) or `steps.md`
- Ingredients support optional `section` and `line_group` columns so multi-part recipes can group related items; steps can be sectioned via the `section` column in `steps.csv`.
- Recipe steps must not instruct using more of any ingredient than is listed (avoid double-counting an ingredient across steps unless it is explicitly split into multiple ingredient lines).
- In `recipes/<recipe_id>/meta.csv`, any field containing commas (especially `notes`) must be wrapped in double quotes or columns will shift; e.g. `notes` value: `"Serve warm, with berries."`
- Built assets: `docs/built/index.json`, `docs/built/recipes.json`

## Recipe integration checklist

- See [`docs/recipe-integration.md`](docs/recipe-integration.md) for the full checklist and validation rules.

## GitHub Pages

A workflow (`.github/workflows/pages.yml`) builds the site and publishes `/docs` as the artifact. To enable Pages:
1. In the GitHub repository settings, open **Pages** and set **Source** to **Deploy from a branch**.
2. Select the default branch and set the folder to `/docs`.
3. Push changes to `main`; the workflow will run `npm run build` and deploy the generated artifact via GitHub Pages.

## Recipe inbox

- Family submit form: [`docs/add.html`](docs/add.html)
- Admin export tools: [`docs/admin.html`](docs/admin.html)
- The home page (`docs/index.html`) can pull pending inbox recipes into the local list for previewing.

The Worker-backed database acts as an inbox for submissions; the Git repository remains the source of truth for published recipes. Approved recipes should be exported from the Worker, merged into the repo in the existing schema, and rebuilt for the site.

Make sure the Worker allows CORS (including OPTIONS preflight) from `https://natanai.github.io` so the Pages-hosted UI can reach the inbox API.
