# Tracks / Servers Nested Panel — Design

Date: 2026-06-06
Status: Approved (brainstorming) — pending implementation plan
Sub-project: **A** of the post-0.2.4 UX wave (siblings: B Now Playing bugs, C+D Continuity). See memory `project_ux_v2_decomposition`.

Visual target: `.design/cli/tracks-panel-redesign.html`.
Current build: `apps/cli/src/app-shell/tracks-panel-shell.tsx` (flat stacked sections) +
`apps/cli/src/domain/playback/track-capabilities.ts` (source identity = `group.id`; 0.2.4 added a
flag-labelled audio badge per source row). C13 unified `/source`+`/quality` into the `tracks_panel`
overlay and removed the standalone pickers.

## Goal

Replace the flat, scrollable tracks dump with a **nested two-pane panel** (modelled on the
season→episode picker) where every track category and its current value stays visible while the user
drills into one section to make a selection — no context loss, no per-row spam. Add **favorite
servers**: a globally remembered preference (by source name) that pins favorites to the top and is
preferred during auto-selection.

## Non-goals

- No changes to provider scraping, stream resolution, or the inventory contract beyond (possibly)
  surfacing a source **name/label** on the stream candidate for favorite matching.
- No queue/playlist, history, or calendar work (that is sub-project C+D).
- No Now Playing bug fixes (sub-project B).

## 1. Layout & navigation model

Two-pane, mirroring the episode picker. **Left pane** = the four sections, each rendering its
**current value** as a summary line (context always visible). **Right pane** = the options for the
currently focused section.

```
🦊 Kunai  [Tracks]   vidlink · S01E03
1 source · 3 qualities · 10 subtitles · host vidlink.pro
──────────────────────┬──────────────────────────────────
 ▸ Source   VidLink    │  SOURCE · 5 servers
   Quality  1080p      │  ▌ ♥ Neon     🇺🇸 English · 1080p  ✓ playing
   Audio    English    │       Cypher   🇺🇸 English · 1080p
   Subtitles English   │    ♥  Fade     🇮🇳 Hindi   · 1080p
                       │       Killjoy  🇩🇪 German  · 720p
                       │       Yoru     🇺🇸 English · ~4K · movies only
──────────────────────┴──────────────────────────────────
↑↓ choose · → enter · ⏎ switch · f favorite · esc back
```

### Interaction

- **Two focus panes:** `sections` (left) and `options` (right). Focus starts on `sections`.
- `sections` focused: `↑↓` moves between Source / Quality / Audio / Subtitles; the right pane
  live-previews the focused section's options. `→` or `⏎` enters the section (focus → `options`).
- `options` focused: `↑↓` navigates options; `⏎` applies the selection (switch source/quality/audio,
  or toggle subtitle); `←` or `esc` returns to `sections` **at the same section** (position kept).
- `esc` from `sections` closes the panel.
- `f` (only meaningful in the Source section / on a source option) toggles favorite on the focused
  source.
- A section whose only content is a single fact (e.g. 1 source, 1 audio) still shows in the left
  list with its value; entering it shows the fact row(s) but offers nothing switchable.

### Responsive degradation

- At `contentWidth >= ~56` cols: two-pane as above (same threshold the episode picker uses for its
  preview rail).
- Below that: **fall back to the existing single-column stacked view** (section headers + rows). No
  feature is lost; only the side-by-side affordance collapses.

### State & purity

- The nested navigation state — `{ focusedPane: "sections" | "options"; sectionIndex; optionIndex }`
  — is driven by a **pure reducer** (`tracksPanelNavReducer`) with an initial-state factory,
  unit-tested in isolation (pattern: `browse-focus-zone.ts`). The Ink component is a thin renderer
  over reducer state + the capability model.

## 2. Favorites (global by source name, persisted)

### Data

- New field `KitsuneConfig.favoriteSources: readonly string[]` — **normalized source names**.
- `normalizeSourceName(label: string): string` — lowercase, trim, collapse/strip whitespace &
  punctuation (e.g. `"VidLink"` → `"vidlink"`, `"Vid Link"` → `"vidlink"`). Shared helper so the UI,
  persistence, and auto-select agree on identity.
