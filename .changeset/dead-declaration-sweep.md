---
"@kitsunekode/kunai": patch
---

chore: remove declarations with no production reader (#474)

- `provider-resolve-retry.ts` deleted — the engine's own retry loop owns
  attempts now; this was a pre-engine leftover kept alive by its tests.
- `provider-shadow-probe.ts` deleted — the selector shipped without its
  executor; the handoff plan now records Slice B as unwritten.
- `servedFromCacheAfterFailure` and the "Using cached source" copy removed —
  the only event that could feed it fires at resolve commit, after the wait
  surface it described is gone; the post-resolve note already covers it.
- The async `isMuslEnvironment` probe removed — every runtime ships
  `process.report.glibcVersionRuntime`, so the sync check is the whole job.
- `attentionInbox`/`queueRecovery`/`newEpisodeProjection` gained
  `KUNAI_*` env kill switches — declared flags that only tests could set are
  now real operator controls.
- `research.ts`: videasy's source host corrected to api.speedracelight.com.
- `curl-impersonate.ts`: dropped the unreachable `Number.isFinite` guard.
- `experimental.ts` kept — it is a deliberate lab-only package export.
