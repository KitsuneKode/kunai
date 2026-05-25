# Provider usage, latency, and “are we doing it right?”

Research-only companion to `.plans/provider-capability-latency-audit.md` and `PROVIDER_LAB_PLAYBOOK.md`.

**Probe reports:** `probe-all-providers-report.json`, `provider-miruro/probe-evidence-report.json`

---

## 1. How Kunai actually uses each provider

### End-to-end user journeys

| Shell mode | Search service | Title id shape | Default provider | Fallback (engine order, health-filtered) |
|------------|----------------|----------------|------------------|----------------------------------------|
| **Anime** | AniList | AniList numeric → mapped to `allanime:{_id}` | `allanime` | `miruro` only (others lack `anime` mediaKind) |
| **Series / Movie** | TMDB (Videasy proxy) | TMDB numeric | `vidking` | `rivestream`, then **`allanime`** ⚠️ |

Engine registration order in `container.ts`: `miruro` → `rivestream` → `vidking` → `allanime`.
Fallback list is **user provider first**, then other compatible modules in that order (`PlaybackResolveService`).

### Per-provider use case (what it is for)

| Provider | Primary job | Identity required | Episode catalog in Kunai |
|----------|-------------|-------------------|---------------------------|
| **allanime** | Anime streams (sub/dub) | Internal `allanime:` show `_id` (from search mapping) | Provider `listEpisodes` — generic `Episode {id}` labels |
| **miruro** | Anime fallback, soft/hard sub servers | AniList id | Provider `listEpisodes` — **rich titles** from pipe |
| **vidking** | Movies + TV streams | TMDB id | **TMDB** `fetchEpisodes` in shell — not provider |
| **rivestream** | Movies + TV fallback | TMDB id | **TMDB** in shell — not provider |
| **cineby** (research) | Videasy flavor labels | TMDB via VidKing engine | N/A — not in engine |

### App-layer features (not in `packages/providers`)

| Feature | Applies to | Where |
|---------|------------|--------|
| Late **Wyzie** subtitles | TMDB series/movie when provider subs empty | `PlaybackPhase` + `subtitle.ts` |
| **IntroDB** timing | TMDB-shaped `title.id` | `IntroDbTimingSource` |
| **AniSkip** timing | Anime + MAL resolution | `AniSkipTimingSource` + `allanime` GraphQL for opaque ids |
| Provider **fallback** UI (`f`) | After primary fails / slow | `ink-shell` compatible providers |
| **Source inventory** / cache | All resolved providers | `PlaybackResolveWorkService` |

**Gap:** Miruro intro/outro in pipe is **not** wired to timing aggregator (audit slice A).

---

## 2. Latency model (cold foreground play)

Rough blocking HTTP count before first playable stream (no cache, first candidate succeeds):

| Provider | Min | Typical | Worst (exhaust) | Dominant cost |
|----------|-----|---------|-----------------|---------------|
| **allanime** | 2 | 3–6 | 10+ | Catalog GQL (+ referer retry) + episode GQL GET/POST + **N parallel** `allanime.day` link fetches + optional m3u8 variant expansion |
| **miruro** | 2 | 2–3 | 5 | 1× episodes pipe + 1–4× sources pipe (cycle) |
| **vidking** | 1 | 1–2 | **32** | 1× Videasy per try × query variants × retries × **8 server tiers** (4 direct + 4 embed) |
| **rivestream** | 2 | 2–3 | 2× providers | **+1 services** every cold resolve + 1× source per candidate |

**Probe RTT (this machine, single step):** AllAnime GQL ~370ms, Videasy ~725ms, Rivestream services ~271ms, Miruro pipe intermittent.

### Are we doing latency “right”?

| Provider | Verdict |
|----------|---------|
| **AllAnime** | **Mostly yes** — right architecture; optimize referer memo + cap parallel link jobs |
| **Miruro** | **Yes** — pipe + caches + cycle; fix metadata richness; key rotation only on decode failure |
| **Rivestream** | **Almost** — native hash is correct; **missing services TTL cache** |
| **VidKing** | **No on failure path** — retry/variant/server fan-out is the main antipattern |

---

## 3. Capability vs usage-matrix (doc drift)

`.docs/provider-dossiers/usage-matrix.md` is aspirational in places:

| Matrix claim | Code truth |
|--------------|------------|
| VidKing seek thumbnails via HLS IMAGE | **Not implemented** in `vidking/direct.ts` (Suspected / defer) |
| AllManga native episode thumbnails in catalog | Search has `thumbnail`; **episode list** is id strings only |
| Miruro XOR API | **Correct** |
| Cineby as row in matrix | **Research only** — not in engine |

---

## 4. Per-provider: right way vs weird way

### AllAnime / AllManga — **reference implementation**

**Right (what we do):**

- GraphQL on `api.allanime.day` with youtu-chan referer fallback
- Persisted-query GET for episode sources (ani-cli parity)
- `sourceCache` / `showCatalogCache`
- `runProviderCycle` for source families
- Fixtures in `packages/providers/test/fixtures/allmanga/`
- `anime-provider-mapping.ts` bridges AniList discovery → native `_id`

**Weird / fix:**

