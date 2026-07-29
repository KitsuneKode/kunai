# Kunai UI Polish — Design Spec

Date: 2026-05-21
Status: draft (awaiting user review)
Owner: UI/design polish pass

This spec turns the brainstorm into a buildable, dependency-ordered system. It is the
single design source for the polish pass; the chained implementation plan (written next)
spawns one per-slice design note from it.

**Artifact homes.** Brainstorm mockups live in `.superpowers/brainstorm/<session>/content/`
(gitignored, ephemeral). Each slice gets a _durable_ design note at
`docs/superpowers/specs/notes/s<N>-<topic>.md` (created during writing-plans) with the
chosen mockup snippet embedded, so the chained plan always has a committed visual reference.

---

## 1. Goal & governing principles

Make Kunai feel like a **premium, terminal-native streaming cockpit** — dense but calm,
fast, cinematic in small details, memorable enough that people keep coming back. Retention
through craft, not noise.

**Calibration (the north star for every decision): "enough, not more."** Never overdo
(decoration theater, gimmick panels, marketing vibes), never underdo (sparse screens,
missing info, debug-looking labels). Premium = the right amount, polished. (This is a
taste-driven tenet, not a PR-gate criterion — reviewers apply judgment, not a checklist.)

**Best-of-both-worlds panel doctrine** (power-user speed _and_ newcomer richness, same
component, no separate "beginner mode"):

1. **Progressive disclosure** — compact facts by default; richer controls appear only when
   a real alternative exists; deep detail only on focus/expand. Single-option layers
   collapse to a fact, not a control.
2. **Dual/triple access, no dead ends** — every action reachable by a **direct hotkey**,
   the **`/` command palette**, and (where present) the **sidebar/pill**. Disabled actions
   state _why_; never silently ignored.
3. **Companion, not modal, when it enriches** — augmenting panels render as inline/side
   companions (context stays); replacing panels are a single disciplined overlay. Never
   stack two competing panels.
4. **One fact, one home** — the same state never repeats across header + badge + detail +
   footer. (Root cause of the duplicate top-bars bug.)
5. **Degrade rich → calm gracefully** — under width pressure: content > companion >
   sidebar, image-before-details. The rich layout collapses _into_ the calm one, never
   breaks.

These are the existing `design-system.md` / `ux-architecture.md` rules, sharpened — not a
new direction. Command-first stays: `/` is the universal entry; the tab/pill and sidebar
are _additional_ visual paths to the same destinations, never replacements.

---

## 2. Slice map (read this first)

Each slice is independently green: `bun run typecheck` + `lint` + `test` pass, the shell
stays usable, and no dead code is introduced. If a slice can't meet that, split it.

