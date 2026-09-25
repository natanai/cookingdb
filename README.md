# CookingDB

CookingDB is a static-first family cookbook application with a recipe reader, recipe authoring, a pending-recipe review/publishing workflow, meal planning, nutrition and dietary tools, ingredient/unit conversions, pan scaling, and a bread-maker journal.

Published recipe content lives in Git. The Cloudflare/D1 service is a pending-recipe inbox only; unpublished inbox rows are not a second Cookbook data source.

For the consolidation architecture and merge gates, see [`docs/architecture.md`](docs/architecture.md).

## Development

Install the pinned dependencies:

```bash
npm ci
```

Validate canonical recipe data:

```bash
npm run validate
```

Build the generated browser data under `docs/built/`:

```bash
npm run build
```

Run the structural, architecture, publishing-safety, and domain tests against the built candidate:

```bash
npm test
```

Run the real browser journeys in desktop Chromium and mobile WebKit:

```bash
npm run test:browser
```

The browser app uses ES modules and fetched generated data, so serve `docs/` over HTTP for manual local testing rather than opening the HTML files directly. For example:

```bash
python3 -m http.server 4173 --directory docs
```

Then open `http://127.0.0.1:4173/index.html`.

## Application surfaces

- Cookbook: `docs/index.html`
- Recipe reader: `docs/recipe.html`
- Add Recipe / pending-recipe editor: `docs/add.html`
- Meal Prep: `docs/planner.html`
- Bread Maker: `docs/bread-maker.html`
- Recipe inbox administration: `docs/admin.html`, reached from the shared gear menu

The Cookbook, individual recipe pages, and Meal Prep consume published generated recipe data. Pending recipes remain in the Recipe inbox until the publishing flow integrates them into canonical repository sources and rebuilds the site.

## Data layout

Canonical sources include:

- Ingredient catalog: `data/ingredient_catalog.csv`
- Pan sizes: `data/pan-sizes.json`
- Nutrition policy/guidelines under `data/`
- Recipes: `recipes/<recipe_id>/`
  - `meta.csv`
  - `ingredients.csv`
  - optional `choices.csv`
  - `steps.csv`

The build produces versioned browser data under `docs/built/`, including the cookbook index and full recipe box. Browser features obtain that data through the shared built-data and recipe-repository modules rather than defining their own fetch/storage rules.

CSV parsing in the repository scripts uses the pinned `papaparse` dependency. CI audits the canonical CSV corpus for parser errors before validation/building.

## Recipe integration checklist

See [`docs/recipe-integration.md`](docs/recipe-integration.md) for the full recipe-source checklist and validation rules.

## Recipe inbox and publishing

The Worker-backed D1 database is an authoring/review inbox. The Git repository remains the source of truth for published recipes.

### Official route

1. Submit one or more recipes through Add Recipe.
2. Open **Recipe inbox** from the shared gear menu and audit the pending list. A pending recipe can be opened in the same composer for review/editing or deleted individually.
3. Run **Actions → Publish pending recipes → Run workflow** when the queue is ready.
4. The workflow fetches pending rows from the Worker, converts them to canonical `recipes/<id>/` sources, validates and builds the site, commits the repository changes, dispatches the Pages deployment, and removes only rows that were successfully integrated.
5. Existing recipe IDs are not silently overwritten. Identical already-integrated content makes cleanup retries safe; conflicting content stops publication.

Admin edits use the Worker's authenticated `/admin/update-pending` route with the row's previous `updated_at` timestamp, so an older editor cannot silently overwrite a newer update.

The publishing workflow requires the Actions secret `COOKINGDB_ADMIN_TOKEN`, matching the admin-token value configured on the Cloudflare Worker. The Worker currently defaults to `https://cookingdb-inbox.natanai.workers.dev`; the optional Actions variable `COOKINGDB_INBOX_URL` can override that endpoint.

### Export/manual route

The admin page can download a versioned `cookingdb-recipe-import-YYYY-MM-DD.json` bundle containing complete pending recipe payloads. The same importer used by the official route can integrate that bundle:

```bash
npm run import:inbox -- /path/to/cookingdb-recipe-import-YYYY-MM-DD.json
npm run validate
npm run build
npm test
```

The importer resolves known ingredient aliases against the ingredient catalog and existing recipe displays. If an ingredient cannot be mapped safely, or another validation rule fails, publication stops rather than silently creating an invalid canonical recipe.

## Deployment

`.github/workflows/pages.yml` builds and deploys `docs/` to GitHub Pages on pushes to `main`; the publishing workflow can also dispatch it after successful integration.

The live browser authoring/admin workflow requires the Cloudflare Worker to allow the Pages origin through CORS, including `OPTIONS` preflight requests.
