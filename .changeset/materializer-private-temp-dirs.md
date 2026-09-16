---
"@kitsunekode/kunai": patch
---

Create the temp directories that feed mpv privately.

Both playback materializers built a temp directory name from
`Date.now()` plus `Math.random()` and created it with
`mkdir(..., { recursive: true })`. `recursive: true` succeeds on a path that
already exists, and `Math.random` is not a CSPRNG, so on a shared machine
another local user could pre-create or symlink that path and read or rewrite
the HLS playlist or MPD that mpv was about to load.

Both now use a single `createPrivateTempDir` helper built on `mkdtemp`, which
fails on collision rather than adopting an existing directory and creates with
mode 0700 instead of 0755. The two materializers were carrying identical copies
of the helper, so this removes the duplicate as well.