| Slice                                       | Contents                                                                                                                                                                                                                                                                                                                                                   | Exit criteria                                                                                  | Blocked by |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| **S0 Tokens**                               | Expand `packages/design/src/tokens.ts` (§4): surface scale, semantic accents + tinted fills, content tints, borderStrong/scrim/raised. Map into `shell-theme.ts`. **Additive — zero UI change.**                                                                                                                                                           | New tokens exist + referenced by nothing yet; existing screens visually identical              | —          |
| **S1 Pure helpers**                         | Pure, unit-tested formatting fns (§5.1): row/column/truncate (word-safe), footer selection, segmented/tab geometry, heat bucketing, **typed evidence-vs-language seam** in `app/source-quality.ts`. **Additive.**                                                                                                                                          | New tests green; no caller changes                                                             | S0         |
| **S2 Primitive components**                 | Ink views consuming S1 (§5.2): `AppHeader`, `SelectableRow`, `TabStrip`, `SegmentedControl`, `Badge`, `DetailRow`, `ProgressBar`, `Heatmap`, `EmptyState`/`Loading`/`Degraded`/`ErrorBlock`, `InsightLine`, `FooterHint`, `NavSidebar`, `CompanionPane`. **Additive: built + tested, no screen rewired yet.**                                              | Components render in isolation tests; no screen consumes them yet                              | S1         |
| **S3a Frame dedup**                         | One `AppHeader` owns brand/pill/mode/status/size (kills dup bars); calm `FooterHint`. Additive composition + remove brand/provider re-render from `RootIdleShell`/browse chrome. **Unblocks the screen tail.**                                                                                                                                             | No duplicate header anywhere; one footer line; screens still work                              | S2         |
| **S3b Alt-screen overlay unify**            | **First task: verify alt-screen support** (`bun pm ls ink`; grep `node_modules/ink` for `alternateScreen`/`1049`) — if silently ignored, add manual `\x1b[?1049h/l` + SIGWINCH handling. Then unify ephemeral `mountShell` flows into the persistent `RootOverlayShell` + remove competing manual `clearShellScreen` calls so the reconciler owns repaint. | Pickers/loading render in persistent tree; resize has no flicker/artifacts; own rollback story | S3a        |
| **S4 Browse + pickers**                     | Search results, season/episode/series pickers on the kit: human titles (no `panel episode_picker`), single hint line, watched-state, companion still, no marker soup, drop "Series" column, word-safe overview.                                                                                                                                            | Picker UX matches §6.2/§6.3; one footer line                                                   | S3a        |
| **S5 Command palette**                      | Grouped (Global/Context), dense, scroll affordance, default highlight, preserves underlying filter/scroll.                                                                                                                                                                                                                                                 | §6.1                                                                                           | S3a        |
| **S6 Continue/History/Library/Downloads**   | Field-complete rows + companion (§6.4); offline/repair status copy; SelectableRow everywhere.                                                                                                                                                                                                                                                              | §6.4                                                                                           | S4         |
| **S7 Calendar**                             | Weekly release board (§6.5): grouped by day, released/airing-today/upcoming color states, Anime·TV·Movies filter, week nav, companion.                                                                                                                                                                                                                     | §6.5                                                                                           | S4         |
| **S8 Discover/Trending + Stats**            | Rails + ranks (§6.6); Stats real bars, segmented filter/range, 12-mo amber heatmap (§6.7).                                                                                                                                                                                                                                                                 | §6.6/§6.7                                                                                      | S6         |
| **S9 Track picker**                         | Presentation-first (anime) / source-first (series) layers from normalized fields; evidence-only native labels; collapse single-option (§6.8).                                                                                                                                                                                                              | §6.8                                                                                           | S3a        |
| **S10 Playback HUD**                        | Now-playing cockpit (§6.9) + restored hotkey footer.                                                                                                                                                                                                                                                                                                       | §6.9                                                                                           | S2, S9     |
| **S11 Post-play**                           | Rich state-aware variants (§6.10), no floating card.                                                                                                                                                                                                                                                                                                       | §6.10                                                                                          | S6, S10    |
| **S12 Diagnostics + Notifications + Setup** | Plain-language diagnostics that expand to dev depth; inbox rows; onboarding (§6.11).                                                                                                                                                                                                                                                                       | §6.11                                                                                          | S2         |
| **S13 Sidebar enable + responsive sweep**   | Turn on `NavSidebar` (full/icon/hidden, toggleable; preference persisted in `~/.config/kunai/config.json`); verify §7 across all surfaces.                                                                                                                                                                                                                 | §7 holds at narrow/medium/wide                                                                 | S3a–S12    |
| **S14 Legacy cleanup**                      | Migrate/retire `clr.*` ANSI drift per verified caller (§9), delete obsolete code.                                                                                                                                                                                                                                                                          | No dead code; non-Ink output paths intentionally decided                                       | all        |

Playback/post-play first-class hotkeys (confirmed): **next/prev**, **replay + recover/refresh**,
**source/quality/subtitle pickers**, **skip intro/outro + watchlist/queue** — shown only when usable now.

---

## 3. Out of scope / do-not-touch

Per `hybrid-ui-contract-stabilization.md`, this pass does **not** change: provider resolve
fallback policy, download retry-vs-repair semantics, stream inventory normalization, cache
invalidation policy, history reconciliation ownership. UI renders cached/provider-returned
inventory and performs **no** provider network work on render. No raw stream URLs ever
surfaced. Native source/server labels are **evidence**, never language.

---

## 4. Expanded token system (S0)

Single source of truth stays `packages/design/src/tokens.ts`; `shell-theme.ts` maps to
app-shell names. Values are RGB truecolor; "tinted fills" are each accent pre-blended into
the warm-black canvas (terminal stand-in for opacity → depth without alpha).

**Surface elevation:** `scrim #0a0806` (overlay dim) · `bg #110e0b` · `surface #1a1612` ·
`surfaceElevated #241e18` · `surfaceActive #2e251e` (selected row) · `raised #3a2f24` (NEW
hover/focus) · borders `borderDim #1e1a15` / `border #332a22` / `borderStrong #4a3d30` (NEW
focus edge).

