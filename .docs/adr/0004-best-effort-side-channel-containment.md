---
status: current
lastReviewed: "2026-09-19"
---

# 0004 — Containment for best-effort side channels

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Status: accepted
Date: 2026-09-19

## Context

`main.ts` escalates any `uncaughtException` to a fatal shutdown with exit code

1. That is correct for the load-bearing path — a broken provider engine or
   playback session should not limp — but it is catastrophic when the throw comes
   from something cosmetic. Issue #94 is the proof: a malformed Discord IPC frame
   reached the fatal path through an unguarded `JSON.parse` in a raw socket
   callback, so a decorative integration could end a user's playback session.

The subsystems that are allowed to fail silently were never enumerated, and
there was no stated boundary keeping them off the fatal path — so the rule was
remembered (or forgotten) at forty call sites instead of enforced at one.

## Decision

**Best-effort subsystems are enumerated, and none may reach the fatal path.**
The best-effort set is: Discord/Rich **presence**, **analytics**, **update
checks**, **recommendations prefetch**, and **artwork** rendering. Each is
verifiably non-essential: the app plays, browses, and records history with all
of them off.

**The containment boundary is a supervised-task helper at each subsystem's
launch seam** — a single wrapper (e.g. `runBestEffort`) that a service's async
loops, timers, and socket/callback registrations route through, converting a
throw or rejection into a diagnostics event rather than letting it bubble to
`uncaughtException`. This matches how these subsystems actually launch: each
is a self-contained service object (e.g. `PresenceServiceImpl`) with its own
heartbeat timers and socket callbacks, so one seam per service covers every
callback it registers — no per-call-site discipline required.

A best-effort subsystem that throws is degraded, not fatal: it logs a
diagnostics note and stays dead until restarted by user action. It may never
take down the playback session it decorates.

## Consequences

- A new best-effort subsystem must route its async work through the supervised
  seam; reaching `main.ts`'s fatal path from one is a review blocker, not a
  bug.
- A subsystem that turns out to be load-bearing gets removed from the
  best-effort list, not wrapped — the list is the contract, and this ADR is
  the thing to amend when it changes.
- The wrapper itself is follow-up implementation; this ADR records the rule
  and the chosen seam so #94-class findings have a reference instead of a
  re-derivation.

See [.docs/agents/audit-findings-bar.md](../agents/audit-findings-bar.md) for
how findings about failure reach get filed.
