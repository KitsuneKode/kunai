# Provider Source Inventory & Track-Panel Coherence — Research & Enhancement Plan

Status: implemented (2026-07-16)

Implementation outcome:

- discovered sources retain live order and evidence; undiscovered catalog rows append as
  explicit fresh-resolve placeholders;
- Miruro catalog rows are gated by confirmed audio modes and use hard-sub wording for sub;
- RiveStream source labels include inferred audio tags;
- Videasy and VidLink catalog copy uses consistent user-facing language;
- Miruro transport failures remain hermetic while HTTP Cloudflare responses retain the
  production curl fallback.

Verification completed with the full format, typecheck, lint, test, and build gates plus
live Videasy, RiveStream, and Miruro runtime smokes.

## Goal

Make every provider's source toggle list correct, well-ordered, and consistently worded
in the Tracks panel — especially: (a) all real sources show up, (b) no phantom rows,
(c) hard-sub / soft-sub / audio-language wording is uniform, (d) the source label itself
is usable at a glance.

## Pipeline (what we change and where it lands)

`provider.resolve()` → `result.sources` →
`buildSourceCandidates()` (apps/cli/src/services/playback/PlaybackSourceInventoryProjection.ts:337)
→ `mergeKnownCatalogForResult` (packages/providers/src/shared/known-catalog.ts)
→ `projectSourceGroups` → `buildTrackCapabilities` (apps/cli/src/domain/playback/track-capabilities.ts)
→ Tracks panel rows.

`mergeKnownCatalogSources` was already fixed (discovered sources win, catalog only appends
known-but-undiscovered placeholders). This plan builds on that.

---

## Per-Provider Findings

### AllManga (packages/providers/src/allmanga, catalogs/allmanga.ts)

- Catalog `KNOWN_SOURCE_KEYS` (catalogs/allmanga.ts:24) = 7 families. Real API can return
  more (e.g. `Luf-Mp4`, `S-mp4`, `Yt-mp4`, `Default`, `Fm-mp4`; KNOWN_SOURCES api-client.ts:176).
- Discovered sources now win (prior fix). Remaining issue: catalog placeholder labels use
  Bocchi-theme flavor wording (`Sub · Default · hard sub`) that diverges from the resolved
  family wording produced by `formatAnimeSourceLabel` (direct.ts:344). The row label and the
  `flavorArchetype` detail tell two different stories.
- Best fix: catalog rows should be produced by the SAME `formatAnimeSourceLabel` path as the
  resolved rows, and the Bocchi theme should live only in `flavorArchetype` detail — not the
  label. Remove the parallel theme table driving `label`.

### Miruro (packages/providers/src/miruro, catalogs/miruro.ts) — HIGHEST PRIORITY

- `getMiruroKnownCatalog` (catalogs/miruro.ts:31) unconditionally emits **sub AND dub rows
  for every server** (7 servers × 2 = 14 rows).
- Resolve only produces the rows the live data can serve. Servers without a dub episode /
  dub HLS produce NO dub source, but the catalog still injects a `status:"skipped"` phantom
  `Dub · <Server> · subtitles unknown` row (confirmed via known-catalog.ts placeholder path).
- Net: the picker is cluttered with phantom dub (or sub) rows that can never play.
- Wording: catalog hardcodes `subtitleMode:"unknown"` → `subtitles unknown` for every row
  (catalogs/miruro.ts:43,51-66), diverging from resolved `hard sub` / `soft sub`.
- Fix:
  1. Catalog must only emit the audio category(ies) actually available. Pass the resolved
     audio mode(s) (or, simpler, only emit rows for categories present in the live episode
     data) — i.e. gate dub rows on `availableEpisodes`/`dub` presence.
  2. Align catalog `subtitleMode` to the resolved default (`sub`→hard, dub-with-subs→soft)
     instead of always `unknown`.

### Videasy (packages/providers/src/videasy, catalogs/videasy.ts) — wording

