# Docs and Release Gate V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep user docs, provider docs, and release checks aligned with the new provider runtime without increasing provider spam.

**Architecture:** Docs describe stable behavior, not hopeful implementation. Release gates stay deterministic by default, with manual opt-in provider and Discord smokes near release.

**Tech Stack:** `.docs`, `README.md`, `.plans/plan-implementation-truth.md`, package scripts.

---

## Agent Tracking Header

```text
SLICE_ID: P10
SLICE_STATUS: implemented
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: complete
SLICE_BLOCKERS: none
```

## File Ownership

Modify after code lands:

- `.docs/providers.md`
- `.docs/diagnostics-guide.md`
- `.docs/download-offline-onboarding.md`
- `.docs/playback-timing-and-aniskip.md`
- `.docs/testing-strategy.md`
- `.docs/quickstart.md`
- `README.md`
- `.plans/plan-implementation-truth.md`

Do not document behavior as shipped before the implementation slice lands.

## Tasks

### P10-T1: Update Provider Runtime Docs

- [x] Document global provider fallback vs provider-local cycling.
- [x] Document how new providers use the cycle engine.
- [x] Document user-control semantics: retry, next server, fallback provider, cancel.
- [ ] Commit with message `docs: explain provider runtime v2`.

### P10-T2: Update User-Facing Docs

- [x] Document filters, downloads, provider fallback, diagnostics, and post-playback latency behavior.
- [x] Keep docs concise and truth-based.
- [ ] Commit with message `docs: update user guide for provider runtime v2`.

### P10-T3: Update Release Gate

- [x] Keep live provider smokes opt-in.
- [x] Add release checklist: unit tests, build, package check, one provider smoke per engine, Discord smoke only when presence changed.
- [x] Update `.plans/plan-implementation-truth.md`.
- [ ] Run `bun run --cwd apps/cli fmt:check`.
- [ ] Commit with message `docs: document provider runtime v2 release gate`.

## Stop Conditions

- Stop if docs need to mention behavior that has not landed.
- Stop if a proposed CI/release gate would hit live providers by default.

## Acceptance Tests

- A new contributor can add a provider using the shared cycle engine.
- A user can understand why fallback happened.
- Release checks do not hit live providers unless explicitly invoked.
