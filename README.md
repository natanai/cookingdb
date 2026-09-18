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

See [`docs/recipe-integration.md`](docs/recipe-integration.md) for the full checklist and validation rules.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` builds the site and deploys `/docs`. It runs on pushes to `main` and can also be dispatched explicitly by the recipe publishing workflow.

## Recipe inbox and publishing

- Family recipe editor: [`docs/add.html`](docs/add.html)
- Admin export/backup: [`docs/admin.html`](docs/admin.html)
- Official publisher: **Actions → Publish pending recipes → Run workflow**

The Worker-backed D1 database is an inbox; the Git repository remains the source of truth for published recipes.

### Official route

1. Submit one or more recipes through the live Add Recipe page.
2. Run the **Publish pending recipes** GitHub Action.
3. The workflow fetches pending rows directly from the Worker, converts them to canonical `recipes/<id>/` CSV files, validates and builds the site, commits the repository changes, dispatches the Pages deployment, and then removes only the successfully integrated inbox rows.
4. Existing recipe IDs are never silently overwritten. An identical existing recipe is treated as already imported so a cleanup retry is safe; different content causes the workflow to stop.

The workflow requires the repository Actions secret `COOKINGDB_ADMIN_TOKEN`. It should contain the same admin-token value configured on the Cloudflare Worker. The Worker URL defaults to `https://cookingdb-inbox.natanai.workers.dev`; set the optional Actions variable `COOKINGDB_INBOX_URL` only if that endpoint changes.

### Export/manual route

The admin page downloads a versioned `cookingdb-recipe-import-YYYY-MM-DD.json` bundle containing the complete pending recipe payloads. The same importer used by the official workflow can integrate that file:

```bash
npm run import:inbox -- /path/to/cookingdb-recipe-import-YYYY-MM-DD.json
npm run validate
npm run build
```

The importer resolves known ingredient aliases against the ingredient catalog and existing recipe displays. If a submitted ingredient cannot be mapped safely to `data/ingredient_catalog.csv`, or if another validation rule fails, publication stops rather than creating a broken recipe.

Make sure the Worker allows CORS (including OPTIONS preflight) from the Pages-hosted site so browser submissions and admin exports can reach the inbox API.
