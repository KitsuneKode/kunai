# Sakura Canonical — Implementation Plan

Status: **active** · Branch: `design/sakura-rollout` (or a fresh `design/sakura-canonical`).
Design authority: [`.design/cli/kunai-sakura-canonical.html`](../.design/cli/kunai-sakura-canonical.html).
**Delegation board (multi-agent, copy-paste briefs):** [`.prototypes/visual-authority/execution-plan-v1.html`](../.prototypes/visual-authority/execution-plan-v1.html) — `bun run prototype:serve` → `/visual-authority/execution-plan-v1.html`.
Source-of-truth order unchanged: **runtime code > design-system.md > this plan > board HTML**.

## Wave 0 — DONE (2026-05-27)

- **F0** `apps/cli/src/domain/catalog/title-detail.ts`: `TitleDetail` + `ArtworkSet` + `CastMember`/`SeasonSummary` types and the pure, tested `mergeArtwork` best-of-provider policy (`ARTWORK_PREFERENCE`, `episodeThumbKey`). `titleDetail?: TitleDetail` wired into `PlaybackShellState`. 7 tests.
- **F1** `apps/cli/test/harness/render-capture.ts`: width-controlled frame capture (`CAPTURE_WIDTHS` 72/100/140) + `captureSurface` (writes `test/__captures__/<surface>.<width>.txt`) + deterministic `simulateTicks` flicker probe. Built on Ink's renderer with a width-configurable stdout; `ink-testing-library` is intentionally not used because it cannot cover Kunai's resize/stdin/flicker paths. Proof test + `capture-demo.tsx` template. Baseline post-play capture confirms the drift (wide == medium, no rail). 4 tests.
- Gate: typecheck clean, suite 1174 → **1185**, lint unaffected. No `ink-testing-library` dependency.
- **Next:** spin Wave 1 (ART, PP, NP, DET, BRZ) — some via me, some via the user's agents.

## Visibility findings (F1 sweep, 2026-05-27)

From `test/__captures__/post-play.*` across all states + widths:

- **PP rail concentric-border artifact (wide):** the right rail renders a heavy outer box with a _nested_ bordered poster tile (`│ ┌──┐ │`) and runs full-width with empty space on sparse states (caught-up). Fix: drop the inner poster border (or the outer rail border) so radii/borders are concentric, and size the rail to content. Owner: PP follow-up.
- **Narrow "widen terminal for recommendations"** reads as an error, not an affordance — replace with compact inline picks (workbench 2D pattern). Owner: PP follow-up.
- Systematic sweep TODO: capture every shell (browse, episodes, tracks, recovery, details, calendar, library, downloads, stats, settings, diagnostics, command palette, notifications) at 72/100/140 and triage — this is the "panel visibility" pass.

## Expanded scope (locked with user)

- **Metadata + artwork plumbing (ART):** populate every field exposed by **TMDB · AniList · TVDB/"easy DB" API** — release date, rating, genres, studio, year, runtime, seasons, synopsis, cast/voice-cast. **Best-of-provider artwork**: poster + **season posters + episode thumbnails**, highest-res-available with defined fallback. Feeds the new **Details sheet** and every rail.
- **Surfaces added to scope:** Details sheet, scoped Command palette, Onboarding/setup, Library + Downloads/Queue, Stats heatmap, Episodes thumbnails.
- **Render-capture harness (F1):** render each shell to text at 72/100/140 cols + re-render counter, so layout breaks and flicker are seen, not guessed. Foundational — agents validate their own output with it.
- **Flicker & stability sweep (X1):** memo + derive-in-render + reserve-space + fixed-width numbers + no-animation-on-keyboard + clear stale Kitty images (A6) + loader cadence (A7) + palette paging (B8/B9).
- **Antipattern refactor (X2):** no inline components, no effect-derived state, DRY shared primitives, one builder feeds body+footer, lazy heavy surfaces.
- **Later additions (Wave 2 cards SET/DIAG/FUZ + CMD bug):** Settings UI rebuilt as grouped **switch/segment rows** (new `primitives/Switch.tsx`, mint-on/muted-off, glyph+word); Diagnostics UI as calm grouped status sections (not a log dump); **fuzzy-match fix** (`domain/session/fuzzy-match.ts`) so palette/search hit the obvious target; and the **command-palette context bug** (opens wrong target / garbles layout) folded into CMD — scope correctly + hide companion while open.
- **Delegation model:** parallel agents, **disjoint file ownership**; I own `types.ts`/`ink-shell.tsx`/`PlaybackPhase.ts`/`shell-theme.ts` + wiring + verification. See board for the ownership matrix and per-task briefs.