- Manifest lists `mediaKinds: ["anime", "series"]` but `resolve()` **only accepts anime** → wasted **series-mode fallback** slot when VidKing fails
- Episode picker labels are generic while Miruro has titles for same AniList ids
- Double catalog GQL when primary referer returns empty shape

**Experiments:** `provider-allmanga/sniff-allmanga-episodes.ts`, `allmanga-metadata-sniff.ts` (Playwright for site UI only — not production path)

---

### Miruro — **right API, tune failure + richness**

**Right:**

- `miruro.tv/api/secure/pipe` only (production)
- Episode cache 30m, source cache 5m
- kiwi/bee × sub/dub cycle
- `listEpisodes` with pipe titles

**Weird / reject:**

- Playwright scrapers in experiments as default
- `theanimecommunity.com` as stream CDN (returns `{ mediaItemID }` only — probed 2026-05-25)
- Scraping random 32-hex keys from HTML
- Hardcoded key paranoia on every request (key still decodes when pipe responds)

**Experiments:** `probe-evidence-2026.ts`, `miruro-0-ram-scraper.ts` (use probe script instead of headless for health checks)

---

### VidKing — **right decrypt, wrong retry economics**

**Right:**

- Single Videasy API + WASM decrypt + `runProviderCycle` with health tracker
- TMDB search via separate service (not provider search)
- Late Wyzie at app layer (correct separation)

**Weird:**

- 404 retryable → multiplies latency on missing titles
- Year query variant when `tmdbId` already in query
- Embed-referer tier doubles server count
- WASM decode global queue (necessary for correctness; be aware of contention)

**Experiments:** `VIDKING_NETWORK_ANALYSIS.md` — Wyzie is lazy in browser; we already compensate with `resolveSubtitlesByTmdbId`

**Use case:** Default for **all non-anime** playback; user expects TMDB episode names from shell, not VidKing.

---

### Rivestream — **right 0-RAM, one missing cache**

**Right:**

- MurmurHash `secretKey` in-process (matches experiment report)
- `providerJson` + cycle per backend provider name
- Subtitles from `captions`
- `relaySafe: true` in manifest (only provider marked relay-safe)

**Weird:**

- `VideoProviderServices` on every cold resolve (easy win: 24h module cache)
- Manifest `status: "candidate"` but registered in production engine

**Experiments:** `RIVESTREAM_DECRYPT_REPORT.md`, `rivestream-headless.ts` — production already headless in `direct.ts`

**Use case:** **Fallback** when VidKing exhausts; same TMDB identity — good fit.

---

### Cineby — **research, not runtime**

**Right:**

- Flavor wrapper over `resolveVidkingDirect` with server/language filters
- Experiments map extra Videasy servers (`meine`, `hdmovie`, etc.)

**Weird:**

- Treating Cineby as a separate provider in product matrix
- Playwright-heavy scratchpads for routine resolve

**Use case:** Future **flavor picker** for multilingual/region servers — promote only after matrix live test per flavor.

---

## 5. Unified “smart provider” checklist

Before changing production:

1. **One canonical HTTP API** per provider (no browser on hot path)
2. **TTL caches** for catalog, episode list, services list, pipe sources
3. **`runProviderCycle`** with `maxAttemptsPerCandidate: 1` at cycle layer; retries only when evidence-backed
4. **Manifest mediaKinds match `resolve()`** — no fallback slots that always fail
5. **Preserve rich fields at zero cost** (Miruro timing, artwork, MAL ids)
6. **App-layer concerns stay in app** (Wyzie, IntroDB, AniSkip)
7. **Fixture + probe JSON** before implementation
8. **`ProviderFetchPort`** for impersonation — one injection, not per-provider TLS hacks

---

## 6. Recommended fixes by impact (no code in this doc)

| P | Fix | Providers | User-visible effect |
|---|-----|-----------|---------------------|
| P0 | Trim VidKing 404/variant/embed fan-out | vidking | Faster failure + fallback to Rivestream |
| P0 | Miruro intro/outro → metadata + timing source | miruro | Instant skip without AniSkip round-trip |
| P1 | Rivestream services cache | rivestream | ~200–300ms off cold TV/movie |
| P1 | Remove `series` from allanime manifest OR implement series resolve | allanime | Stop wasted fallback attempt on TV |
| P2 | AllManga referer + episode GET/POST memo | allanime | Fewer GQL round-trips |
| P2 | Anime episode labels: prefer Miruro list when AniList id + miruro available | shell | Better picker UX |
| P3 | Promote Cineby flavors | cineby/vidking | More audio/language servers |
| Defer | HLS seek thumbnails for VidKing | vidking | Needs manifest parse proof |

---

## 7. Research commands

```sh
bun run --cwd apps/experiments miruro:probe
bun scratchpads/probe-all-providers-usage.ts
cd packages/providers && bun test test
```

---

## 8. Stale experiment / doc files to treat carefully

| File | Issue |
|------|--------|
| `MIRURO_BACKEND_REPORT.md` | Stream backend claim — partially debunked |
| `usage-matrix.md` | VidKing/Cineby seek thumbs; AllManga episode thumbs |
| `episode-metadata-audit/REPORT.md` | Miruro titles “not wired” — stale |
| `RIVESTREAM_DECRYPT_REPORT.md` | Still accurate for secretKey |
| `VIDKING_NETWORK_ANALYSIS.md` | Accurate for Wyzie lazy-load; app already handles |
