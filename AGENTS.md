# CookingDB agent operating protocol

This repository is worked on by multiple coding agents. The rules below are part of the project contract and exist to prevent silent stalls, overlapping CI noise, false confidence, and UI regressions caused by source-only reasoning.

## 1. No silent waiting

Agents must never leave a task in a state that depends on an external job eventually finishing without reporting back.

- Do not wait indefinitely for CI, deploys, previews, or connector operations.
- Poll an in-progress external job at most twice in one work cycle.
- Do not request job logs until the job is complete; use job metadata while it is running.
- If the job is still running after the polling budget, return a checkpoint with the exact run/job identifier and the next action required.
- Never imply background work will continue after the response.

## 2. Distinguish product failures from tooling failures

Every failure must be classified before changing product code.

- **Product failure:** the built application, validation, browser journey, or data contract actually failed.
- **Test-model failure:** the test encoded an interaction a real user cannot perform or otherwise modeled the product incorrectly.
- **Tooling failure:** GitHub/API/connector/runtime failed or returned an unavailable transient resource.

A tooling failure is not evidence that the product is broken. A test-model failure is not evidence that the product is broken. Record the distinction before making a repair.

## 3. One checkpoint at a time

Avoid creating a queue of overlapping workflow runs.

- Resolve the exact branch head before a write batch.
- Prefer one coherent commit (or a very small related set) over many tiny commits.
- After a checkpoint commit, allow its CI run to become the authoritative run before adding more validation-dependent changes.
- If the branch head moves unexpectedly, stop and reconcile before writing again.
- Never reason about the state of the branch from an older CI run after a newer commit exists.

## 4. Bounded work cycles

Each work cycle must end in one of these states:

1. **Verified checkpoint** — changes committed and the relevant checks passed.
2. **Actionable failure** — a real failure is identified with evidence and the next repair is clear.
3. **External wait checkpoint** — an external job is still running; report its identifier and stop rather than silently waiting.
4. **Blocked checkpoint** — required access/data is unavailable; report exactly what is missing.

Do not keep branching into new tasks merely because another check is pending.

## 5. Browser truth before UI assumptions

For interactive UI work, source inspection alone is insufficient.

- Model journeys using user-facing controls and labels.
- Browser tests must use the shared reachability helpers in `tests/browser/journey-helpers.mjs`.
- Do not force clicks, dispatch synthetic clicks, or interact through closed disclosures.
- When a browser test fails, first determine whether the journey is wrong or the product is wrong.
- Validate important journeys in desktop Chromium and mobile WebKit.

## 6. Hidden UI is not an archive

`hidden`, `display:none`, off-screen positioning, and similar mechanisms are only for reversible states in active workflows.

If a system or control is obsolete, unsupported, abandoned, or no longer part of a page, remove its markup, code, styles, hooks, and tests rather than leaving it hidden.

## 7. Commit discipline

Before each commit:

- confirm the exact branch/ref being edited;
- confirm the change belongs to the current task;
- avoid temporary scripts/workflows unless they are removed in the same bounded work cycle;
- do not commit generated noise unrelated to the task;
- keep the PR draft until the documented merge gate is satisfied.

## 8. User-visible progress discipline

A coding agent should not appear to be working for hours after it has actually stopped.

After each bounded work cycle, report promptly with:

- what changed;
- the exact checkpoint commit (if any);
- which checks are complete;
- which check, if any, is still running or blocked;
- the next concrete step.

If an external operation is still running, report that state instead of remaining silent.

## 9. Recovery after an error

When a tool/API operation errors:

1. classify the error;
2. retry the same operation no more than once if it appears transient;
3. if it fails again, change strategy or checkpoint the blocker;
4. do not repeatedly call the same failing endpoint;
5. do not make speculative product changes to compensate for a connector/runtime error.

## 10. CookingDB consolidation priority

For `refactor/unified-cooking-app`, preserve the existing product while consolidating ownership and removing abandoned architecture. The authoritative merge gate remains `docs/architecture.md`. Reliability of the authoring flow, publishing flow, mobile/WebKit behavior, loading stability, print behavior, scaling, meal prep, Bread Maker, and removal of obsolete hidden systems takes priority over cosmetic refactoring.