## Why this plan exists

The Sakura token migration shipped, but several surfaces re-anchored to the
**pre-Sakura amber/teal workbook** (`playback-postplay/workbench-rec-v1.html`)
and adopted its _minimal_ shapes — losing the richness the real Sakura board
intended. Post-play regressed hardest (lost poster rail, metadata, structured
actions, rec cards). This plan re-anchors every core-loop surface to the new
canonical board, fixes state correctness, and makes footers/shortcuts relevant.

## Grounding facts (verified, do not re-derive)

- **Data available to post-play** (`PlaybackShellState`): `posterUrl`, `title`,
  `episodeLabel`, `nextEpisodeLabel`, `resumeLabel`, `totalEpisodes`,
  `watchedEpisodes`, `currentSeason`, recs with `title/year/overview/type/episodeCount/posterPath`.
- **Not available** (board over-promised — render only real data): release date,
  content rating, sub|dub flags, source/quality line, up-next "available" status, rec "reasons".
- **Already-wired post-play actions** (`PlaybackPhase.ts` ~2697–2940 via
  `routePlaybackShellAction`): `resume`, `replay`, `next`, `previous`,
  `next-season`, `pick-episode`, `source`/`quality`/`streams` (Tracks panel),
  `fallback`, `download`, `watchlist`, `quit`, `back-to-*`. → `e episodes` and
  `t tracks` from post-play are **safe, not dead keys**.
- **Footer dispatch**: `ShellFrame` binds `footerActions` keys in its own
  `useInput`; `onUnhandledInput` is separate. Adding `e`/`t`/`p` to
  `onUnhandledInput` will not collide as long as they are not also footer keys.
- **Known state bug**: `buildPostPlayFooterActions` season-finale branch shows
  "next season" even when `hasNextSeason === false`.
- Baseline gate green: typecheck 8/8, **1174 tests 0 fail**, lint clean.

## Discipline (every slice)

Color = state/focus only (type hue → Stats only). Semantic palette names only.
Footer ≤ 4 actions + `[/] commands`. Every surface owns loading/success/empty/error.
No dead keys. Reserve poster slot before load. Run `bun run typecheck && bun run lint && bun run test` per slice; commit each slice in its own scope.

---

## Slice A — Post-play rebuild (highest value, highest drift)

**Goal:** `post-play-shell.tsx` becomes the "episode page + remote": two-column
(info + poster rail on `wide`), per-state hero, structured action list, enriched
discovery. Pure presentation + one prop pass-through; **no backend plumbing**.

**Files**

- `apps/cli/src/app-shell/post-play-shell.tsx` (rebuild)
- `apps/cli/src/app-shell/ink-shell.tsx` (pass `posterUrl`; wire `e`/`t`/`p`; footer fixes)

**Changes**

1. Add `posterUrl?: string` prop; reuse `usePosterPreview({rows:12,cols:18,enabled,variant:"detail"})` exactly like `loading-shell.tsx`. Show rail only when `breakpoint === "wide" && posterUrl`. Reserve slot; never badge loading.
2. Two-column `flexDirection="row"`: left `flexGrow`, right `flexShrink={0} marginLeft={2}` (poster + context facts).
3. Shared `ActionRow` (marker `▌`/spaces · padded label · muted desc · key hint). One **primary** row per state (rose `▌` + bold).
4. Discovery: enriched list — rose-bold index · title · dim reason from `overview` snippet / `Series · year` / `episodeCount`. Keep `Divider` label. (Side-by-side bordered cards deferred — list is the robust terminal form.)
5. Rail context facts per state (up-next label, season `watched/total · %`, next broadcast).

