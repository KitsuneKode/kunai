# Provider: Miruro

## Summary

- **Runtime class:** Direct HTTP pipe API by AniList ID, with browser harvest as research tooling.
- **Production module:** `packages/providers/src/miruro/*`.
- **Current status (2026-07-11):** **demote from default.** Live `container.engine.resolve(..., "miruro")` (One Piece AniList `21` / matrix E1159 fixture) fails before stream candidates. Anime default path remains AllAnime.

## Production status (2026-07-18)

- **Labels:** Hybrid — primary Tracks label is Gintama character (`Gintoki`, `Kagura`, …); detail is `Sub · hard sub` / `Dub · …` via `metadata.sourceDetail`. Emits `inventory:audio-modes` when the episode payload exposes sub and/or dub.
- **HLS quality:** Lone Pipe `master.m3u8` rows expand through shared `expandHlsMasterPlaylist` ([`packages/providers/src/shared/hls-ladder.ts`](../../packages/providers/src/shared/hls-ladder.ts)) into multiple quality candidates for `/quality`.
- **Live pipe (this environment):** `/api/secure/pipe` on `miruro.bz` / `miruro.ru` may return **HTTP 403 Cloudflare HTML**; fail-fast after 2 consecutive CF HTML mirrors.
- **Recommended disposition:** keep **demoted from default** (`animeProviderPriority` default remains `["allanime"]`). Re-promote after opt-in live matrix passes.

## Production status (2026-07-11)

- **Live matrix:** **fail** — One Piece fixture, isolated profile. Engine reports attempt timeout after `provider:start` (default ~12s) with zero streams.
- **Mirror reachability (this environment, redacted):**
  - `miruro.bz` / `miruro.ru`: DNS OK, TLS OK, root HTTP 200.
  - `miruro.tv` / `www.miruro.tv`: DNS OK, **TLS connect timeout**.
- **Pipe endpoint class:** On reachable mirrors, `/api/secure/pipe` returns **HTTP 403 HTML** (WAF / bot challenge shape) — not JSON/obfuscated pipe ciphertext. This is **not** pipe-key rotation and **not** decode-contract drift (those require HTTP 200 + body prefix / `x-obfuscated`).
- **Failure taxonomy:** `environment-network` / host blocking on the pipe path, compounded by slow dead mirrors eating the engine attempt budget. Not anime lane contract breakage inside Kunai.
- **Recommended disposition:** **demote from default** (remove from automatic `animeProviderPriority`). Keep module registered. Optional narrow repair: drop TLS-dead mirrors from the active list so failures surface as actionable pipe HTTP errors instead of opaque 12s timeouts.
- **Sub/dub:** Not re-proven on 2026-07-11 (resolve never reached source cycling). Historical May-25 matrix still documents `kiwi`/`bee` sub/dub paths when pipe succeeds.
- **Fixture:** One Piece AniList `21`, episode **1159** (live smoke / matrix). Research row: E100.
- **Redaction:** do not store pipe ciphertext, CDN URLs, cookies, or local profile paths.

## Current Evidence

### Pipe API

Miruro uses:

```text
/api/secure/pipe?e=<base64url payload>
payload = { path, method: "GET", query, body: null, version: "0.2.0" }
body = XOR with PIPE_KEY, optionally gzip, then JSON
```

Decode key (public client constant; rotate when upstream rotates):

```text
71951034f8fbcf53d89db52ceb3dc22c
```

Official domains observed historically:

- `miruro.tv`
- `miruro.to`
- `miruro.bz`
- `miruro.ru`

Historical note (2026-05): `miruro.bz` and `miruro.ru` were the most reliable direct pipe mirrors when the WAF allowed Bun fetch. `miruro.tv` / `www.miruro.tv` often timed out.

### Browser harvest, 2026-05-25

Command:

```sh
cd apps/experiments
bun scratchpads/browser-evidence-harvest.ts
```

Result:

- Miruro browser pipe: 8/9 steps succeeded.
- Search `solo leveling`: 94 ms, 3 results, AniList-shaped.
- Solo Leveling episodes: 89 ms.
- Solo Leveling `kiwi` sources: 88 ms, 12 HLS streams, no subtitles, no intro/outro.
- One Piece `kiwi` source failed after ~12.5s, but `bee` source succeeded in 266 ms.
- Watch-page sniff saw `theanimecommunity.com`, but only comment/community/embed assets and JSON without HLS/stream shape.

### Direct media check, 2026-05-25

For Solo Leveling S01E01 `kiwi` fixture:

- `vault-06.uwucdn.top` returned HTTP 200 HLS with `referer: https://kwik.cx/`.
- `vault-15.owocdn.top` returned HTTP 200 HLS with `referer: https://kwik.cx/`.
- A `kwik.cx` stream-shaped candidate returned HTTP 403.

Bench result after refreshed browser/direct evidence:

```text
Miruro Solo Leveling S01E01
providerOk=true
mediaOk=true
list=734ms
resolve=153ms
manifest=230ms
mpv=2982ms
streams=6
host=vault-06.uwucdn.top
```

So Miruro is not inherently broken. It needs better provider/source coverage and candidate filtering/ranking.

### Provider-key matrix, 2026-05-26

Command:

```sh
cd apps/experiments
bun scratchpads/provider-miruro/miruro-provider-key-matrix.ts
```

Report:

```text
apps/experiments/scratchpads/provider-miruro/miruro-provider-key-matrix-report.json
```

The matrix only fetched `sources` for provider/audio lists that explicitly contained the target episode number. It wrote redacted counts, hosts, qualities, referer origins, active counts, timings, and first failures; it did not preserve raw stream or subtitle URLs.

| Sample             | Provider keys                               | Strongest observed paths                                                                                                                                   |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solo Leveling S1E1 | `ANIMEKAI`, `ANIMEZ`, `ZORO`, `hop`, `kiwi` | `kiwi/sub` returned 12 streams with `kwik.cx`, `vault-06.uwucdn.top`, `vault-15.owocdn.top`; `kiwi/dub` returned 6; `hop/dub` returned 2.                  |
| Frieren S1E1       | `ally`, `bee`, `dune`, `hop`, `kiwi`        | `kiwi/sub` returned 6 streams; `ally/sub` returned 3; `ally/dub` returned 4; `bee/dub` returned 4 with 2 subtitles; `hop/dub` returned 2 with 9 subtitles. |
| One Piece E100     | `ally`, `bee`, `dune`, `hop`, `kiwi`        | `kiwi/sub` returned 4 streams; `bee/sub` returned 4; `bee/dub` returned 4 with 1 subtitle; `ally/dub` returned 1.                                          |

Some provider/audio paths returned HTTP 444 from the first mirror. Treat that as provider-key/source health evidence, not proof that the whole Miruro provider is down.

## Current Production Gaps

### G1: Provider key coverage is too narrow

Production currently models `kiwi` and `bee` as the server profiles. Live episode payloads expose more provider keys depending on title:

- `ANIMEKAI`
- `ANIMEZ`
- `kiwi`
- `hop`
- `ZORO`
- `ally`
- `dune`
- `bee`

The production resolver reads `epData.providers.kiwi.episodes` as the main episode source and builds candidates only for `kiwi`/`bee`. This can fail or underuse Miruro when another provider key is healthier for the title.

### G2: Candidate filtering is too trusting

Pipe `streams[]` can include HLS-like candidates that are not equally playable from mpv. The resolver should not treat every `type: "hls"` candidate as equally healthy:

- Prefer CDN hosts that pass direct manifest/mpv proof.
- Penalize or skip `kwik.cx` direct media candidates when they return 403.
- Preserve per-stream `referer`; do not replace it with a generic Miruro referer.

### G3: Docs overstated TAC

`theanimecommunity.com` is not proven as a direct stream backend. Current evidence shows community/comment embed behavior and small metadata JSON, not HLS. Treat it as non-playback evidence until a future probe proves otherwise.

