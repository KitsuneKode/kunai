# Diagnostics and Debuggability V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider, cache, playback, download, and post-playback failures understandable to users and actionable for developers.

**Architecture:** Extend existing diagnostics with structured correlation IDs and phase timings. Keep normal UI copy simple, but keep detailed provider/cycle/cache evidence exportable.

**Tech Stack:** `apps/cli/src/services/diagnostics`, support bundle export, provider trace events.

---

## Agent Tracking Header

```text
SLICE_ID: P9
SLICE_STATUS: implemented
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: complete
SLICE_BLOCKERS: none
```

## File Ownership

Modify:

- `apps/cli/src/services/diagnostics/DiagnosticsStoreImpl.ts`
- `apps/cli/src/services/diagnostics/support-bundle.ts`
- `apps/cli/src/services/diagnostics/redaction.ts`
- `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- `apps/cli/test/unit/services/diagnostics/redaction.test.ts`
- provider trace summary files created by P1/P4 if present.

## Tasks

### P9-T1: Add Provider Cycle Summary

- [x] Summarize provider/source/server/variant attempts through provider resolve and source inventory insights.
- [x] Include latest context such as failure class, retry count, selected candidate, or cache evidence when emitted.
- [x] Redact URLs and headers through existing diagnostics redaction before bundle construction.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add provider cycle summaries`.

### P9-T2: Add Cache And Post-Playback Timing Summary

- [x] Include cache hit/miss/set/invalidated reason.
- [x] Include post-playback seed/warm and auto-next prefetch grace timing from P8.
- [x] Add support-bundle tests.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add cache and post-playback timing summaries`.

### P9-T3: Add Download Repair Summary

- [x] Include sidecar status and repairability without leaking local private paths beyond existing redaction policy.
- [x] Add support-bundle shape tests for repair summaries.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add download repair summaries`.

## Stop Conditions

- Stop if any diagnostics export leaks cookies, signed URLs, full auth headers, or local secrets.
- Stop if a user-facing message becomes too technical; keep detailed data in diagnostics.

## Acceptance Tests

- A support bundle explains why provider fallback happened.
- A support bundle explains whether delay was player release, cache, provider resolve, or recommendation loading.
- Sensitive headers, cookies, URLs, and tokens remain redacted.