**Per-state heroes + action lists** (see Slice C for footers)

| State                       | Hero                                      | Primary                                           | Action rows                        | Rail                        |
| --------------------------- | ----------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------------- |
| did-not-start               | `▢ playback didn't start` (accentDeep)    | retry (r)                                         | retry · search                     | none (calm, no poster)      |
| stopped-early (resumeLabel) | `⏸ stopped early` + progress bar          | ↵ resume                                          | resume · replay · episodes         | poster · resume-at          |
| mid-series                  | `✓ episode complete`                      | ↵/n next                                          | next ep · episodes · replay·tracks | poster · up-next · season % |
| caught-up                   | `◉ caught up` (mint)                      | w watchlist                                       | watchlist · calendar(c)            | poster · next broadcast     |
| season-finale               | `✦ Season N complete` (mint)              | next-season _(only if hasNextSeason)_ else replay | continue/replay · episodes         | poster · overall %          |
| series-complete             | `✦ SERIES COMPLETE` (**plum, only here**) | ↵ start #1 (recs)                                 | start pick · search · replay       | poster · totals             |
| movie complete              | `✓ movie complete` (mint)                 | ↵ replay                                          | replay · search                    | poster                      |

**Shortcuts to wire** in `onUnhandledInput`: `e → "pick-episode"` (non-movie), `t → "streams"`, `p → "previous"` (when has prev). Keep existing return/`c`/`w`/`1–3`.

**Tests**

- Extend `apps/cli/test/unit/domain/post-play-state.test.ts` if any state logic moves.
- New: assert `ActionRow`/hero selection is a pure function of `(postPlayState, resumeLabel, isMovie)` — extract `buildPostPlayActions(...)` as a tested pure helper to keep the component dumb.
- App-shell render smoke (narrow/medium/wide) — no crash, poster only wide.

**Risk:** medium (most-touched surface). **Mitigation:** pure action/hero helper tested first; live TTY verify (poster placement, no metadata jump, 1–3 picks, e/t restart correctly).

---

## Slice B — Now Playing deck polish (additive, low risk)

**Goal:** Confirm/finish the NOW/GO control deck already in `loading-shell.tsx`
playing body; tighten hierarchy (progress hero, NOW facts, GO keys), keep poster rail.

**Files:** `apps/cli/src/app-shell/loading-shell.tsx` (playing body only).
**Changes:** ensure GO row only lists wired keys; promote trouble inline; mpv-ownership hint stays dim. Mostly verification + small weight tweaks (D17).
**Tests:** existing app-shell. **Risk:** low.

---

## Slice C — Footers & shortcuts pass (cross-cutting, user-requested)

**Goal:** Every playback/post-play footer ≤ 4 + `[/]`, one `primary`, **no state
lies, no dead keys**. Done alongside each slice but tracked here as one concern.

**`buildPostPlayFooterActions` (ink-shell.tsx) target**

| State                          | Footer (primary first)                                      |
| ------------------------------ | ----------------------------------------------------------- |
| did-not-start                  | `r try again*` · `s search` · `/ commands`                  |
| stopped-early                  | `↵ resume*` · `n next` · `e episodes` · `/`                 |
| mid-series                     | `↵ continue*` · `e episodes` · `r replay` · `/`             |
| caught-up                      | `w watchlist*` · `s search` · `/`                           |
| season-finale (hasNextSeason)  | `n next season*` · `e episodes` · `r replay` · `/`          |
| season-finale (no next season) | `r replay*` · `s search` · `e episodes` · `/` ← **bug fix** |
| series-complete                | `↵ start #1*` (recs) · `s search` · `r replay` · `/`        |
| movie complete                 | `↵ replay*` · `s search` · `/`                              |

(\* = `primary: true`, rose key.) Validate every `action` against the wired set above; gate `e`/`t` exposure on `title.type`/state where it would no-op.

