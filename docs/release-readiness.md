# Consolidation release readiness

Production remains `main`. Candidate: `refactor/unified-cooking-app`, draft PR #214.
The PR's latest commit checks are authoritative; an earlier passing run does not
approve a later revision. Do not publish while any check or external gate is open.

## Evidence included in the candidate

- Canonical validation, strict CSV parsing, built-data semantic baseline, shared
  unit semantics, build/report parity, and publishing safety checks.
- Browser journeys in desktop Chromium and mobile WebKit covering Add Recipe,
  review/edit/import/build/reader, helper-data failures and recovery, scaling and
  print parity, substitutions, Meal Prep, Bread Maker, navigation, and admin access.
- Production Worker handlers with isolated SQLite for submission, review, stale
  writes, malformed deletion, and versioned publication acknowledgement. This is
  not a Cloudflare/D1 deployment test.
- Keyboard autocomplete and review focus; reduced-motion review scrolling;
  compact input text and overflow; malformed/unavailable browser storage.
- CSS before/after comparisons on six pages, including expanded authoring controls.
  Computed geometry/styles must match; screenshot channel values may differ by at
  most 1/255 for raster rounding. Both browser engines must support replacement
  declaration values. This is a sampled UI gate, not exhaustive visual equivalence.
- Navigation comparison against current main, with its exact limitations documented
  in architecture.md. Raw screenshots and measurements remain CI artifacts.

The 2026-09-29 local pass completed 28 Chromium journeys and all unit/contracts.
Local WebKit could not launch because host libraries were unavailable; CI provides
WebKit validation. See the latest PR checks for the combined candidate outcome.

## External gates still open

1. **Production Worker prerequisite.** On 2026-09-29, GET
   `https://cookingdb-inbox.natanai.workers.dev/health` returned a healthy database
   but did not advertise `acknowledge-published-v1`. Before enabling the revised
   publisher, deploy `cloudflare/worker.js` with existing DB binding and secrets.
   Check health again for `db.ok: true` and the capability. The script is already
   prepared in this branch; no database wipe or schema migration is required.
2. **Owner preview acceptance.** The owner has not yet accepted this candidate on
   their physical iPhone. A persistent branch-preview host is not configured in
   this repository. Do not temporarily replace production just to obtain a preview.
   An approved staging host or an owner's local HTTP server can serve the build.
3. **Real deployment round trip.** Verify staging/production infrastructure after
   the Worker update: retain the exported row version, import/validate/build, deploy
   the exact commit, then acknowledge only that version. Never test destructive
   cleanup against unrelated pending recipes. The live inbox was not mutated here.

## Preview acceptance path

Serve the branch after `npm ci && npm run build`, for example
`python3 -m http.server 4173 --directory docs`. From a phone on the same network,
use the serving computer's LAN address and port. This is local testing, not a
persistent deployment. Existing site/browser storage belongs to its origin, so
production drafts do not automatically appear on a staging origin.

Check the following with one representative recipe:

1. Open Cookbook, search, and open a recipe repeatedly on a good and poor connection.
   Watch for blank flashes, moving text, or a click that never completes.
2. Open Add Recipe. Enter title, servings, categories, ingredients and directions.
   Exercise ingredient suggestions, first-ingredient section, substitutions,
   conditional ingredient, prep note, inline group, step variation, source/byline,
   pan size, and written batch multiplier. Review and return to editing.
3. Reload and confirm the draft survives. Repeat with the phone keyboard open;
   all controls should stay reachable without sideways page scrolling.
4. Test recipe adjustments, available-ingredient scaling, pan scaling, substitutions,
   and print. Add/remove/customize Meal Prep selections. Save/reopen a Bread Maker
   journal entry. Check the gear's inbox link and an authorized pending edit.
5. Record explicit acceptance or the remaining defect before merging.

## Scope of the architecture claim

Shared domain/data/unit/storage/CSV/coverage rules and focused scaling/preview
features now have explicit owners. Dead duplicate Worker infrastructure is removed.
CSS removes superseded declarations without moving cascade order. Some page
controllers remain large and some style selectors intentionally occur in different
states/conditions. This is behavior-preserving consolidation, not a completed
rewrite into uniformly small components. Future changes should extend the owning
module and add a user journey, following architecture.md.
