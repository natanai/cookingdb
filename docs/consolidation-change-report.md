# Architecture consolidation change report

## Purpose

CookingDB had grown from a static cookbook into a multi-surface application. The
consolidation keeps the existing product and canonical recipe data, but gives shared
concepts one owner, removes obsolete implementations, strengthens publication safety,
and adds browser-level proof that the assembled site still works.

Comparison base: `main` at `4106cf33ca008d4cf938abb98b03fb3a8a06006f`.
Reviewed candidate: `bc0c3734e670ee0be441763349cb10a6223d37c5`.
At that checkpoint the branch was 104 commits ahead and zero behind, with 85 changed
files. The large addition count includes test fixtures, notably a 5,920-line frozen
pre-consolidation stylesheet used only for render-equivalence testing.

## What changed and why

### 1. Recipe and application boundaries

- Added `recipe-model.js` as the shared owner for recipe normalization, title/byline
  handling, detail detection, dietary badges, and display formatting. This replaces
  page-specific interpretations of the same recipe.
- Added `recipe-repository.js` as the shared published-recipe access layer. Cookbook,
  Recipe, Meal Prep, and Bread Maker no longer define separate loading rules.
- Strengthened `built-data.js` with versioned URLs, reusable caching, a bounded
  request deadline that covers headers and body parsing, one reload retry, and explicit
  failure states. This prevents a slow helper request from freezing an interaction.
- Added guarded `browser-storage.js` with the existing storage keys preserved.
  Drafts, nutrition settings, Bread Maker entries, refine state, passwords, and haptic
  preferences now use one failure-safe storage boundary.
- Extracted focused modules for recipe scaling, authoring preview, and draft storage.
  This reduces the amount of domain behavior embedded directly in page controllers
  and gives future related features an explicit extension point.
- Centralized unit aliases and conversions in `unit-conversions.js`, shared by the
  browser, build, validation, and reporting paths. A unit now has one meaning across
  the system.
- Centralized strict CSV parsing/serialization and nutrition-coverage calculations
  for the builder, validator, importer, and reports. This removes several independent
  answers to “how is this source interpreted?”

Why: features previously communicated through copied helpers and incidental page
behavior. Shared ownership makes a future change local, reviewable, and testable.

### 2. User experience and reachability

- Kept the six pages under the shared navigation/behavior manager, with Recipe inbox
  administration under the gear menu.
- Preserved the compact recipe-first visual direction while removing superseded CSS
  declarations. The stylesheet lost 339 declarations that were provably overridden
  later without changing cascade order or selector specificity.
- Kept Add Recipe's full authoring surface reachable: categories, autocomplete,
  sections beginning with the first ingredient, substitutions, conditional
  ingredients, prep notes, groups, step variations, source/byline, pan sizes, written
  batch multipliers, review, and submission.
- Added independent recovery for category, ingredient lookup, and pan-size helper
  failures. Category loading can fall back to the compact cookbook index; failed
  ingredient lookup remains explicit and retryable without losing typed work.
- Made drafts resilient to malformed or unavailable browser storage and tells the
  author when work is not being saved.
- Fixed keyboard selection/dismissal for ingredient suggestions, review focus
  transfer and return, reduced-motion review scrolling, mobile input text sizing,
  and horizontal-overflow reachability.
- Kept Recipe scaling, “Use what I have,” kitchen count estimates, pan conversion,
  substitutions, and print output synchronized.
- Kept Meal Prep add/scale/customize/remove and Bread Maker journal
  save/reload/delete flows reachable in the same responsive shell.

Why: consolidation is only successful if all existing capabilities remain findable
and usable, particularly on a phone while authoring a recipe.

### 3. Rolodex-style recipe loading

- Cookbook navigation warms the Recipe document, page modules, and required generated
  data in the background.
- A click may wait at most 250 ms for optional warming; a stalled resource can no
  longer trap navigation.
- The page-only scaling module is warmed explicitly, removing a delayed-network module
  waterfall discovered in the final comparison.
- Recipe content stays hidden until the readable card is assembled, and the comparison
  samples it for one second after reveal to detect text or geometry changes.

Why: opening a recipe should feel like pulling out an already-written card, without
ingredients blinking into existence or formatting moving while it is being read.

### 4. Add Recipe, inbox, and publishing safety

