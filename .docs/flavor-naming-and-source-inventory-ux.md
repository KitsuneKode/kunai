# Flavor naming & source inventory UX

Status: **implemented** (2026-05-27). Registry: `packages/providers/src/videasy/flavors.ts`. UI reads `source.label` + `metadata.flavorArchetype` from resolve results (no shell-side endpoint mapping).

**Visual mockup:** open [`.design/cli/sources-overlay-mockup.html`](../.design/cli/sources-overlay-mockup.html) in a browser (ASCII + styled Sources panel, Phase A/B timeline).

**Title health / cache reset:** [`.docs/title-provider-health-and-cache-reset.md`](./title-provider-health-and-cache-reset.md).

---

## 1. Terminology: Source vs Server

| Term       | Pros                                                                                                                                                             | Cons                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Source** | Matches code (`sourceId`, `SourceInventoryService`, `PlaybackSourceGroupView`); works for anime (Miruro pipe) and movies (Videasy); not tied to Cineby trademark | Slightly abstract for new users                                        |
| **Server** | Matches Cineby/VidKing UI (“Servers” tab); familiar to site users                                                                                                | Implies physical server; wrong for AllManga link names / Miruro “pipe” |
| **Mirror** | Good for Videasy duplicates                                                                                                                                      | Bad for language tracks (German dub is not a “mirror”)                 |

**Recommendation:** Use **Source** in Kunai UI and docs.

- Command bar / overlay: **“Sources”** (plural).
- Single item: **“Source: Luffy”** with subtitle `English · mb-flix`.
- Advanced/diagnostics: show native endpoint `api.videasy.net/cdn/...`.
- Optional user setting: display alias **“Servers (sources)”** for Cineby migrants — not default.

**Hierarchy (consistent copy):**

```text
Provider  →  Source (flavor)  →  Quality (stream)
VidKing      Luffy               1080p
```

---

## 2. Themed flavor names (display only)

Flavor **IDs** stay stable (`videasy-primary`, `miruro-kiwi-sub`, …). **Labels** are themed per provider.  
**Subtitle** always includes **language + role** where relevant.

### 2.1 Videasy / Cineby (One Piece)

| Flavor ID             | UI name (One Piece) | Subtitle              | Endpoint            | Why this character                       |
| --------------------- | ------------------- | --------------------- | ------------------- | ---------------------------------------- |
| `videasy-primary`     | **Luffy**           | English · primary     | `mb-flix`           | Default captain / first pick             |
| `videasy-mirror-a`    | **Zoro**            | English · may have 4K | `cdn`               | Reliable #2, alternate path              |
| `videasy-mirror-b`    | **Nami**            | English · mirror      | `downloader2`       | “Navigator” — finds another route        |
| `videasy-mirror-c`    | **Sanji**           | English · mirror      | `1movies`           | Alternate kitchen / backup               |
| `videasy-breach`      | **Blackbeard**      | English · mirror      | `m4uhd`             | BitCine Breach bundle mapping            |
| `videasy-english-alt` | **Robin**           | English · alt track   | `hdmovie` + English | Scholar / alternate English stream       |
| `videasy-german`      | **Brook**           | German · dub          | `meine` + german    | Skeleton musician; German joke fit       |
| `videasy-italian`     | **Shanks**          | Italian · dub         | `meine` + italian   | Major character; EU / worldwide dub slot |
| `videasy-french`      | **Law**             | French · dub · movies | `meine` + french    | Corazon arc / EU dub slot                |
| `videasy-hindi`       | **Chopper**         | Hindi · dub           | `hdmovie` + Hindi   | Doctor / regional care metaphor          |
| `videasy-spanish`     | **Ace**             | Spanish · dub         | `lamovie`           | Fire — Latin heat stretch                |
| `videasy-portuguese`  | **Sabo**            | Portuguese · dub      | `superflix`         | Brotherhood / BR community nod           |

**Order in UI:** Luffy first, then Zoro → Nami → Sanji → Blackbeard (English mirrors), then language row grouped by language name.

**Cineby alias (diagnostics only):** `Also: Neon` on Luffy, etc.

---

### 2.2 Rivestream (Naruto)

Services are **dynamic** (`VideoProviderServices` list). Assign characters **in stable sorted order** so UI does not shuffle between sessions.

