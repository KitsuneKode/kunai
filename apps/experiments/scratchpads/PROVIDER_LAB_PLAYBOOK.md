# Provider Lab Playbook (evidence-first)

Research-only. Production code lives in `packages/providers/` and must not import from here.

## Gold standard: AllAnime / AllManga

What makes it fast and maintainable:

| Property | AllManga pattern | Why it matters |
|----------|------------------|----------------|
| Stable API contract | GraphQL + persisted GET hash on `api.allanime.day` | No DOM, no WASM in hot path |
| Referer discipline | Primary referer + known fallback (`youtu-chan.com`) | Documented, testable |
| Caches | `showCatalogCache`, `sourceCache` (45s / per-episode) | Repeat work is cheap |
| Candidate cycle | `runProviderCycle` with bounded attempts | Predictable latency |
| Decode once | Hex + AES-CTR in-process | No browser |
| Evidence | Fixtures under `packages/providers/test/fixtures/allmanga/` | CI proves normalization |

**Target shape for every provider:** one canonical HTTP API, TTL caches, cycle engine, fixtures before promotion.

---

## Browser capture (use this for correct fixtures)

```sh
cd apps/experiments && bun run providers:browser-harvest
```

- Script: `scratchpads/browser-evidence-harvest.ts`
- Uses **Playwright** (same pattern as `miruro-headless.ts`): real cookies, in-page `fetch('/api/secure/pipe')`
- Writes decoded JSON under `scratchpads/browser-fixtures/` for lab review and future promotion to `packages/providers/test/fixtures/`
- Bare Bun `fetch` is still useful for Rivestream/AllAnime/Videasy; Miruro should be validated in-browser first

---

## Experiment evidence (2026-05-25, this machine)

### Follow-up: AllManga and Miruro latency audit

**Miruro browser harvest**

```sh
cd apps/experiments
bun scratchpads/browser-evidence-harvest.ts
```

Latest observed result:

| Check | Result |
|-------|--------|
| Browser pipe | 8/9 Miruro steps OK |
| Solo Leveling pipe search | 94 ms, 3 AniList-shaped results |
| Solo Leveling episodes | 89 ms |
| Solo Leveling kiwi sources | 88 ms, 12 HLS streams |
| One Piece E100 kiwi | failed after ~12.5 s |
| One Piece E100 bee | 266 ms, 4 HLS streams |
| TAC watch sniff | comment/community/embed assets, no HLS/stream JSON |

Latest direct playback bench:

```text
Miruro Solo Leveling S01E01:
list 734ms, resolve 153ms, manifest 230ms, mpv 2982ms, host vault-06.uwucdn.top
```

Interpretation:

- Miruro can hit the 1-4 second feedback/playback target when a good CDN candidate is selected.
- Production should expand beyond the current `kiwi`/`bee` assumption and rank provider keys/candidates by actual source health.
- Playwright remains a fixture/evidence tool, not the production resolver.

**AllManga `Ak` drift**

Solo Leveling Season 1 episode 1 currently decodes to:

| Source | Shape | Current Kunai result |
|--------|-------|----------------------|
| `S-mp4` | `mp4: true`, no usable `link` | skipped / empty |
| `Ak` | DASH-style `rawUrls.vids[]` + `rawUrls.audios[]` + subtitles | skipped because not modeled |

Interpretation:

- AllManga is not slow here; it is returning a newer stream shape.
- Do not hand mpv a video-only `Ak` URL.
- Next experiment is a local MPD/EDL proof that combines one video representation and one audio representation.

### Miruro pipe (production path)

Script: `provider-miruro/probe-evidence-2026.ts` → `probe-evidence-report.json`

| Check | Result |
|-------|--------|
| `GET miruro.tv/api/secure/pipe` (episodes, AniList 21) | HTTP 200, `bh4YNPj7` prefix |
| Decode with **hardcoded** `PIPE_KEY` in production | **Valid JSON**, 1163 sub episodes |
| Regex-extracted 32-hex from homepage HTML | **Wrong key** (garbage decode) |
| Homepage → `_next/static` chunk scan | Intermittent `ECONNRESET` (same class as prod network errors) |

**Conclusion:** Failures in this environment are often **egress/WAF intermittency**, not a rotated key. The hardcoded key still works when the pipe responds.

**When to build dynamic key extraction:** Only as a **fallback** after decode fails with the cached key — scan JS for `VITE_PIPE_OBF_KEY`, never arbitrary 32-hex strings from HTML.

### `theanimecommunity.com` (experiment hypothesis)

```
GET .../episodes/mediaItemID?AniList_ID=21&episodeChapterNumber=1
→ 200 {"mediaItemID":387}
```