- ConfigService gains read + toggle for the favorites list, persisted via the existing atomic JSON
  write. Default `[]`. Backfilled in config migration/defaults like other added fields.

### UI behavior

- `f` toggles ♥ on the focused source option; write-through to config (no separate save step).
- The Source pane sorts **favorites first** (stable), then the provider/default order. Favorited rows
  render a ♥ marker; the currently playing source keeps its `✓ playing` state independent of ♥.

### Auto-select integration

- Extend `selectReadyStream` input (`packages/providers/src/shared/startup-selection.ts`) with
  `favoriteSourceNames?: readonly string[]`.
- New preference rank: **explicit (preferredStreamId/preferredSourceId)** → **favorite available
  (highest `qualityRank` among streams whose source name is favorited)** → **quality-preference** →
  **startup default**. Decision `reason` gains a `"favorite-source"` value for diagnostics.
- **Open implementation detail (resolve in planning):** matching a favorite requires the stream
  candidate's source _name_. `StreamCandidate` currently exposes `sourceId`. If a human source
  label/name is not already available on the candidate, thread one through (or a `sourceId → name`
  lookup from the inventory view) so the favorite list (by name) can match. This must not change
  provider behavior when `favoriteSourceNames` is empty.

## 3. Subtitles grid + counts header

- Counts header line under the crumb: `N source · N qualities · N subtitles · host <host>` (host from
  the inventory view when available; omitted otherwise).
- Subtitles render as a **wrapped multi-column chip grid** (not stacked rows): each language a chip,
  the current one marked `✓`, plus a `Subtitles off` chip. Keep the existing note that subtitles
  attach live in mpv. Grid column count derives from available width.

## 4. Routing & keybinds

- **No `/tracks` command** — the umbrella command is redundant and confusing (decision 2026-06-06).
  The panel is reached **only** through the per-section deep-links; from any section the left pane
  exposes all four, so nothing is unreachable.
- `/source`, `/quality`, `/audio`, `/subtitles` each open the **same nested panel** deep-linked to
  that section (focus may land directly in the `options` pane for the deep-linked section).
- From active playback: `s` opens the panel at the **Source/Servers** section (switching server is the
  most frequent action, so it gets the key). No separate "tracks" key.
- The panel's internal/header label may still read "Tracks" as standard media terminology, but it is
  never surfaced as a command.
- Reuse the existing `tracks_panel` `OverlayState`; extend it to carry the nested nav state and the
  active/deep-linked section. Remove the now-unused `/tracks` command registration. The dormant
  `source_picker` / `quality_picker` overlay members remain out of scope here (their removal is
  tracked separately as C13 follow-up cleanup).

## 5. Testing

- `tracksPanelNavReducer`: focus transitions, section/option bounds, deep-link entry, esc/back
  position retention.
- Favorites: `normalizeSourceName`; toggle add/remove; favorites-first sort stability.
- `selectReadyStream`: favorite preference rank (favorite available, favorite absent, favorite +
  explicit, empty favorites = unchanged behavior).
- Layout model: subtitle grid wrapping; counts header composition.
- Snapshot the panel at wide (two-pane) and narrow (stacked fallback) widths.
- Gate stays green: `bun run typecheck`, `bun run lint`, `bun run test`.

## Risks

- **Input handling regression** (high): the nested reducer changes how keys route inside the overlay.
  Mitigate by building/testing the reducer as a pure function first, then wiring, then live-verifying
  in the user's terminal.
- **Auto-select behavior change** (medium): favorite preference alters which stream starts. Gate
  entirely behind a non-empty `favoriteSources`; empty list = byte-for-byte current behavior.
- **Source-name identity** (medium): favorites are by name but matching/auto-select operate on ids.
  Resolved by the normalized-name helper + threading a label onto the candidate.

## Terminology

- **Source = Servers** — the same concept under two labels (our domain says "source"; streaming sites
  say "servers"). One category: which host/server delivers the stream.
- **Tracks** — the umbrella panel containing four categories: Source/Servers, Quality, Audio,
  Subtitles. So Servers ⊂ Tracks. `/source` `/quality` `/audio` `/subtitles` are deep-link shortcuts
  into the corresponding section of the single Tracks panel.