- Retained both supported publication routes: direct workflow import from the D1
  pending inbox and versioned JSON export/manual import.
- Admin review/edit uses the pending row's prior `updated_at` value so stale editors
  cannot silently overwrite newer work.
- Reworked publication into prepare, exact-commit Pages deployment, and acknowledgement
  phases. Inbox rows are acknowledged only after the exact integrated commit deploys.
- Identical retry imports still require a successful deployment before acknowledgement.
- Dry run is the workflow default, and production publication is restricted to
  `main`.
- Added version-specific acknowledgement; empty, stale, malformed, or broad cleanup
  requests fail closed.
- Removed the obsolete root `inbox-worker.js`; `cloudflare/worker.js` is the sole
  Worker implementation.
- Added isolated SQLite execution of the production Worker handlers for submission,
  authentication, admin export/edit, conflict detection, malformed cleanup, and
  versioned acknowledgement.

Why: pending recipes are valuable authored data. A failed build, failed deployment,
stale edit, or ambiguous cleanup request must retain them rather than silently lose
or overwrite them.

### 5. Canonical recipe and build integrity

- Added a semantic baseline for the 66 recipes present at the consolidation boundary.
  New recipes remain allowed, but historical recipes cannot silently change meaning.
- Strict parsing exposed five direction files whose unquoted commas had historically
  been truncated by the old row parser. Those existing rows were quoted so the full
  authored directions are retained, with each correction recorded and hash-reviewed.
- Validation, build, coverage reporting, and importing now share their data rules.
  Build/report output parity is tested.

Why: a refactor must preserve recipe meaning, not merely produce syntactically valid
files.

### 6. Tests and CI

The candidate adds:

- architecture, navigation, header, state-ownership, data-loading, Cookbook-boundary,
  Add Recipe, admin, print, semantic-parity, and publishing-safety contracts;
- unit tests for storage, built-data timeouts/retries, recipe model/repository,
  unit conversions, recipe utilities, and data-pipeline behavior;
- real browser journeys in desktop Chromium and mobile WebKit for all six pages,
  advanced authoring, authoring-to-inbox-to-built-recipe round trip, timeout recovery,
  recipe adjustment/printing, Meal Prep, Bread Maker, navigation, and admin access;
- six-page CSS before/after comparisons using computed styles, geometry, and screenshots;
- a paired main-versus-candidate navigation benchmark with fresh contexts, immediate
  and warmed clicks, and 0/80 ms response latency.

Exact final code checkpoint evidence: GitHub Actions run `36650035124`.

- Validation/build/contracts: passed.
- Browser journeys: 56/56 passed.
- Navigation comparisons: 8/8 passed.
- Post-reveal text/geometry changes: zero in every trial.
- Desktop Chromium at 80 ms latency: immediate main 185 ms, candidate 183 ms;
  warmed main 144 ms, candidate 144 ms.
- Evidence artifact: `11070301579`.

These timings are a regression screen for one representative recipe, not a universal
performance guarantee. Physical-phone testing remains necessary.

## Deliberate limits and remaining production work

- This is a behavior-preserving consolidation, not a framework rewrite. Some page
  controllers and context-specific CSS selectors remain large where further splitting
  would have raised regression risk without a clear ownership benefit.
- The live Worker database is healthy, but the deployed Worker has not yet advertised
  `acknowledge-published-v1`. Ordinary site deployment may proceed, but **Publish
  pending recipes must not be run** until `cloudflare/worker.js` is deployed with
  the existing D1 binding and secrets and the capability is verified.
- No real Cloudflare/D1 publication round trip has been performed. The one live pending
  row was not mutated during consolidation.
- A source-only branch proxy is not a valid Add Recipe preview because it does not run
  the build that creates autocomplete, pan-size, and authoring-option assets.
- The owner has authorized a fully green merge so the production origin can be used
  for physical-phone acceptance. The pre-merge production commit
  `4106cf33ca008d4cf938abb98b03fb3a8a06006f` is the known rollback point.

## Future-feature rule

Extend the module that owns the concept, add or update a browser journey through the
real user path, and keep generated/build/Worker boundaries explicit. A feature should
not add a second definition of recipes, units, storage, loading, navigation, or
publication state merely because it begins on a different page.