| Order | UI name                                                 | Subtitle template                 |
| ----- | ------------------------------------------------------- | --------------------------------- |
| 1     | **Naruto**                                              | English · default service         |
| 2     | **Sasuke**                                              | English · alternate               |
| 3     | **Sakura**                                              | Alternate                         |
| 4     | **Kakashi**                                             | Alternate                         |
| 5     | **Hinata**                                              | Alternate                         |
| 6     | **Shikamaru**                                           | Alternate                         |
| 7     | **Gaara**                                               | Alternate                         |
| 8     | **Rock Lee**                                            | Alternate                         |
| 9+    | **Neji**, **Guy**, **Jiraiya**, **Itachi**, **Pain**, … | Fill from roster as services grow |

**Mapping rule:** `character = NARUTO_ROSTER[hash(serviceId) % roster.length]` with collision skip, or simple index order on first catalog fetch. Persist mapping in source inventory cache for the title session.

**Native label** in diagnostics: `service=flowcast` (or whatever API returns).

---

### 2.3 AllManga / AllAnime (Bocchi the Rock)

Source names come from **API** (`sourceName` strings). Two approaches:

**A (recommended):** Map known `sourceName` patterns → fixed character; unknown → **Kikuri** + native name in subtitle.

| Pattern / lane       | UI name    | Subtitle              |
| -------------------- | ---------- | --------------------- |
| Default / first link | **Bocchi** | Sub · primary         |
| Second link          | **Kita**   | Sub · alternate       |
| Third link           | **Ryo**    | Sub · alternate       |
| `ak-only` lane       | **Hitori** | Sub · fallback lane   |
| Dub if present       | **Nijika** | Dub                   |
| Unknown              | **Kikuri** | `{native sourceName}` |

**B:** Sort links by quality; assign roster index 0..n.

Always show **language** on subtitle when known from link metadata.

---

### 2.4 Miruro (Gintama) — hybrid labels

Primary Tracks/source **label** is the character name. Detail line is `Sub · hard sub` / `Dub · soft sub` (not the raw server key). Technical tokens (`Kiwi`, `Bee`) stay on `serverName` / diagnostics only.

| Server key   | Primary label                             | Detail (subtitle / sourceDetail)         | Notes                                               |
| ------------ | ----------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `kiwi` + sub | **Gintoki**                               | Sub · hard sub (soft when pipe has subs) | Default lazy-probe first for anime sub              |
| `kiwi` + dub | **Kagura**                                | Dub · …                                  |                                                     |
| `bee` + sub  | **Shinpachi**                             | Sub · …                                  |                                                     |
| `bee` + dub  | **Okita**                                 | Dub · …                                  |                                                     |
| `hop`        | **Hijikata**                              | Sub/dub · …                              |                                                     |
| `ZORO`       | **Mutsu**                                 | Sub/dub · …                              | Avoid “Zoro” primary — One Piece / Videasy conflict |
| Other keys   | **Takasugi**, **Kamui**, **Elizabeth**, … | From `MIRURO_THEME_DETAIL`               | One character per discovered key                    |

**Rule:** Never show raw `kiwi` / `bee` as the primary UI title — only Gintama names. Audio + subtitle mode live on the detail line.

**HLS:** Lone `master.m3u8` Pipe rows expand via shared `expandHlsMasterPlaylist` into ranked quality `StreamCandidate`s for the Tracks quality picker.
---

## 3. Playback behavior (resolve strategy)

Aligns with your “play first, cycle if needed, lazy fill rest” ask.

### Phase A — Blocking (must have stream for mpv)

```text
1. Pick default source (user preference or provider default: Luffy / Gintoki / Naruto / Bocchi).
2. Resolve ONLY that source with full timeout (60–90s Videasy).
3. If failed → try NEXT source in priority list (not all at once with short timeouts).
4. On success → start playback immediately.
```

**Priority list (Videasy):** Luffy → Zoro → Nami → Sanji (English mirrors only); language sources only if user preference or audio profile matches.

**Do not** run 8 parallel resolves in Phase A.

### Phase B — Lazy inventory (after playback started)

```text
1. When mpv reports playing (or first progress tick):
   - Enqueue background resolve for remaining sources (same episode, same provider).
2. Each probe: single attempt, shorter timeout (e.g. 25s), no engine-level triple retry.
3. Merge into SourceInventory + UI:
   - available → selectable
   - failed / not-found / timeout → failed state + glyph
   - skipped (movies-only on series) → disabled
4. User can switch source without full provider fallback (warm handoff).
```

