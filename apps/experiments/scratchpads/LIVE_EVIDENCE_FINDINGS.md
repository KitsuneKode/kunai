# Live HTTP evidence (2026-05-24)

Source: `bun apps/experiments/scratchpads/live-evidence-harvest.ts` → `live-evidence-report.json`
Environment: Bun `fetch`, no mocks. Miruro is **intermittent** from this egress (`ECONNRESET`); two runs captured below.

## Run A (21:50 UTC) — Miruro OK

| Step | Status | ms | Evidence |
|------|--------|-----|----------|
| AllAnime GQL search | 200 | 334 | 2 edges for "solo leveling" |
| AllAnime GQL show (stale `_id`) | 200 | 385 | `data.show: null` + GQL error (bad fixture id) |
| Miruro pipe episodes (AniList 21) | 200 | 674 | 1163 sub episodes decoded |
| Miruro pipe search | 200 | 263 | 3 results; AniList-shaped (`id`, `idMal`, titles) |
| Miruro pipe sources (OP ep1, kiwi) | 200 | 274 | 4 streams; **no intro/outro** on this title/ep |
| Videasy Breaking Bad | 200 | 785 | ~63 KB payload |
| Videasy fake TMDB | **500** | 386 | `Unable to load media sources` (not 404) |
| Rivestream services | 200 | 237 | 6 providers (harvest used wrong embed URL → 403) |
| TAC mediaItemID | 200 | 262 | `{ mediaItemID: 387 }` only |
| TAC follow-ups | 200 | ~310 | HTML ~2.3 KB, no stream JSON |
| AniList search | 200 | 347 | 3 media hits |

## Run B (21:52 UTC) — Rivestream fixed

| Step | Status | ms | Evidence |
|------|--------|-----|----------|
| Miruro pipe | **ECONNRESET** | ~110 | Same host flaky |
| Rivestream `tvVideoProvider` + `generateSecretKey(1396)` | 200 | 93 | **4 sources**, sample quality 1080 |
| Rivestream services | 200 | 277 | 6 services; first `flowcast` |

Supplementary probe: `flowcast` returns ~9.7 KB JSON with proxied HLS URLs; `self`/`vidking` return `{ error }` (~28 B) for TMDB 1396 S01E01.

## Research conclusions (code + live)

### P0 — Series fallback → AllAnime (code-proven, not live)

`allanimeManifest.mediaKinds` includes `"series"` but resolver requires `mediaKind === "anime"`. TV resolve fallbacks can include `allanime` after VidKing/Rivestream — wasted round-trip.

### Miruro

- **Search via pipe works** when connection holds (`path: search`, `type: ANIME`) — viable optional discovery lane, not required for play (production uses AniList id).
- **Hardcoded `PIPE_KEY` still decodes** when pipe returns 200 (do not assume key rotation without decode failure).
- **Intro/outro**: fixture has them; **live OP ep1 kiwi did not**. Treat provider timing as best-effort; wire when `sources.intro/outro` present, else IntroDB/AniSkip.

### VidKing / Videasy

- Missing TMDB title returns **500**, not 404 — retry policy should not assume HTTP 404 only.
- Breaking Bad path succeeds in ~0.8–1 s cold.

### Rivestream

- Must use `requestID=tvVideoProvider`, `proxyMode=noProxy`, per-title `secretKey` from MurmurHash — **not** `tvEmbedProvider` or static base64 key.
- Service list is dynamic (6 entries); only some services return sources for a given title.

### theanimecommunity

- Confirmed **ID mapper only** in probed chain; follow-up URLs return HTML, not playable stream objects. **Not** a production stream backend.

### AllAnime

- GQL reachable with `youtu-chan` referer; search works. Show query needs valid `_id` from search/mapping.

## Browser harvest (authoritative for Miruro pipe)

Bare `fetch` from Bun often gets `ECONNRESET` on Miruro. **Playwright session** (`page.evaluate` + `credentials: "include"`) succeeds reliably.

```sh
cd apps/experiments && bun run providers:browser-harvest
```

Outputs:

- `scratchpads/browser-evidence-report.json`
- `scratchpads/browser-fixtures/{miruro,rivestream,allanime,vidking,theanimecommunity}/`

**2026-05-24 browser run (summary):**

| Provider | Browser result |
|----------|----------------|
| Miruro | 9/9 pipe steps (search, episodes×3 titles, sources kiwi/bee) |
| Miruro watch | Pipe + AniList; TAC = **comment embed only** (`embed.js`, `mediaItemID`) — not streams |
| Rivestream | `tvVideoProvider` + MurmurHash secret → 4 sources (flowcast) |
| AllAnime | GQL search + show with valid `_id` from search (youtu-chan referer) |
| VidKing | Videasy calls on embed page |

**Intro/outro:** No `intro`/`outro` in any captured live sources (OP ep1, Frieren ep1, SL ep1). Unit fixture `packages/providers/test/fixtures/miruro/source-response.json` is **not** representative of current API — treat intro as optional when present.

## Re-run (fetch-only)

```sh
cd apps/experiments && bun scratchpads/live-evidence-harvest.ts
```

Use browser harvest when Miruro or referer-sensitive endpoints matter.
