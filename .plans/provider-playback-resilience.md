# Provider playback resilience

Residue from the 2026-09-08 provider health pass. Four fixes landed on
`worktree-provider-health-fixes`; this is what that work exposed and did not
close.

**Framing:** every defect below is the same shape — _a provider reports success
for something that cannot play_. Resolve-time success is not the contract users
care about; decode is. The pass added a headless mpv verifier
(`apps/cli/test/live/mpv-playback-verify.ts`, `bun run test:live:mpv`) so that
distinction is now measurable, and it should become the gate rather than a
manual step.

## P0 — Videasy resolves a URL that is dead on arrival

Videasy is the **default** movie/series provider, and on 2026-09-08 it went from
healthy to shipping an unplayable stream within one session.

Reproduction (`bun run test:live:mpv videasy`, fixture Dutton Ranch S01E01):

- resolves `moon.peakstorm.top/vd/<token>/index-s2160p-v1-a1.m3u8` in ~2s,
  reports `Yoru:success`, `streamResolved: true`, 4 candidates
- `mpv` exits 2; the matrix row is `provider-drift`, `streamReachable: false`
- fetched in-process **0ms after resolve**, the manifest is already `403`
- `403` for every header shape tried (referer+origin+UA, no-origin, UA-only,
  bare, origin-without-referer) and for every variant path (`master.m3u8`,
  `index.m3u8`, 2160p/1080p/720p)
- the token is byte-identical across runs, so it is a stable dead URL, not a
  single-use or expiring one

What is not yet explained: **videasy has a resolve gate and the gate passes
this URL.** `probeSelectedVidkingPayloadStream` returns `{ok:false}` on an
unhealthy probe and its caller correctly does `if (!streamProbe.ok) break`, yet
the dead stream is still returned. Either the gate probes something other than
the URL that ships, or its `context.fetch` sees a different answer than bare
`fetch` and mpv. Instrument the probe's observed status and URL before changing
behaviour — this is the single highest-value thing left.

## P1 — Gate budgets must be able to reach a verdict

An HLS resolve gate is three sequential round trips (master, variant, segment).
Measured against a live dead mirror those totalled 2.1–2.9s, while the shared
`resolveGateTimeoutMs` is **3s** and videasy's `vidkingResolveGateTimeoutMs` is
**2.5s**. A cut-short probe reports `timeout`, which `isStreamReachableForResolve`
deliberately treats as "not proven dead" — so an under-budgeted gate silently
passes dead streams, and does it _intermittently_.

Rivestream demonstrated this: the same candidate was rejected on one run and
accepted on the next until its budget moved to 6s
(`RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS`, with a test pinning it below the
candidate timeout). Audit the remaining budgets the same way. Raising videasy's
to 6s alone did **not** fix P0, so treat these as independent.

## P1 — Three providers have no resolve gate at all

Only `videasy`, `vidlink` and (now) `rivestream` verify a stream before
declaring success. `allanime`, `anidb` and `miruro` return the first URL they
decode. They are currently saved by `checkStreamPreflight`, which runs for every
provider before the mpv handoff — but preflight only aborts playback, it cannot
make provider-local cycling try the _next_ source. That is exactly the
difference that took Rivestream from dead to playable.

Decide per provider (the "every provider" seam), and note YouTube legitimately
opts out: mpv resolves the watch URL through ytdl.

## P2 — Pinned upstream constants rot silently

AllManga's crypto rotates roughly monthly (`81 → 119 → 140 → 166`) and every
constant moves at once. Between rotations the provider returns zero streams with
no error, because bootstrap failure silently falls back to
`BUNDLED_ALLMANGA_CRYPTO`, whose epoch is a 7-day bucket that also goes stale.

The recovery procedure is now in
[the AllManga dossier](../.docs/provider-dossiers/allmanga.md), but recovery is
reactive. Worth adding: a scheduled check that fails loudly when the pinned
`buildId` stops being recognised (the bootstrap endpoint distinguishes
`unknown_build_id` from `invalid_boot_token`, so this is a cheap request), and a
staleness assertion on the bundled epoch so a fallback two epochs old cannot
masquerade as a working provider.

## P2 — Give the matrix a playback lane

`bun run test:live:matrix` proves resolve + reachability. It passed Rivestream
for weeks while the stream was unplayable, and it currently passes nothing that
mpv has actually decoded. With `test:live:mpv` in place, the matrix should carry
an opt-in playback column for the providers it supports (videasy, rivestream,
vidlink, youtube) so "healthy" means decoded.

## P2 — Rivestream first-resolve latency

The gate made Rivestream correct but slower: 8–20s to walk eight dead candidates
before reaching `citadel`, against a 12s balanced attempt budget. Endpoint
quarantine (`provider_endpoint_health`) should amortise this after the first
run, but every measurement here used an isolated profile, so the learning path
is unverified. Confirm a second resolve in the same profile skips the
quarantined mirrors, and that gate rejections feed `healthDelta` at all.

## Notes carried forward

- **Miruro** is Cloudflare-blocked (403 to plain curl _and_ to full Chrome TLS
  impersonation, both mirrors). Nothing to fix in code; the user-owned relay is
  the documented remedy and the failure message already says so.
- **AniDB** is a site-wide upstream `503`; ani-cli v5 uses the same host and is
  equally down. Nothing to fix beyond the honesty work that landed.
- **AllManga rate limiting**: `NEED_CAPTCHA` after several rapid resolves is
  upstream anti-abuse, surfaced as `AllMangaCaptchaError`. Not to be worked
  around.
- **`AGENTS.md` is stale on parity**: it calls
  `packages/providers/src/allmanga/api-client.ts` ani-cli parity logic, but
  ani-cli `a6ac602` (v5) deleted every AllAnime path. The dossier already says
  so; the root instruction file does not.
