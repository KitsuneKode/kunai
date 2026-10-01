---
"@kitsunekode/kunai": patch
---

Audit-4 hygiene: transport vs offline failure classification, bounded session caches, and a tokened local HLS relay.

Provider network failures are now classified on two axes instead of one:
`isTransportNetworkFailure` (retryability — DNS, reset, refused, timeout, TLS,
generic fetch failures) and `isOfflineNetworkFailure` (machine-offline
_evidence_ — deliberately narrower, so one dead endpoint like a reset or TLS
error can no longer vote the whole machine offline). Offline verdicts need
corroboration across distinct servers, and a multi-mirror provider keeps
trying its lanes instead of abandoning on the first transport error.

TMDB and AniSkip session lookups are LRU-bounded at 500 entries, so long
browse sessions stop growing unbounded in-memory maps. The local HLS relay
mints a random per-session path token: the URL handed to the player, every
playlist-rewritten segment, and every nested playlist URI carry it, and a
missing or wrong token answers an indistinguishable 404 — a same-host process
can no longer compute the path from a known CDN URL and drive the relay with
Kunai's headers.

A hand-edited `config.json` with a blank or malformed `youtubeProvider` now
falls back to the YouTube default instead of the series provider default.
`bun run check` in `apps/cli` is read-only (`fmt:check`, not `fmt`), the
`turbo.json` schema URL and a duplicate `typecheck` cache key are corrected,
and provider tests that patch `globalThis.fetch`/`Bun.which`/`PATH` restore
them unconditionally so a leaked stub can no longer flake the next file.