**Semantic accents — each `base` + (`soft`) + `dim` + `fill`:**
amber `#f0a050` / soft `#ffbf80` / dim `#7a4a10` / fill `#2a2012` — **primary action & selection** ·
teal `#5ad4b5` / fill `#13241f` — **live status** ·
info `#6a9fd8` / fill `#15243a` — **counts / series tint** ·
pink `#ff4d8a` / soft `#ff85aa` / fill `#2a1420` — **anime / discovery** ·
lavender `#c4b5e8` / fill `#20203a` — **recommendations / movie tint** ·
green `#7bc96e` / fill `#16261a` — **success** ·
yellow `#f0c850` / fill `#2a2410` — **caution / stale** ·
red `#ff6666` / fill `#2e1717` — **failure** ·
purple `#a855f7` — **series-complete milestone, reserved, never reused**.

**Content-type tints:** anime → pink, series → info-blue, movie → lavender. (Amber stays
free for actions.)

**Text scale (unchanged):** `text #e8ddd0` · `textDim #c8bba8` · `muted #95887a` ·
`dim #5c5248` · `faint #3c342c`.

**Heat ramp (amber, 5-step):** `#2a2018` `#7a4a10` `#b06a18` `#d68a24` `#f0a050`.

Usage discipline: amber = action/selection only; green only for real success; red only for
real failure; yellow for caution/stale; status badges sit on their own low-chroma fill so
they read distinct while calm.

---

## 5. Primitive kit

### 5.1 Pure helpers (S1, unit-tested — no Ink)

- `truncateAtWord(text, max)` → word-boundary ellipsis (fixes "blue-col" mid-word cut).
- `layoutRow({label, detail, badges, width})` → fixed-width aligned columns (tabular).
- `selectFooterActions(...)` → already exists; extend for the calm treatment.
- `tabGeometry` / `segmentGeometry` → pill widths, active index, overflow.
- `heatBucket(value, max)` → 0–4 ramp index; `boundHeatWindow(entries)` → ~12-month window.
- `barFill(value, max, width)` → per-row proportional bar segments (fixes collapsed bars).
- **Evidence/language seam** in `app/source-quality.ts`: distinct, non-overlapping
  `formatLanguageBadge(normalized: NormalizedLanguage)` vs
  `formatSourceEvidence(evidence: ProviderSourceEvidence)` so mixing them is a _type error_,
  not a convention. Track-picker controls consume only normalized language inputs.

### 5.2 Ink components (S2)

`AppHeader` (brand · destination pill · mode/provider · right: status dot + size chip) ·
`SelectableRow` (amber rule `▌` + `surfaceActive`/amber `fill` — the agreed "C") ·
`TabStrip` (active = filled pill) · `SegmentedControl` (active = amber `seg` fill) ·
`Badge` (tone → accent + fill; content-type variant) · `DetailRow` (tabular label/value) ·
`ProgressBar` (hi-fi `█`/`┈` + pct) · `Heatmap` · `EmptyState`/`LoadingState`/
`DegradedState`/`ErrorBlock` (designed, not raw dim text) · `InsightLine` (info-tone
one-liner) · `FooterHint` (one calm line: keys `dim`, labels `muted`, only `/` amber) ·
`CompanionPane` (poster/still via image-pane + field-complete details) · `NavSidebar`
(full/icon/hidden).

`AppHeader` and `FooterHint` are owned by `ShellFrame`; **content never re-renders
brand/provider/mode** (kills duplication).

---

## 6. Per-surface treatments

Each section: **binds** (contract fields), **consumes** (primitives), **IN** (first slice
scope), **missing-data** (placeholder + first-to-drop). Detailed mockups live in the
companion archive (`.superpowers/brainstorm/.../content/`) and per-slice notes.

### 6.1 Command palette (S5)

- Binds: command registry (`domain/session/command-registry.ts`), enable/reason.
- Consumes: Segmented/group headers, SelectableRow, FooterHint.
- IN: group by Global/Context, dense single-line rows, scroll affordance, default
  highlight, preserve underlying filter + restore focus, palette replaces footer guidance
  while open.
- Missing: disabled commands show reason inline; never hidden silently.

### 6.2 Season/Episode pickers (S4)

- Binds: `EpisodeIdentity.{title,airDate,artwork}`, local history (watched/resume).
- Consumes: AppHeader pill (`Choose episode`), SelectableRow, CompanionPane (still),
  FooterHint (single line).
