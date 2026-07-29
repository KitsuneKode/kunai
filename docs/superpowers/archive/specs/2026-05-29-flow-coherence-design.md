# Design — Flow Coherence & User Control (Plan C)

Date: 2026-05-29
Status: approved (brainstorm), pending implementation plan
Roadmap: `docs/superpowers/plans/2026-05-29-premium-experience-roadmap.md`

Plan C of the premium-experience roadmap. Goal: **no permutation of media kind ×
entry point may dead-end, mislabel, or trap the user**, and the user can always
override any engine decision. Renderer-independent (runs parallel to Plan R).
Consumes Plan 1's continuation engine for resume decisions. Code is source of truth.

## 1. Problem (verified)

- **Movie misclassified as series.** Live: "Transformers: Revenge of the Fallen"
  renders `series · S01E01`, autoplay on, no continue. Root cause: two conflated
  "type" concepts —
  - `ContentType = "movie" | "series"` (content truth; on `TitleInfo`, history).
  - `ShellMode = "series" | "anime"` (provider routing only).
    `applyHistorySelectionProvider` (`launch-entry.ts:138`) and the session flow only
    ever `SET_MODE` to `series | anime`, and the Now-Playing header reads **mode**, so
    a movie on a general provider (vidking) → `mode:"series"` → `series · S01E01`.
    `session-flow.ts:305,403` hardcode `type:"series"`; `:64,231,249,309,408` default
    `season/episode` to 1. Yet `episodeFromHistorySelection` (`launch-entry.ts:56`) and
    `selectLocalContinueCandidate` (`:72`) _do_ branch on movie — an inconsistent
    half-fix that is the "scattered" feeling.
- **No single "play this" entry.** Playing from search / history / continue /
  recommendation / trending / queue / offline each takes a different path, so
  "play the next recommended movie" has no easy route and behaviors diverge.
- **Engine decisions are a trap.** Auto-picked provider/stream/quality/audio/subtitle
  can be wrong, and the override pickers exist but are scattered
  (`tracks-panel-shell.tsx`, `source-quality.ts`, `subtitle-selection.ts`) and not
  consistently reachable. A bad **cached** resolve keeps coming back;
  `invalidateEpisodePlaybackCaches()` exists (`playback-source-cache-invalidation.ts`)
  but is not a user-facing control.

## 2. Decisions (locked during brainstorm)

1. **Decouple mediaKind from mode.** `mediaKind: "movie" | "series" | "anime"` is the
   single content truth carried on session state, `TitleInfo`, and `PlayableRef`.
   `ShellMode` stays provider-routing only. All labels, S·E display, autoplay gating,
   and continue/resume branch on `mediaKind`, never on `mode`.
2. **Plan C owns `PlayableRef` + one `play(ref)` entry.** Plan 3 later adopts the same
   `PlayableRef` across queue/playlist/download storage + Up Next.
3. **The permutation matrix is the acceptance contract**, encoded as unit tests on a
   pure `buildPlayIntent`.
4. **Every auto-decision is a user-overridable default** (Pillar 5), reachable at
   resolve-time and mid-playback, including a per-episode cache escape hatch.

## 3. The five pillars

### Pillar 1 — `mediaKind` as content truth, decoupled from mode

- Add `mediaKind` to session state (alongside `mode`), `TitleInfo`, and `PlayableRef`.
  Source it at intake: TMDB `SearchResult.type`, anime provider ⇒ `anime`, history
  `mediaKind`. Never re-derive from `mode`.
- `ShellMode` keeps values `series | anime` but is treated strictly as
  **provider category** (anime providers vs general). UI must not read it for content
  labeling.
- Consumers to switch from `mode`/`type` to `mediaKind`:
  - Now-Playing header (the `series · S01E01` line) → movie shows title only, no S·E,
    no `series` tag; series/anime show `S·E`.
  - Autoplay gate → eligible when `mediaKind !== "movie"` (series **and** anime).
  - Continue/resume → movies resume the single history row (no episode); offered in
    the continue menu (not gated to series).

### Pillar 2 — `PlayableRef` + one `play()` entry

```ts
type PlayableSource =
  | "search"
  | "history"
  | "continue"
  | "recommendation"
  | "trending"
  | "queue"
  | "offline"
  | "calendar";

type PlayableRef = {
  titleId: string;
  mediaKind: "movie" | "series" | "anime";
  title: string;
  season?: number; // series/anime only
  episode?: number; // series/anime only
  absoluteEpisode?: number;
  externalIds?: ProviderExternalIds;
  providerHint?: string; // preferred provider id
  resumeSeconds?: number; // when continuing
  source: PlayableSource;
};
```

A pure `buildPlayIntent(ref, context)` derives:

- `mode` = `ref.mediaKind === "anime" ? "anime" : "series"` (ShellMode keeps its two
  values; the non-anime value `"series"` means the general-provider category and is
  used for both movies and series — it is provider routing, never a content label).
- content `mediaKind` = `ref.mediaKind`.
- episode = present for series/anime, **absent** for movie.
- resume vs fresh (from `resumeSeconds` / Plan 1 continuation).
- `autoplayEligible` = `ref.mediaKind !== "movie"`.

