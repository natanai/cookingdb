# CookingDB architecture

This document describes the target architecture for the unified CookingDB application. It is the contract for the `refactor/unified-cooking-app` consolidation branch.

## Purpose

CookingDB began as a static recipe site and now includes a cookbook, recipe reader, authoring, pending-recipe review, automated publishing, meal planning, nutrition, dietary compatibility, ingredient/unit conversions, pan scaling, bread-machine tooling, mobile behavior, local settings, generated data, and a Cloudflare/D1 inbox.

The consolidation goal is behavior preservation: current features should continue to work while the internals are reorganized so that each concept has one owner and future features can extend the application without copying logic across pages.

## Architectural rule: one concept, one owner

A feature may consume shared concepts, but it should not redefine them.

- Recipe identity, title/source metadata, ingredients, choices, dependencies, steps, categories, yield, pan metadata, and compatibility belong to the recipe domain.
- Units, aliases, conversion, normalization, and display belong to the unit domain.
- Ingredient identity and canonical dietary/nutrition metadata belong to the ingredient catalog.
- Built JSON loading, versioning, retry, and cache policy belong to the data-access layer.
- Pending recipe submission/review/update/delete belongs to the inbox repository.
- Local user settings/drafts belong to explicit storage modules.
- Navigation, viewport behavior, focus/keyboard behavior, and common status/loading UI belong to shared application/UI services.
- Pages/features orchestrate shared services; they do not own duplicate domain rules.

## Layers

### 1. Canonical data and domain

Canonical repository sources remain the durable authority:

- `data/ingredient_catalog.csv`
- `data/pan-sizes.json`
- `data/nutrition_policy.json`
- `data/nutrition_guidelines.json`
- `recipes/<id>/meta.csv`
- `recipes/<id>/ingredients.csv`
- optional `recipes/<id>/choices.csv`
- `recipes/<id>/steps.csv`

Pure shared domain modules define how those concepts are interpreted. Browser code, build code, validation, reporting, and inbox import should use the same semantics rather than keeping copies.

### 2. Build and boundary validation

The build pipeline converts canonical sources to versioned generated data under `docs/built/`.

Boundary rules:

- canonical source -> validated domain representation
- pending recipe -> same validated recipe-draft contract -> canonical source
- generated JSON -> browser repositories/services

Validation should happen at boundaries. Page code should not need to rediscover whether a recipe object is valid.

### 3. Application services/repositories

Browser features obtain data through shared repositories/services rather than direct `fetch('./built/...')` calls or ad-hoc storage access.

Target services include:

- built-data client: versioned URL, caching, retry, failure state
- recipe repository: index/list/detail access and pending-overlay behavior
- authoring catalog: categories, ingredient autocomplete, units, sections, pans
- inbox repository: family submit and admin review/update/delete/export
- settings/draft stores: explicit keys and schema/version handling

### 4. Features/pages

Top-level page scripts should be thin composition roots. Feature modules own focused behavior such as recipe scaling, authoring ingredients, authoring steps, planner aggregation, or bread-journal editing.

A future feature should normally add or extend a feature module and consume existing services. Needing to edit every page is an architecture warning.

### 5. Presentation system

The current visual design is the authority. Historical v2/v3/v4/v5/v6/v7 style strata should be collapsed into one current component definition where practical.

Styles are organized conceptually as:

1. design tokens/base
2. shared shell/navigation
3. shared components/forms/status/loading
4. recipe document
5. authoring
6. meal prep
7. bread maker
8. admin
9. responsive behavior
10. print

## Rendered UI is architecture

DOM presence is part of the product architecture, not merely a styling detail.

- A feature that is retired, unavailable, unsupported, or not part of the current page should not remain in the DOM just because `hidden`, `display: none`, off-screen positioning, or another CSS escape hatch can conceal it.
- `hidden` is reserved for a reversible state inside an active user workflow: for example a review panel before Review is chosen, an authenticated admin queue before authentication succeeds, or a status/panel that the current feature can reveal during this visit.
- Every hidden stateful container must have an explicit runtime path that can reveal that exact container. CI checks this contract.
- Removing a feature means removing its markup, event handlers, styles, data hooks, and tests unless another active feature still owns them.
- Browser tests must distinguish `not currently shown` from `does not belong here`. The former may assert a hidden state; the latter should assert absence from the DOM.
- Do not preserve old architecture as invisible compatibility scaffolding unless a documented migration contract still consumes it and there is a planned removal point.

This rule exists specifically to prevent consolidation from becoming a cleaner-looking shell over abandoned systems.

## Data flow

Published recipe flow:

`canonical CSV/catalog -> validation -> build -> versioned generated data -> browser repositories -> page features`

Authoring/publishing flow:

`Add Recipe -> validated recipe draft -> D1 pending inbox -> admin review/edit -> publish workflow -> canonical CSV/catalog -> validation -> build -> deployed recipe`

A field added to the recipe model should cross this route through one explicit contract, not separate page/import/build interpretations.

## Future feature extension contract

Before adding a feature, answer:

1. What domain concept/data does it introduce or consume?
2. Which existing module owns that concept?
3. Does the canonical recipe schema change?
4. Which repository/service provides the data?
5. Which shared UI components can it use?
6. What are its loading, empty, failure, and offline/cache states?
7. What browser-level test proves the user workflow?
8. What architectural test prevents duplicated ownership?
9. Which UI is rendered only while the feature is active, and which obsolete UI is removed entirely?

Do not create a generic plugin framework unless a real feature requires one. Prefer small explicit extension points and registries.

## Consolidation workstream

The integration branch proceeds in this order:

1. Capture current behavior and data invariants.
2. Add architecture/structural contracts.
3. Consolidate shared domain helpers.
4. Consolidate data and storage access.
5. Make page entrypoints thinner and extract focused features.
6. Consolidate build/validate/report/import helpers.
7. Remove obsolete infrastructure and dead compatibility paths.
8. Flatten current CSS while preserving computed behavior.
9. Add built-site browser smoke tests, including mobile/WebKit coverage.
10. Run data parity, performance, visual-stability, accessibility, and publishing round-trip gates.
11. Owner acceptance on a branch preview.

## Non-goals during consolidation

- No feature redesign merely for architectural purity.
- No framework rewrite solely to change technology.
- No change to recipe meaning/content unless correcting a proven bug.
- No merge to `main` simply because the refactor compiles.

## Merge gate

The integration branch is ready only when all of the following are true:

- all canonical recipe sources validate and build
- generated recipe/category/ingredient/choice/step/pan semantics match the baseline or have an explicitly reviewed correction
- all unit and architecture tests pass
- real built-site smoke tests pass on Chromium and WebKit/mobile viewport
- Cookbook -> Recipe warm navigation is no slower or less visually stable than `main`
- Add Recipe is immediately usable and helper data cannot masquerade as valid empty data
- Add -> Inbox -> Admin Edit -> Publish round-trip is verified
- Meal Prep, Bread Maker, print, dietary filtering, substitutions, conditional steps, scaling, pan scaling, and kitchen-count conversions are exercised
- keyboard/focus/autocomplete/mobile-zoom/reduced-motion checks pass
- obsolete duplicate implementations have been removed or explicitly documented
- hidden stateful UI has a real reveal path; unavailable or retired systems are absent rather than merely concealed
- `README.md` and this document describe the actual deployed architecture
- the owner has tested the preview and accepted the branch

Until those gates are satisfied, the branch remains a draft and `main` remains the production fallback.
