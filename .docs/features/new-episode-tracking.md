# New Episode Tracking

New episode tracking separates three facts:

- the episode is scheduled or aired
- Kunai believes the title is worth surfacing
- a provider has confirmed a playable stream

Only provider-confirmed playable releases create playable notifications. Aired but unconfirmed episodes can appear as shelf/context state later, but should not pretend playback is available.

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
