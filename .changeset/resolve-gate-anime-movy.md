---
"@kitsunekode/kunai": patch
---

Probe streams before Movy, HiAnime, KickassAnime, and AnimeGG report success.

Four registered providers assembled their stream lists and returned
`resolved` without ever fetching a candidate URL — the exact false-success
shape the resolve gate exists to prevent. Each now runs the shared
`verifyCandidateStream`/`selectVerifiedStream` gate on the selected stream
(and up to two rank-ordered fallbacks) with the candidate's own headers; a
rejected stream refuses its whole host for that resolve, and a fully dead
ladder ends in an honest `exhausted` result so the fallback cycle can move on
instead of handing mpv a dead URL.

The gate-coverage test no longer trusts a hand-maintained provider list — it
parses `loadProductionProviderModules()` so a newly registered provider that
skips the gate fails the suite on its own.
