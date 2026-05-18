# Diagnostics and Debuggability V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider, cache, playback, download, and post-playback failures understandable to users and actionable for developers.

**Architecture:** Extend existing diagnostics with structured correlation IDs and phase timings. Keep normal UI copy simple, but keep detailed provider/cycle/cache evidence exportable.

**Tech Stack:** `apps/cli/src/services/diagnostics`, support bundle export, provider trace events.

---

## Agent Tracking Header

```text
SLICE_ID: P9
SLICE_STATUS: planned
SLICE_OWNER: unassigned
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: P9-T1
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

- [ ] Summarize provider/source/server/variant attempts.
- [ ] Include elapsed time, failure class, retry count, and selected candidate.
- [ ] Redact URLs and headers.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add provider cycle summaries`.

### P9-T2: Add Cache And Post-Playback Timing Summary

- [ ] Include cache hit/stale/miss/invalidated reason.
- [ ] Include post-playback timing spans from P8.
- [ ] Add support-bundle tests.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add cache and post-playback timing summaries`.

### P9-T3: Add Download Repair Summary

- [ ] Include sidecar status and repairability without leaking local private paths beyond existing redaction policy.
- [ ] Add redaction tests.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): add download repair summaries`.

## Stop Conditions

- Stop if any diagnostics export leaks cookies, signed URLs, full auth headers, or local secrets.
- Stop if a user-facing message becomes too technical; keep detailed data in diagnostics.

## Acceptance Tests

- A support bundle explains why provider fallback happened.
- A support bundle explains whether delay was player release, cache, provider resolve, or recommendation loading.
- Sensitive headers, cookies, URLs, and tokens remain redacted.
