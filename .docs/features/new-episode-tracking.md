---
status: current
lastReviewed: "2026-10-12"
---

# New Episode Tracking

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

New episode tracking separates three facts:

- the episode is scheduled or aired
- Kunai believes the title is worth surfacing
- a provider has confirmed a playable stream

Only provider-confirmed playable releases create playable notifications. Aired but unconfirmed episodes can appear as shelf/context state later, but should not pretend playback is available.

## Surfaces that read release state

- The calendar marks unseen releases against `settings.lastCalendarVisitAt`.
- Browse home reads the same projections through
  `ReleaseProgressCacheRepository.listNewSince(lastCalendarVisitAt)` and shows a
  single "N new since {day}" idle row (`browse-idle-actions.ts`). It follows the
  same rules: provider-confirmed only, muted titles excluded, stale or
  upcoming projections never count, and no visit stamp means no strip.

## Sync Policy

Background provider availability sync is experimental and off by default.

When enabled, sync must be budgeted:

- visible rows first
- followed titles before implicit titles
- muted titles never refresh
- stale values are acceptable for non-visible items
- provider checks must not run as an unbounded N+1 loop

The current worker policy is deterministic and guarded:

- with the experimental flag off, it is inert
- with the flag on and no refresh callback, it only returns the planned IDs
- when a refresh callback is supplied, it passes an `AbortSignal`, stops on cancellation, records runtime diagnostics, and only executes the budgeted planned IDs

Actual provider calls remain an opt-in experimental integration behind that callback.
