# CLI Quality Repair Design

## Goal

Repair confirmed CLI reliability defects, improve the tests that protect those
paths, and reduce the highest-risk ownership tangles without changing provider
behavior or attempting a broad shell rewrite.

## Scope

This work is limited to the Kunai CLI runtime, its tests, CLI package/CI wiring,
and the existing root `.run.toml` developer-run profile. Provider adapters,
relay runtime behavior, docs-site behavior, and public package APIs are out of
scope unless a CLI compile boundary requires a type-only change.

The pre-existing `.gitignore` change is accepted: `.run.toml` is repository
configuration and must be tracked. Its profiles provide normal local commands
for development, production bundle, binary, relay, docs, lint, typecheck, test,
build, and CI.

## Repair Order

### 1. Async Browse And Workflow Correctness

`BrowseShell` must give each detail request an identity tied to the selected
title. A completed request may update the overlay only while that same title is
still open. Closing or replacing an overlay makes earlier work inert.

Browse queue, watchlist, and follow actions must await their async callbacks.
Success feedback appears only after the callback resolves; rejections become a
short actionable error message and do not escape the Ink input handler.

Search, discovery, and recommendation loading must allow a new request to
supersede the previous one. The search callback does not currently accept an
abort signal, so request identity is the immediate contract: later results win,
and stale completions cannot mutate shell state. A later follow-up may add
transport cancellation once search services expose that port.

Root-overlay workflow dispatch must catch dynamic-import and workflow failures,
record a diagnostic event, and leave truthful shell feedback instead of an
unhandled promise rejection after closing the overlay.

### 2. Truthful Manual Sync

`SyncService.pushWatched` must return a structured aggregate result: number of
connected adapters, successful pushes, rejected pushes, and failure messages
safe for terminal display. It must also convert unexpected adapter throws into
failed attempts so one integration cannot abort a manual batch silently.

The sync workflow will report no connected service, full success, or partial /
complete failure accurately. It continues processing the remaining history
entries after an individual adapter failure.

### 3. Test Boundaries

Tests use the local render-capture harness, deferred promises, and pure service
fixtures. They do not add `ink-testing-library`, real-time sleeps, or live
provider dependencies.

The new tests cover stale detail responses, rejected browse actions, request
supersession, root workflow rejection handling, and sync aggregation. Playback
work begins with `PlaybackPhase.execute()` characterization tests for a small
set of terminal outcomes before any structural extraction.

### 4. Staged Structural Work

`PlaybackPhase` remains the orchestration owner in this repair. After its
characterization tests land, extract at most one policy/effects boundary whose
inputs and outcomes are explicit. Do not recreate the previously rejected
playback-control helper and do not combine this work with the workflow split.

Split `shell-workflows.ts` only by cohesive workflow families, starting with
sync and diagnostics/cache. Workflows may request a shell-owned action through
a small injected callback, but they must not dynamically import `ink-shell`.
`ink-shell` remains the composition root and mounted host.

### 5. Verification And Delivery

Each behavior change follows red-green-refactor: a focused failing test, a
minimal fix, then the focused suite. Each repair slice is committed separately.
The final gate is CLI unit/integration tests plus root formatting, typecheck,
lint, and build. Live provider checks remain opt-in because they validate
external volatility rather than deterministic CLI behavior.

## Boundaries

- Preserve the current persistent-shell architecture and `apps/cli/src/main.ts`
  entrypoint.
- Preserve the package-local render-capture harness and package-local test
  commands.
- Do not alter provider ordering, provider parsing, or live provider behavior.
- Do not change unrelated user edits outside `.gitignore` and `.run.toml`.
- Do not set a coverage percentage gate until a stable baseline is recorded;
  first make coverage reporting visible in CI.

## Acceptance Criteria

1. A stale detail request cannot replace the details for a newer title.
2. Browse mutation feedback is accurate for resolved and rejected callbacks.
3. New browse requests supersede old requests without stale state updates.
4. Workflow failures remain inside the shell with a diagnostic and user-facing
   feedback.
5. Manual sync reports partial and total failures without skipping later work.
6. Playback terminal outcomes have direct `execute()` characterization coverage.
7. The workflow host boundary no longer requires a workflow-to-`ink-shell`
   dynamic import for the extracted family.
8. CLI focused tests and full deterministic gates pass.
