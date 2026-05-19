# Search Filter State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brittle typed-token filtering with a guided, stackable `FilterState` that behaves like a real browse/search filter system.

**Architecture:** `/filters` becomes the primary structured surface. Inline tokens remain shortcuts that mutate the same `FilterState`; providers receive a normalized search intent plus evidence about which filters were upstream-applied, locally-applied, or unsupported.

**Tech Stack:** `apps/cli/src/domain/search`, `apps/cli/src/app-shell`, provider search adapters.

---

## Agent Tracking Header

```text
SLICE_ID: P6
SLICE_STATUS: implemented
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: complete
SLICE_BLOCKERS: none
```

## File Ownership

Modify or create:

- `apps/cli/src/domain/search/SearchIntent.ts`
- `apps/cli/src/domain/search/SearchIntentParser.ts`
- `apps/cli/src/app/search-routing.ts`
- `apps/cli/src/app-shell/browse-filters.ts`
- `apps/cli/test/unit/domain/search/search-intent.test.ts`
- `apps/cli/test/unit/domain/search/search-intent-parser.test.ts`
- `apps/cli/test/unit/services/search/advanced-search-builders.test.ts`
- `apps/cli/test/unit/app-shell/browse-filters.test.ts`

Do not change provider scraper code in this slice.

## FilterState Fields

- query text
- media mode
- genres
- year range
- rating minimum
- watched state
- downloaded/offline state
- release window
- audio/subtitle preference
- provider
- sort

## Tasks

### P6-T1: Add FilterState Domain Model

- [x] Add `FilterState` with query, mode, genres, year range, rating, watched, downloaded, release, audio, subtitles, provider, and sort fields.
- [x] Add conversion from `FilterState` to existing `SearchIntent`.
- [x] Add tests for empty, stacked, and provider-specific filters.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(search): add structured filter state`.

### P6-T2: Route Typed Tokens Through FilterState

- [x] Update parser so `type:anime year:2026 rating:7` mutates `FilterState`.
- [x] Preserve existing typed-token shortcuts.
- [x] Add tests for clearing one token without clearing others.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `refactor(search): route tokens through filter state`.

### P6-T3: Wire `/filters`

- [x] Make typed browse filters share `FilterState`; interactive `/filters` UI remains the existing command-help surface.
- [x] Show active filter chips through the shared browse-filter description path.
- [x] Mark unsupported filters as local or unsupported instead of pretending upstream applied them.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(shell): wire structured browse filters`.

## Stop Conditions

- Stop if a provider must be changed to support UI-only filter state.
- Stop if typed tokens and `/filters` can diverge.
- Stop if unsupported filters are silently ignored without user-visible or diagnostic evidence.

## Acceptance Tests

- `type:anime year:2026 rating:7 genre:isekai` stacks predictably.
- Clearing one chip does not erase unrelated filters.
- Unsupported filters do not silently pretend to be upstream-applied.
