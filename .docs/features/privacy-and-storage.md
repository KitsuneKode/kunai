---
status: current
lastReviewed: "2026-10-07"
---

# Privacy And Storage

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai keeps user-owned data durable and treats provider/runtime artifacts as disposable.

## Durable User Data

Do not delete this during automatic cleanup:

- config
- provider overrides
- history/progress
- playlists
- followed or muted title preferences
- completed download records
- sync tokens

## Disposable Cache

Automatic maintenance may prune cache and runtime evidence:

- stream cache
- source inventory
- recommendation cache
- schedule cache
- resolve traces
- stale provider health

Cleanup must be best-effort and non-blocking. It should not block playback or shell startup, and it should avoid automatic `VACUUM` unless a future explicit maintenance command asks for it.

## Configuration contention

A file-backed config read/merge/write requires its cross-process lock. When the
bounded acquisition wait (5 seconds by default) expires, persistence rejects before running the
callback and warns that settings were not saved. The lock owner's file remains
unchanged. Retry after the other session finishes; an unlocked write is not an
acceptable fallback for settings, especially consent.

Acquisition, stale reclaim, owner publication and release use the same ticket
transition guard. Every contender publishes an immutable unique choosing record
and ticket number before inspecting canonical ownership. Dead local ticket
owners can be removed without deleting a successor's reusable path. A live
canonical owner never expires by age, a foreign-host owner is retained, and
release compares the unique generation while holding the guard.

Choosing records and ticket numbers are ephemeral: they are published atomically
(unique temp file, then rename) but never fsynced, since crash recovery is by pid
liveness, not by their bytes surviving. `config.json` itself keeps the durable
write. On Windows a ticket file that is delete-pending or briefly held by a scanner
(EPERM/EACCES/EBUSY) is treated as still present, never as gone, so a contender
cannot be skipped while it is choosing; its owner retries removal of its own files.

Legacy numeric and pid:token records remain readable. Incomplete legacy records
receive a publication grace. Close older Kunai processes before upgrading:
those processes do not participate in the new transition protocol. This is a
local-filesystem contract; native macOS/Windows and shared-mount behavior need
separate qualification. Config reset uses the same persistence path.