No stream URLs, no HLS markers. This is at most an **ID mapping** step, not a VidKing-style direct stream backend.

**Do not** replace `miruro.tv/api/secure/pipe` on `MIRURO_BACKEND_REPORT.md` claims alone.

### Cross-provider egress (same Bun fetch, same UA)

| Endpoint | Status | Note |
|----------|--------|------|
| Miruro pipe | 200 | Large obfuscated body |
| Videasy (VidKing) | 200 | Encrypted payload |
| Rivestream services | 200 | `{"data":["flowcast",...]}` |
| `api.allanime.day` bare GET | 403 | Needs referer/POST (production path is correct) |

---

## Antipatterns (reject)

| Idea | Why reject |
|------|------------|
| Playwright per provider for routine resolve | RAM, flake, CI cost; quarantined in `archive/legacy/` |
| `rejectUnauthorized: false` for “WAF bypass” | Security hole; does not spoof JA3 |
| Scrape any 32-char hex as `PIPE_KEY` | False positives (see probe report) |
| Switch Miruro to `theanimecommunity` | Evidence shows metadata only |
| Duplicate Wyzie inside `vidking/direct.ts` | App already has `subtitle.ts` late lookup |
| TLS library per provider | Fork explosion; use `ProviderFetchPort` injection once |
| Re-run full multi-provider smoke on every change | Use fixtures + targeted probes |

---

## Recommended architecture (unified, not weird)

### 1. Three layers

```text
Provider Lab (apps/experiments)
  → probe scripts, JSON reports, redacted shapes
  → promotion gate: fixture + dossier + audit slice

packages/providers (direct adapters)
  → minimal HTTP, caches, runProviderCycle

apps/cli (orchestration)
  → resolve work join, inventory, Wyzie late path, timing aggregator
```

### 2. `ProviderFetchPort` extension (future, one place)

Today (`packages/providers/src/runtime/fetch.ts`):

```ts
context.fetch?.fetch(input, init) ?? fetch(input, init)
```

**Right evolution:** register a single optional impersonation fetch at container init:

- `direct-http` (default Bun fetch)
- `browser-profile` (curl-impersonate / similar) — **only** when classified `blocked` + policy allows

Providers stay dumb; container chooses port from health/diagnostics.

### 3. Miruro key policy (smart, minimal)

```text
1. Try in-memory cached key (session) → hardcoded bootstrap
2. pipeCall → decode
3. On garbage + HTTP 200 → fetch homepage/_next chunks for VITE_PIPE_OBF_KEY only
4. Retry once with new key; cache 24h
5. Still fail → network-error / blocked (health skip), NOT Playwright
```

Cost: 0 ms on success path; +1–2 HTTP only on rotation events.

### 4. WAF strategy matrix

| Symptom | First action | Not this |
|---------|--------------|----------|
| HTTP 403 on HTML only | Call API origin directly (pipe, GraphQL) | Playwright |
| ECONNRESET / TLS reset | Retry + health degrade; document environment | Disable TLS verify |
| 403 on API with plain fetch | Impersonation fetch port | Browser for whole resolve |
| Decode garbage | Key rotation extractor | Assume site dead |

### 5. Evidence artifacts (required before production change)

For each probe:

- `probe-evidence-report.json` — statuses, decode outcome, counts, no raw stream URLs
- Update `.plans/provider-capability-latency-audit.md` slice
- Add or extend fixture under `packages/providers/test/fixtures/`
- Dossier “Known / Suspected / Unknown” row

Scripts to run:

```sh
bun scratchpads/provider-miruro/probe-evidence-2026.ts
bun scratchpads/provider-miruro/probe-key-extraction.ts   # when homepage stable
```

---

## Priority order (effect vs effort)

1. **Preserve zero-cost facts** (Miruro intro/outro in metadata) — audit slice A
2. **Trim VidKing retry/variant fan-out** — slice B
3. **Rivestream services TTL** — slice C
4. **Miruro key fallback extractor** — only after fixture for “rotated key” failure mode
5. **ProviderFetchPort impersonation** — shared infra, not per-provider
6. **Cineby flavor promotion** — after per-flavor live matrix in lab
7. **Playwright** — only `runtime-browser` package, optional, never default

---

## Cineby / VidKing lab

`scratchpads/provider-cineby/` is for **flavor discovery** (extra Videasy servers, language query params). Production Cineby module is research-only. Inherit VidKing engine fixes; do not maintain a separate decrypt stack.

---

## Related docs

- `.plans/provider-capability-latency-audit.md` — integrated audit
- `.docs/provider-intake.md` — dossier-first workflow
- `apps/experiments/README.md` — how to run probes
