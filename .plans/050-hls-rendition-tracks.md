# Plan 050: Surface HLS `#EXT-X-MEDIA` renditions as audio/subtitle inventory

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- packages/providers/src/shared/hls-ladder.ts packages/providers/src/shared/hls-manifest.ts packages/types/src/index.ts`
> Mismatch → re-read the parser before proceeding. Note: `PlaybackPhase.ts` and provider `direct.ts` files are contended by open PRs (#400, #399, #390) — if the callers changed shape, adapt the *wiring* steps, not the parser.

Closes #189.

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED — the parser is shared by five callers; wrong rendition rows pollute the quality picker and Tracks panel
- **Depends on:** none required. Sequence note from the issue still applies: `PlaybackPhase.ts` is contended — this plan deliberately does **not** touch it; surfacing happens through the existing `variants`/`subtitles` result fields.
- **Category:** enhancement / inventory correctness
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

The shared HLS parser reads `#EXT-X-STREAM-INF` only. `#EXT-X-MEDIA` has zero
occurrences in source (`hls-ladder.ts:87` is the only tag branch), so
`TYPE=AUDIO` and `TYPE=SUBTITLES` renditions inside a master playlist are
invisible. Providers that carry tracks inside the manifest (Miruro, Videasy
Yoru) report `subtitles: 0` and no audio modes; the pre-launch Tracks panel
cannot show what is actually available, and mpv discovers the tracks only
after playback starts.

Scope precision (from the issue, verified): this is **inventory, not
availability** — external subtitle lookup is gated on hard-sub satisfaction
(`shouldSkipExternalSubtitleLookup`, `app/playback/source-quality.ts:96`),
never on subtitle count. Do not "fix" that gate.

## Current state

`packages/providers/src/shared/hls-ladder.ts`:

```ts
// :87-96 — the only parsed tag is STREAM-INF; everything else starting with
// "#" is skipped, which is where EXT-X-MEDIA renditions die.
if (line.startsWith("#EXT-X-STREAM-INF:")) { ... continue; }
if (!line || line.startsWith("#")) continue;
```

`expandHlsMasterPlaylist` (:29) returns `readonly HlsLadderVariant[]` — a
flat variant list. Callers:

- `hianime/client.ts:461`, `anidb/client.ts:661`, `allmanga/api-client.ts:1500`,
  `utils/m3u8-parser.ts:16`, `miruro/direct.ts:886`

Downstream fields that already exist and consume this data — nothing new is
needed below the provider boundary:

- `ProviderVariantCandidate.audioLanguages` (`packages/types/src/index.ts:241`)
  and `StreamCandidate.audioLanguages` (:319)
- `result.subtitles: readonly SubtitleCandidate[]` (:342) — has
  `language`, `label`, `format`, `source: "provider" | "wyzie" | "manual" | "embedded" | "unknown"`, `variantId?`
- `PlaybackSourceInventoryProjection.ts:214-215,267-270` already projects
  `audioLanguages` into the inventory view; `ResolveWorkLedger.ts:249-264`
  already counts them.

`HlsLadderVariant` today: `{ url, qualityLabel, qualityRank, bandwidth? }`.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Provider tests | `bun run --cwd packages/providers test` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |
| Lint/fmt | `bun run lint --force && bun run fmt` | exit 0 |

## Scope

**In scope:**
- `packages/providers/src/shared/hls-ladder.ts` — parse `#EXT-X-MEDIA`
- `packages/providers/src/shared/hls-ladder.test.ts` or `packages/providers/test/` — new tests (find the existing hls-ladder test file first)
- One caller migration to prove the data lands end-to-end: `miruro/direct.ts` (it already calls `expandHlsMasterPlaylist` at :886 and swallows expansion failures — see below)
- `.docs/playback-source-inventory-contract.md` — document the rendition fields (docs land with the change)
- `.changeset/` — user-facing (picker now shows real tracks): `bunx changeset`, patch `@kitsunekode/kunai`