- IN: human title (no `panel …`), one hint line (not three), watched `✓` + resume from
  history, companion still + episode metadata, single accent-bar selection (drop `▸ ) ▶ ○`).
- Missing: no title → `Episode N`; no still → dim "no preview"; companion drops first.

### 6.3 Series/search results (S4)

- Binds: title, year, type, overview, rating, poster (`artwork.posterUrl`/TMDB), provider.
- IN: year beside title; **drop repeated "Series" column** (type as quiet badge only when
  results are mixed); word-safe overview (`truncateAtWord`); SelectableRow; companion poster.
- Missing: no overview → dim "no synopsis"; no poster → text shelf.

### 6.4 Continue / History / Library / Downloads (S6)

- Binds: local history (position/duration/progress), `EpisodeIdentity.title`,
  `artwork.thumbnailUrl→posterUrl`, `airDate`, normalized `audioLanguages`/`subtitleLanguages`,
  `qualityLabel`, `sourceEvidence.nativeLabel/host` (evidence), `release` (next/airs),
  `artwork.seekBarVttUrl` ("scrub previews"), rating; offline `thumbnailPath`, repairability.
- Consumes: SelectableRow, DetailRow, ProgressBar, Badge (content-type + status),
  CompanionPane, TabStrip (Continue/History sub-views).
- IN: field-complete rows + companion (per the field-complete mockup); offline/repair
  status copy distinguishing network-offline / provider-blocked / parse-failed /
  subtitle-repairable.
- Missing: every field → dim placeholder, never fake data; companion still drops before
  details under width pressure.

### 6.5 Calendar (S7)

- Binds: catalog/release schedule (`release`, air times), per-title artwork, type.
- Consumes: AppHeader pill (`Calendar`), SegmentedControl (Anime·TV·Movies), week nav
  (`←/→`), SelectableRow, CompanionPane.
- IN: **weekly release board** grouped by day; status color: `✓ released` (green/dim),
  `▶ airing today` (amber, active), `○ upcoming` (muted); companion previews selection.
  _Not_ a stats-style multi-tab stack. Calendar entries are release facts, not playable
  guarantees.
- Missing: empty day → dim "no releases"; unknown air time → date only.

### 6.6 Discover / Trending (S8)

- Binds: recommendation service output, rank, rating, "because you watched" seeds.
- Consumes: rails (section header + SelectableRow), Badge (rank/HOT), CompanionPane.
- IN: ranked trending rail + contextual "because you watched"; lavender for recommendation
  accent; stale-data shown calmly while refresh deferred.

### 6.7 Stats (S8)

- Binds: local watch history aggregates, streak.
- Consumes: AppHeader pill, SegmentedControl (filter All/Series/Anime/Movies + range
  30d/90d/all), Heatmap, DetailRow grid, **per-row bars**, InsightLine, FooterHint.
- IN: fix collapsed bars → real proportional per-row bars (aligned label col); replace
  `1:30d` prefixes with segmented controls (keys taught in footer); bound heatmap to ~12
  months in amber ramp; single header; one insight line.

### 6.8 Track picker (S9)

- Binds: `presentation` (sub/dub/hardsub/softsub), `sources[]`, `variants[]`/`qualityLabel`,
  normalized `audioLanguages`, `hardSubLanguage`, `subtitleLanguages`, `languageEvidence`/
  `sourceEvidence.nativeLabel` (evidence).
- Consumes: SegmentedControl per layer, DetailRow (evidence line).
- IN: **anime = presentation-first** (Sub/Dub/Hard Sub → server → quality → audio →
  subtitles); **series/movie = source-first** (source → quality → audio → subtitles).
  Languages only from normalized fields; native labels are dim evidence. **Single-option
  layers collapse to a fact, not a control.** Subtitle repair offered when repairable;
  hardsub-only ⇒ no sidecar expected. Renders from cached inventory — no provider call.
- Missing: no alternative in a layer → fact line; no subtitles → "none" honestly.

### 6.9 Playback HUD (S10)

- Binds: title, `EpisodeIdentity.title`, `qualityLabel`, normalized audio/subs,
  `sourceEvidence` (evidence), live position/duration, next-episode availability
  (`release`/catalog), intro/outro window (AniSkip), `artwork.thumbnailUrl` (still).