- Source label = `themeLabel` (Cineby names: Yoru/Neon/...) — good, no change needed.
- `flavorArchetype` (the free-text `subtitle` field) is ad-hoc and inconsistent across
  flavors.ts:88-378: `"Original audio"`, `"Original audio · may have 4K"`, `"German audio"`,
  `"Quality ladder · Kunai-only (not on cineby UI)"`, `"Legacy · route-dead"`, `"Alias → Yoru"`.
  These land directly in UI `hints` (PlaybackSourceInventoryProjection.ts:288).
- Audio language is NOT in the label; only as free-text archetype + stream `audioLanguages`.
- Fix: normalize the `subtitle`/`flavorArchetype` copy into a consistent vocabulary, e.g.
  `Original · <LANG>` for non-English, `Original audio` for English, plus a separate
  `qualityHint`/`note` field for "may have 4K" / "Kunai-only". Keep theme name in `label`
  and `flavorLabel` only.

### RiveStream (packages/providers/src/rivestream, catalogs/rivestream.ts)

- Source LABEL = `normalizeProviderDisplayLabel(provider)` only (rivestream/direct.ts:841) →
  `Flowcast`, `Asiacloud`. The audio language IS inferred (inferRivestreamAudioLanguage
  direct.ts:854) and IS present on the stream (`audioLanguages`, direct.ts:772) and on
  source `languageEvidence` (direct.ts:602) — so the UI `serverAudioBadge` (track-capabilities.ts:166)
  does fire for Hindi/English. BUT the label itself doesn't show language, so two servers of
  different languages look identical in the list.
- Catalog `subtitle: "English · ${serviceId}"` (catalogs/rivestream.ts:42) is the only
  language-aware copy and is discarded on resolve (selected label is bare, direct.ts:472).
- Ordering follows the live API service list — reasonable, no change.
- Fix: fold the inferred audio language into the source `label`/`flavorLabel` so e.g.
  `Flowcast · EN` / `HindiCast · HI`. Reuse `serverAudioBadge` output or a small
  `langCodeFromAudio` helper.

### VidLink (packages/providers/src/vidlink, catalogs/vidlink.ts) — copy cleanup

- Single source, label `VidLink`, host `vidlink.pro`. No per-quality/per-language breakdown.
- Catalog `subtitle: "English · direct-http"` (catalogs/vidlink.ts:9) is meaningless user copy.
- Fix: drop the misleading `subtitle`; let the projection derive a clean detail (e.g. host +
  protocol) or leave it empty.

---

## Cross-Provider UI Wording (apps/cli/src/domain/playback/track-capabilities.ts)

- `SECTION_TITLES` already has `Subtitles` + `Hardsub` (lines 45-52). For anime the section
  order is `audio → source → quality → hardsub → subtitle` (lines 63-70).
- Hardsub rows carry only the language code as `label` (e.g. `en`) with no "Hardsub" qualifier,
  while the section header already says "Hardsub" — acceptable, but for clarity the row could
  read `<LANG> hardsub`. Low priority.
- Non-anime providers (Videasy/VidLink/RiveStream for movies) should never surface a Hardsub
  section; confirm `option.role === "hardsub"` only appears for anime `sub` hardcoded evidence
  (it does — AllManga/Miruro set `role:"hardsub"`, others don't).

## Recommended Implementation Order

1. Miruro phantom dub rows (biggest clutter win) + catalog subtitleMode alignment.
2. RiveStream language in source label.
3. AllManga catalog label alignment with resolved `formatAnimeSourceLabel`.
4. Videasy `flavorArchetype` wording normalization.
5. VidLink catalog copy cleanup.

## Verification

- `bun run typecheck && bun run lint`
- Live resolve each provider and inspect `projectPlaybackSourceInventory(...).sourceGroups`:
  every row must be a real, playable source; no `skipped` phantom rows for unavailable audio
  categories; labels show family + (where relevant) audio language; subtitle wording uniform
  (`hard sub` / `soft sub` / `subtitles unknown`).