**Out of scope:**
- `PlaybackPhase.ts` — contended (#400); inventory projection already picks the fields up.
- Videasy/Rivestream master-expansion adoption — Rivestream's variant handling is owned by open PR #387; Videasy's expansion is a separate call. Do not add ladder calls to providers that don't have one.
- Fetching rendition sub-playlists or subtitle bodies — this plan reads the master manifest only.
- `shouldSkipExternalSubtitleLookup` — unchanged (see Scope precision).

## Steps

### Step 1: Extend the parser

Extend `parseHlsMasterVariants` (or a sibling `parseHlsMasterRenditions`) to
collect `#EXT-X-MEDIA:` rows. Parse per the RFC: `TYPE` (`AUDIO` | `SUBTITLES` |
`CLOSED-CAPTIONS` | `VIDEO`), `GROUP-ID`, `NAME`, `LANGUAGE`, `URI` (optional —
absent means muxed), `DEFAULT`, `FORCED`, `CHARACTERISTICS` (captures SDH via
`public.accessibility.describes-music-and-sound` / hard-of-hearing tags).

Also read each `#EXT-X-STREAM-INF` row's `AUDIO="…"` / `SUBTITLES="…"` /
`CLOSED-CAPTIONS="…"` group references so a variant knows which rendition
groups it carries.

Return shape: keep `expandHlsMasterPlaylist`'s `HlsLadderVariant[]` contract —
add an optional sibling export, e.g. `expandHlsMasterPlaylistWithRenditions`
returning `{ variants, renditions }`, rather than breaking every caller.
`HlsLadderVariant` gains optional `audioGroupId?`, `subtitleGroupId?`.

Language normalization: reuse the provider-side language tables (there is a
language normalization util — find it via `normalizeLanguage`/`LANGUAGE_` in
`packages/providers/src/shared/`; use it, do not invent a second table).

**Verify:** `bun run --cwd packages/providers test` → all pass (pure addition).

### Step 2: Unit-test the parser with real-world fixtures

Fixture masters covering: TYPE=AUDIO renditions with LANGUAGE; TYPE=SUBTITLES
with URI; `CLOSED-CAPTIONS=NONE`; rendition without URI (muxed); relative URI
resolution against the master URL; a variant referencing `AUDIO="grp"` that
exists and one referencing a missing group. Model after the existing
hls-ladder/parser tests in `packages/providers/test/`.

**Verify:** new tests pass; `bun run --cwd packages/providers test`.

### Step 3: Wire Miruro to prove the field lands

In `miruro/direct.ts` around :886, switch to the renditions-aware expand and
map the results onto the provider result:

- `TYPE=AUDIO` renditions → merge each `LANGUAGE` into the carrying variants'
  `audioLanguages` (via the variant's `audioGroupId`).
- `TYPE=SUBTITLES` with a `URI` → `SubtitleCandidate` rows with
  `source: "provider"` (they're provider-manifest tracks), `format` from the
  URI extension (`.vtt`/`.srt` — there's a format-from-URL helper in the
  subtitle normalization utils; reuse it), `language`, and `variantId` of the
  carrying variant when resolvable.
- Renditions without `URI` (muxed audio) → `audioLanguages` only; no
  `SubtitleCandidate` for muxed content.
- Keep the existing fallback: expansion failure still yields the single
  `auto` variant — but emit a trace event on failure (the issue notes Miruro
  swallows expansion failures with no trace; the `emitTraceEvent` helper is
  already imported there).

**Verify:** `bun run --cwd packages/providers test` → all pass; new Miruro test
asserts a master with EXT-X-MEDIA yields non-empty `subtitles` and
`audioLanguages` on variants.

### Step 4: Docs + changeset

- `.docs/playback-source-inventory-contract.md`: document that providers may
  populate `audioLanguages`/`subtitles` from EXT-X-MEDIA renditions and the
  `source: "provider"` convention.
- `bunx changeset` (patch). `bun run guard`.

## Test plan

- Parser unit tests per Step 2 (in `packages/providers/test/` or the co-located test file — match existing layout).
- Miruro-level test: fixture master → result carries audio languages + subtitle candidates.
- A regression: master with `CLOSED-CAPTIONS=NONE` and no EXT-X-MEDIA produces identical output to today's parser.

## Done criteria

- [ ] `#EXT-X-MEDIA` appears in `hls-ladder.ts` and parses TYPE/GROUP-ID/NAME/LANGUAGE/URI/DEFAULT/FORCED/CHARACTERISTICS
- [ ] Variants can carry `audioGroupId`/`subtitleGroupId`; Miruro's result surfaces audio languages + provider subtitle candidates
- [ ] Zero changes to `PlaybackPhase.ts`
- [ ] `bun run test --force`, `bun run typecheck --force`, `bun run lint --force` all exit 0
- [ ] Changeset + `.docs/playback-source-inventory-contract.md` updated

## STOP conditions

- A merged PR already added EXT-X-MEDIA parsing (check `git log -S EXT-X-MEDIA` first).
- The Tracks panel consumes a *different* field than `audioLanguages`/`subtitles` — if the picker still shows nothing after Step 3 with correct provider output, the consumption seam is elsewhere; report before patching UI.
- Miruro's expansion call site moved/changed signature on a merged PR — adapt wiring only.

## Maintenance notes

- Once merged, Videasy-Yoru and other HLS providers get the same surfacing by switching their expand call — the parser is the shared asset.
- Do not persist rendition-derived subtitle URLs into the source-inventory DB without checking their token lifetimes — signed CDN URLs rot; the issue's "manifest tracks" are safer than episode-level signed links but verify expiry behavior in review.