Every surface calls one thin `play(ref)` that builds the intent and hands off to the
existing playback pipeline. No surface special-cases launch.

### Pillar 3 — Permutation matrix (acceptance = tests)

A table `mediaKind × entrypoint` → expected `{label, episode, autoplay, continue,
resume, postPlay}`, encoded as unit tests on `buildPlayIntent`. Examples:

| mediaKind | entrypoint     | label      | episode        | autoplay | resume         | post-play                  |
| --------- | -------------- | ---------- | -------------- | -------- | -------------- | -------------------------- |
| movie     | recommendation | title only | none           | off      | saved position | recs + back (no "next ep") |
| movie     | continue       | title only | none           | off      | saved position | recs + back                |
| series    | continue       | `S·E`      | resume ep      | on       | saved position | next ep / recs             |
| series    | recommendation | `S·E`      | E1 (or resume) | on       | none/saved     | next ep                    |
| anime     | queue          | `E` (abs)  | queued ep      | on       | saved          | next ep                    |
| anime     | trending       | `E`        | E1             | on       | none           | next ep                    |

Every cell must be green; no cell may dead-end or mislabel.

### Pillar 4 — No-dead-end post-play

Every playback end resolves to a post-play surface with at least one clear forward
action: series/anime → next episode (when available) else recommendations;
movie → recommendations + back. Never a blank or a state that strands the user.
(Builds on existing post-play; this is the guarantee + the movie branch.)

### Pillar 5 — Override & escape hatches

Principle: auto-picks are defaults the user can always override.

- **Consolidated "Source control" overlay**, reachable via a consistent hotkey at
  resolve-time and mid-playback, exposing the full provider-resolved inventory:
  - **Provider** — switch/cycle (engine supports `fallback-provider`).
  - **Stream / quality** — all playable variants (`source-quality.ts` enumerates).
  - **Audio (sub/dub/language)** — soft multi-audio ⇒ instant mpv `aid` switch;
    sub-vs-dub (different stream) ⇒ re-resolve with the chosen `audioPreference`.
  - **Subtitle track** — full `subtitleList` + off (`selectSubtitle` exists).
- **Per-episode cache escape hatch** — wire `invalidateEpisodePlaybackCaches()` to a
  user command: "refresh this episode" (drop resolve + inventory cache, re-resolve
  fresh) and a "forget this title's cache" granularity. Breaks the
  stale-result-loops-back failure.
- The matrix (Pillar 3) gains an override axis: from any state the user can re-pick;
  it must not dead-end or silently revert to the engine pick.

## 4. Architecture

- New: `PlayableRef` type + pure `buildPlayIntent` (testable, no IO) in
  `domain/playback` (or `app/`), reused by all surfaces.
- New/extended: a `play(ref)` orchestration entry that all surfaces call.
- Session state gains `mediaKind`; reducers set it from intake, not from mode.
- Consolidated Source-control overlay reuses existing pickers
  (`tracks-panel-shell`, `source-quality`, `subtitle-selection`, provider switch).
- Cache escape hatch wires existing `invalidateEpisodePlaybackCaches()`.

## 5. Phasing

- **C1 (additive):** `PlayableRef` + pure `buildPlayIntent` + `mediaKind` on session
  state/`TitleInfo` + the full permutation-matrix tests. No behavior change; green.
- **C2:** route `play(ref)` through `buildPlayIntent`; switch header/labels/autoplay/
  continue to read `mediaKind`; migrate surface call sites onto `play(ref)`; fix the
  movie misclassification at intake.
- **C3:** consolidated Source-control overlay + per-episode cache escape hatch wired
  to a hotkey; live-verify the full matrix (flow/input = high regression risk).

## 6. Testing

- Pure `buildPlayIntent` unit tests = the entire permutation matrix (Pillar 3),
  including override transitions (Pillar 5).
- `mediaKind` intake mapping tests (TMDB movie/tv, anime provider, history).
- Regression guard: a movie from any entrypoint never yields an S·E label, never
  enables autoplay, and is offered continue/resume from its single history row.
- Live verification of C2/C3 (header, autoplay, source-control overlay, cache refresh).

## 7. Out of scope

- Unifying queue/playlist/download **storage** identity + Up Next merge → **Plan 3**
  (Plan 3 adopts this `PlayableRef`).
- Release/airing correctness → **Plan 2**.
- Poster/visual pixel polish of the overlay/surfaces → **Plan S**.
- Richer in-playback live-switch UX polish → **Plan F** (Plan C provides the contract
  - consolidated overlay; mechanics reuse `PlayerControlService`/mpv IPC).
- Alt-screen/flicker/resize → **Plan R**.

## 8. Edge cases

- Anime titles carry `type:"series"` historically but `mediaKind:"anime"`; autoplay
  stays enabled (gate is `!== "movie"`, not `=== "series"`).
- Movie with stale `S01E01` history rows (written by the current bug): resume keys on
  the single title row regardless of stored season/episode; no migration required.
- `absoluteEpisode`-only anime: `buildPlayIntent` uses `episode ?? absoluteEpisode`.
- Sub/dub switch mid-playback requires a re-resolve (different stream) — surfaced as a
  brief "re-resolving in <lang>" rather than a silent no-op.