**Cancellation:** Abort lazy jobs on episode change, provider change, or shell exit.

### Phase C — Failure display

Use existing `PlaybackInventoryOptionState`: `"failed"`.

| State       | UI                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `selected`  | Filled dot / highlight                                                                                |
| `available` | Normal row, selectable                                                                                |
| `failed`    | **Red ✕** (or `×` glyph) + muted row; subtitle = short reason (`timeout`, `not found`, `unavailable`) |
| `disabled`  | Grey; movies-only on TV episode, etc.                                                                 |
| `skipped`   | Not probed yet (lazy queue) → spinner or dim “…” until Phase B                                        |

**Hints** (already on `PlaybackSourceGroupView.hints`):  
`Failed after 62s` · `HTTP 500` · `No playable streams`

---

## 4. What to fix in backend (still required)

Themed names do not fix Videasy timeouts. Ship together:

| Priority | Item                                                        |
| -------- | ----------------------------------------------------------- |
| P0       | Videasy timeout 60–90s on Phase A                           |
| P0       | Phase A = ordered single-source try, not fanout             |
| P0       | Phase B = lazy probes with shorter timeout + no retry storm |
| P1       | Query parity (`year`, `imdbId`, `_t`)                       |
| P1       | Central flavor registry per provider (IDs + theme labels)   |
| P2       | Map **Blackbeard** (Breach) when harvested                  |

---

## 5. Implementation slices (updated)

1. **`packages/core` or `packages/providers`:** `flavor-registry.ts` — IDs, endpoints, theme label resolver per `providerId`.
2. **`vidking/direct.ts`:** `resolveFlavor(flavorId)`; ordered fallback list; export flavor list for UI.
3. **`PlaybackResolveWorkService`:** Phase A vs B scheduling; signal when playback started.
4. **`PlaybackSourceInventoryProjection`:** Map `failed` → red ✕; `skipped` → pending; theme labels on `PlaybackSourceGroupView.label`.
5. **Shell:** Sources overlay bound to inventory view; switch source triggers handoff not full re-resolve from scratch when cached.

---

## 6. Considerations checklist

**Legal / brand**

- Themed names are **internal UX**; do not claim affiliation with OP/Naruto/etc.
- Fine as parody-style codenames; avoid official logos in UI.

**i18n**

- Character names are proper nouns (keep Latin script).
- Subtitles carry **language** (`German · dub`) for accessibility.

**Stability**

- Flavor **IDs** never change; labels can get a `themeSeason2` tweak without breaking config.
- Rivestream/AllManga dynamic rows: store `serviceId → character` in session inventory.

**User preference**

- `preferredSourceId` = `videasy-primary` (Luffy), not “Neon”.
- Per-title override: “always Brook for this show” optional later.

**Audio profile**

- Auto-select Brook when `preferredAudioLanguage=de`; still show all sources in list with language subtitles.

**Diagnostics**

- Always log: `flavorId`, `nativeEndpoint`, `latencyMs`, `failureCode`.
- User-facing: “Source Luffy failed (timeout)” not “VidKing parse-failed”.

**Performance**

- Cap concurrent lazy probes (e.g. 2 at a time) to avoid melting Videasy.
- Respect health cooldown per endpoint after repeated failures.

**Conflicts**

- Miruro `ZORO` server key vs One Piece Zoro — display **Mutsu** or **Elizabeth** for Miruro ZORO row.

**Movies-only flavors**

- Law (French): `disabled` on series with reason `Movies only`.

---

## 7. Decisions for you

1. Confirm **Source** vs **Servers** as UI label?
2. Approve One Piece / Naruto / Bocchi / Gintama rosters above?
3. Phase A fallback depth: **3** English mirrors max before giving up / next provider?
4. Lazy probe: **all** flavors or only English + user’s audio language?
5. Red **✕** on failed row — OK in terminal (Unicode) vs ASCII `[x]`?
6. Implement flavor registry in `packages/providers` first, then shell — agree?

---

## 8. Success criteria

- User sees **Luffy** as default; playback starts without waiting for 10 probes.
- After ~5s of playback, other sources populate; failed show **✕** + reason.
- Switching Zoro → Brook uses inventory handoff when already probed.
- Diagnostics show flavor id + native endpoint for support.