- Consumes: AppHeader pill (`Now Playing`), CompanionPane (live still/poster via image-pane,
  outside Ink tree), ProgressBar, DetailRow, FooterHint.
- IN: theater feel kept; series + episode **name once** (no dup); quality + normalized
  audio/subs; source evidence; hi-fi progress; **UP NEXT** + availability; skip-intro
  window; restored hotkey footer (space/n/p/s/c/k/q + `/`) showing only usable-now actions.
- Missing: no next episode → hide next; no still → details only; no intro data → no skip key.

### 6.10 Post-play (S11)

- Binds: finished episode, next-episode + availability + still, season progress (ep N of M),
  recommendation seeds, autoplay state.
- Consumes: layout sections (no floating card), CompanionPane, ProgressBar, rec rail,
  FooterHint.
- IN: state-aware variants — **mid-series** (finished + UP NEXT + season-progress + rec
  rail), **caught-up** (rec rail leads), **series-complete** (purple milestone celebration),
  **stopped-early** (resume offer). Autoplay-paused surfaces as amber state with `n` to go.
  Tasteful hierarchy via layout, _not_ bordered card slop.
- Missing: no next → caught-up/complete variant; no recs → calm "nothing queued".

### 6.11 Diagnostics / Notifications / Setup (S12)

- Diagnostics: plain-language summary (capability, provider path, subtitle evidence) that
  **expands** to dev depth (cache/prefetch/scrape timing, retry/fallback history, language
  switch path). Privacy-safe; no raw URLs.
- Notifications inbox: SelectableRow rows with tone badges; calm empty state.
- Setup/onboarding: premium first impression, inline blocker first, setup overlay only on
  request; Install/Skip/Don't-ask-again; never silent system installs.

---

## 7. Responsive (S13)

- **Wide (≥132):** optional full sidebar + list + companion.
- **Medium (92–131):** sidebar → icon rail (or hidden); companion below list (stacked).
- **Narrow (<92):** sidebar hidden; companion → toggled drawer; image drops before details;
  list + input primary.
- **Too small:** `ResizeBlocker` instead of half-render.
- Collapse priority everywhere: content > companion > sidebar; image before details.
- Sidebar is user-toggleable regardless of width (max-density opt-out).

---

## 8. Motion (calibrated)

Selection = instant text response, no animation dependency. Overlays = subtle, interruptible
enter/exit. Loaders = short, visible, non-blocking. Auto-next/playback-return = stateful
transition, not a hard jump. Alt-screen transitions favor instant layout stability over
flourish. Reduced/minimal mode simplifies or skips motion. `Ctrl+C` always near-instant.
High-frequency actions (picker nav, palette open, search focus) never animate.

---

## 9. Guardrails & risks

- **`clr.*` ANSI drift (S14):** `design.ts` `clr.pink`/`clr.teal`/`clr.fox` diverge from
  `tokens.ts`. Do **not** blind-change RGB. Verify callers (`menu.ts`, `search.ts`,
  `mpv.ts`, logging) first; decide per-caller align-value vs migrate-to-`palette`; migrate
  in S14 only. Non-Ink output paths get an explicit decision, not an accidental recolor.
- **Evidence-vs-language:** enforced by the typed seam (S1), not docs alone.
- **No provider calls on render; no raw URLs; posters companion-pane only** (image-pane owns
  layout/clearing/flicker; never required for selection/playback).
- **Alt-screen unify (S3)** is the one structural change; it is bounded to render-tree
  consolidation + removing manual clears, and is explicitly user-requested for anti-flicker.

---

## 10. Testing

- **Pure unit tests (S1, primary):** truncation/word-safe, column layout, footer selection,
  tab/segment geometry, heat bucketing/window, bar fill, evidence/language seam.
- **Component tests (S2):** primitive render under tones/widths/states.
- **Reducer/integration seams:** picker filter/scroll preservation, overlay discipline,
  header dedup, alt-screen resize (no manual clear).
- **VHS (optional):** heavy-visual screens (browse, playback, post-play, calendar) for
  before/after capture — never the only behavioral test.
- Gate: `bun run typecheck` + `lint` + `fmt` + `test` green per slice.

---

## 11. Definition of done (per UI pass)

Updated durable docs where interaction rules changed · ≥1 deterministic behavior test seam ·
VHS/screenshot path for heavy-visual changes · no new duplicate interaction models · no new
invisible one-off key behavior · each slice independently green.
