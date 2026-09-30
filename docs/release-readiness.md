# Consolidation release readiness

Production remains `main`. Candidate: `refactor/unified-cooking-app`, PR #214.
The PR's latest commit checks are authoritative; an earlier passing run does not
approve a later revision. The owner has authorized merging a fully green candidate
so the production deployment can serve as the physical-phone acceptance environment.
Do not run **Publish pending recipes** until the Worker gate below is complete.

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

## Post-merge acceptance and publishing gates

1. **Production Worker prerequisite.** On 2026-09-29, GET
   `https://cookingdb-inbox.natanai.workers.dev/health` returned a healthy database
   but did not advertise `acknowledge-published-v1`. Before enabling the revised
   publisher, deploy `cloudflare/worker.js` with existing DB binding and secrets.
   Check health again for `db.ok: true` and the capability. The script is already
   prepared in this branch; no database wipe or schema migration is required.
   This blocks the revised recipe-publishing workflow, not the ordinary Pages
   deployment of the cookbook application.
2. **Owner live-phone acceptance.** A persistent built branch-preview host is not
   configured, and source-only GitHub proxies omit generated Add Recipe assets.
   The owner therefore authorized a green merge to `main` as the acceptance path.
   The pre-merge production commit `4106cf33ca008d4cf938abb98b03fb3a8a06006f`
   remains the known fallback if live testing finds a material regression.
3. **Real publishing round trip.** Verify staging/production infrastructure after
   the Worker update: retain the exported row version, import/validate/build, deploy
   the exact commit, then acknowledge only that version. Never test destructive
   cleanup against unrelated pending recipes. The live inbox was not mutated here.

## Live acceptance path

After the green PR is merged, wait for the GitHub Pages workflow for the exact merge
commit to finish successfully. Then test the live site on the owner's physical phone.
Existing production drafts and settings remain on the same origin.

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
5. Record explicit acceptance or the remaining defect. If a material regression is
   found, stop recipe publication and restore the pre-merge production state while
   the defect is corrected on a branch.

## Scope of the architecture claim

Shared domain/data/unit/storage/CSV/coverage rules and focused scaling/preview
features now have explicit owners. Dead duplicate Worker infrastructure is removed.
CSS removes superseded declarations without moving cascade order. Some page
controllers remain large and some style selectors intentionally occur in different
states/conditions. This is behavior-preserving consolidation, not a completed
rewrite into uniformly small components. Future changes should extend the owning
module and add a user journey, following architecture.md.