**Active-playback footer** (`loading-shell`): `space pause*` · `q stop` · `e episodes` · `t tracks` · `/` — already close; verify.
**Tests:** unit-test `buildPostPlayFooterActions` per state (esp. season-finale both branches; series-complete primary only when recs). **Risk:** low.

---

## Slice D — Browse focus-zone model (A5) (highest regression risk)

**Goal:** Visible zones `input → results → filter` with active-zone highlight;
rebind details to `i` (Shift+Enter undetectable).

**Files:** new pure reducer (`browse-focus-zone.ts` + test) → wire into `browse-shell.tsx` `useInput`.
**Changes:** zone state machine (printable keys edit query only in `input`; `↓` → results; `i` details in results; `tab` → filter; footer reflects active zone). Implement reducer as tested pure function **before** wiring.
**Tests:** exhaustive reducer table tests. **Risk:** high (input handling). **Mitigation:** pure-function-first + live verify.

---

## Slice E — Tracks · Recovery · Calendar · Episodes · Stats polish (match board)

- **Tracks** (`tracks-panel-shell.tsx`): verify sectioned facts-vs-pickers + unavailable reasons match board; footer `↑↓ · enter switch · esc · /`.
- **Recovery** (`buildPlaybackRecoveryViewModel` + recovery view): preserved-progress rail, one safe verb, crimson only on live fault, `[d] diagnostics`.
- **Calendar** (`calendar-ui.tsx`): aired-vs-playable by glyph+state, tracked tab, countdown; tab cycles type.
- **Episodes** (`OverlayPanel` + `EpisodePreviewRail`): state words (`✓ watched`/`▸ current`/`● ready`); finish `[s] season` wiring.
- **Stats**: paint-mix intensity heatmap (rescued from `kunai-redesign-v3`, recolored to Sakura) — brightness = minutes (`heatColor`/rose `heatRamp`), hue = type (`contentTintColor`; **the one allowed type-hue surface**). Less→More ramp + type key + breakdown bar + metrics grid. Owner: Stats view + `shell-theme.ts` `heatColor`/`contentTintColor`. Verify the rose ramp degrades to 256/16-color cleanly.

**Risk:** low–medium each; independent. **Tests:** per-surface where logic exists.

---

## Slice F — Color hierarchy (D17, cross-cutting)

Applied **within** each slice, not as a separate pass: titles brightest+bold,
metadata `muted`, single dominant rose action, progress `accentDeep→accent`
settling to `ok`/`danger`. Audit after Slices A–E.

---

## Slice G — Design authority consolidation (docs, no runtime)

- `.docs/design-system.md`: name `kunai-sakura-canonical.html` the single authority; mark `kunai-sakura.html` "narrow predecessor", `workbench-rec-v1.html` **"structural ideas only — dead amber/teal palette, do not copy color"**, and old `redesign-v2/v3`/`cli-design-board` "historical".
- `.prototypes/visual-authority/issues.json` + studio: record decisions; demote historical candidates.
- Memory: canonical = `kunai-sakura-canonical.html`; workbook = structural-only/dead-palette.

---

## Sequencing

1. **G** (docs/authority — cheap, stops drift leaking back) — optional first or last.
2. **A** + its part of **C** (post-play + footers) — biggest win.
3. **B** (now-playing verify).
4. **E** (tracks/recovery/calendar/episodes).
5. **D** (browse zones — isolate, highest risk, do deliberately).
6. **F** audit pass.

Each slice: own commit, gate green (`typecheck && lint && test`), live TTY verify
for anything visual (A/B/D/E). No `bun test` directly — use `bun run test`.

## Open questions / unknowns

- Bordered 3-up rec cards vs enriched list in TTY — starting with list (robust); revisit if you want cards at `wide`.
- Whether to plumb episode metadata (release date/rating/sub|dub/source line) later — out of scope now; board marks it "future plumbing".
- `caught-up` `c calendar` shortcut: `calendar` is a valid ShellAction but confirm it routes from post-play before exposing.
