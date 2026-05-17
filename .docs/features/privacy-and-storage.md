# Privacy And Storage

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