## Known

- Pipe search can return AniList-shaped results quickly.
- Pipe episodes include rich episode metadata: title, image, air date, duration, filler flags, and audio mode.
- Pipe sources can return multiple HLS qualities and per-stream referer.
- Miruro can hit the target UX range: the refreshed Solo Leveling direct mpv check reached playback in ~3s.
- Browser harvest is useful for research fixtures, but production should stay direct HTTP unless a future runtime-browser package is explicitly introduced.

## Unknown

- Which provider key ordering is best across a representative anime set.
- Whether `ANIMEKAI` / `ANIMEZ` / `hop` / `ZORO` expose consistently mpv-compatible HLS beyond the current three-sample matrix.
- Whether soft subtitles are still common on a specific provider key or have drifted away from the older `bee` assumption.
- Whether a shared startup-health scorer should probe manifests in production or only learn from actual mpv outcomes.

## Recommended Fix Shape

### P0 (2026-07-11): Demote + fail-fast mirrors

1. Remove Miruro from default `animeProviderPriority` while AllAnime stays healthy.
2. Prefer only mirrors that complete TLS in this class of environment; do not spend the engine timeout on known dead hosts.
3. Re-promote only after opt-in live matrix passes with `container.engine.resolve` and honest diagnostics on WAF 403 vs connect failure.

### P1: Expand Miruro provider-key inventory in experiments

Before production changes:

1. For 3 sample titles, collect episode provider keys and source results:
   - Solo Leveling S1E1, AniList `151807`.
   - Frieren S1E1, AniList `154587`.
   - One Piece E100, AniList `21`.
2. For each provider key with matching episode data, fetch `sources`.
3. Redact stream URLs; keep counts, hosts, qualities, referers, subtitle counts, and direct media status.
4. Build a provider-key ranking table.

### P2: Generalize production candidates

After the table:

- Replace hardcoded `kiwi`/`bee` candidate construction with a normalized provider-key registry.
- Keep labels like `Kiwi`, `Bee`, `AnimeKai`, `AnimeZ`, `Hop`, `Zoro`, `Ally`, `Dune`.
- Preserve audio category (`sub`/`dub`) from each episode entry.
- Keep `subtitleDelivery` as evidence, not a hardcoded truth unless the source payload proves it.

### P3: Filter and rank stream candidates

- Prefer active HLS candidates when `isActive === true`.
- Prefer CDN HLS hosts over direct `kwik.cx` candidates when both are present.
- Penalize candidates with recent HTTP 403 / mpv failure in source-health cache.
- Use actual `mpv playing` latency as the strongest source-health signal.

### P4: Keep browser work in the lab

- Continue using Playwright browser harvest for evidence and fixtures.
- Do not default production Miruro to Playwright.
- If a future provider truly needs browser-held state, route that through a separate runtime-browser boundary and mark it as optional.

## Regression Samples

| Case                      | Expected                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Solo Leveling S1E1 `kiwi` | Direct mpv HLS should start in roughly 3s from this environment when CDN host is selected |
| One Piece E100            | `kiwi` can fail while `bee` succeeds; cycle must try alternate provider keys              |
| Watch page sniff          | TAC should not be treated as stream backend without HLS/stream evidence                   |
| Pipe mirrors              | Try reliable official mirrors before declaring pipe dead                                  |

## Rejected Shortcuts

- Do not bypass Cloudflare protections. Use public browser-visible evidence for research and direct supported endpoints for runtime.
- Do not switch production to `theanimecommunity.com` as a stream backend on current evidence.
- Do not assume `kiwi = hardsub` and `bee = softsub` forever; let source payloads and subtitles decide.
- **Runtime:** when `audioCategory === "sub"` and the pipe returns **zero** subtitle tracks, Kunai sets `subtitleDelivery: "hardcoded"` plus `hardSubLanguage` from the user subtitle preference (default `en`). When pipe subtitles exist, delivery is `embedded`/`external` with languages parsed from each track — no duplicate external rows for the same embedded tracks.
