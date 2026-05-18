# Kunai — Launch Redesign Spec

This document locks the design decisions made during the May 2026 UX audit pass. It supplements — not replaces — [design-system.md](./design-system.md) and [ui-redesign-playbook.md](./ui-redesign-playbook.md), which remain authoritative for principles and token values. When this spec says something already covered in those docs, it means we are now locking it to a specific constraint. Fold the locked rules back into those docs after the implementation ships.

**Scope**: Every user-facing surface redesigned in this pass. See Part 5 for explicit out-of-scope items.

---

## Part 1 — Visual Language

### 1.1 Color Semantic Lock

These are hard rules. No color may be used outside its assigned meaning.

Token values live in `packages/design/src/tokens.ts`. Reference `tokens.amber`, `tokens.teal`, etc. in code — do not copy hex values inline.

| Token           | Assigned meaning                                                                 | Banned from                                      |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `tokens.amber`  | Primary action, active selection, active key in footer, today marker in calendar | Series state, body text, generic status          |
| `tokens.teal`   | Current provider, informational status, airing series state                      | Primary action, warnings                         |
| `tokens.green`  | Success, complete milestone, finished episodes, ended series (show concluded)    | Airing status, progress fill on partial episodes |
| `tokens.red`    | Errors, destructive actions, danger zone header                                  | Warnings, accents                                |
| `tokens.pink`   | Anime discovery accent only                                                      | General purpose, success/failure                 |
| `tokens.purple` | Series complete milestone (user finished an entire series)                       | General status, errors, any other purpose        |

#### Series state color mapping

| State                  | Color  | Glyph      |
| ---------------------- | ------ | ---------- |
| Airing                 | teal   | `◉`        |
| Ended (show over)      | green  | `✦`        |
| You finished this      | purple | `✦`        |
| Upcoming / not started | amber  | (no glyph) |

### 1.2 Footer Typography Rules

Footer actions follow exactly one pattern: **key glyph + dim label**.

```
[amber key]  [dim label]   [dim key]  [dim label]   [dim key]  [dim label]   / commands
```

Rules:

- One primary action: amber key only. All other keys are default/dim.
- Separator: two spaces between action groups (no pipe `|`, no bullet `·`).
- `/ commands` always appears as the last item in dim.
- NO bordered boxes around status information.
- NO badge-pill buttons in the footer.
- Status information that belongs in the footer (e.g., discord status, airing state) is plain inline colored text, not wrapped chrome.

**DO NOT:**

```
[ ⬡ Discord ]  [ ◉ Airing ]  [ Anime ]
```

These look like buttons. They read as actionable chrome. They are "AI slop" — do not use this pattern anywhere.

**DO:**

```
⬡ discord  ·  ◉ airing  ·  anime
```

Information is typography. Color and spacing carry the signal.

### 1.3 Badge Rules

Badges (colored pill labels) are allowed **only** in mixed-type lists where the type of each item is not clear from context.

| Surface                                 | Badges allowed? | Rule                                           |
| --------------------------------------- | --------------- | ---------------------------------------------- |
| Mixed browse list (anime + movies + TV) | Yes             | Max 2 per row                                  |
| Pure episode picker                     | No              | Every row is an episode — no type badge needed |
| Settings                                | No              | Use indicator dots instead                     |
| Loading screen                          | No              | Use stage dots                                 |
| Post-playback                           | No              | State is clear from layout                     |
| Footer                                  | No              | Use inline colored text                        |
| History panel                           | No              | Use inline colored status text                 |
| Command palette                         | No              | Use disabled state pattern                     |
| Active playback                         | No              | Signal rail for stream info                    |
| Onboarding                              | No              | Use inline banners                             |

Max 2 badges per row, always. If a row needs more than 2 labels, consolidate or restructure.

### 1.4 Tabular Numbers

Apply `font-variant-numeric: tabular-nums` (or equivalent Ink numeric rendering) to every dynamically updating number:

- All timestamps (e.g., air dates, download ETAs)
- Episode numbers
- Progress percentages
- File sizes
- Terminal dimensions in footer size chip
- Cache memory values in diagnostics
- Stream bitrate / speed in signal rail

### 1.5 Context Strip (CS)

One line below the header. Dim `·` separators. Key stable facts only.

```
anime  ·  crunchyroll  ·  S01 · E03 of 24  ·  60% complete
```

Rules:

- Never shows mutable transient state (e.g., "loading...", "resolving...")
- Replaces all "Current Selection: ..." and "Now Playing: ..." labeling patterns
- One context strip per screen — never duplicated across header, body, and footer

---

## Part 2 — Surface Specs

### 2.1 Browse Shell

#### Layout by breakpoint

**Wide (120+ cols):**

```
╭─────────────────────────────────────────────────────────────╮
│ kunai  ·  browse  ·  crunchyroll            anime · 120×34  │
├───────────────────────────────────────┬─────────────────────┤
│ > Attack on Titan               anime │  [poster]           │
│   Demon Slayer                  anime │  Attack on Titan    │
│   Spy × Family                  anime │  Action · 2013      │
│   ...                                 │  In a world where   │
│                                       │  titans threaten... │
│                                       │                     │
│                                       │  S04 · 28 eps       │
│                                       │  crunchyroll · sub  │
├───────────────────────────────────────┴─────────────────────┤
│ ↵ play   / commands   ? help   q quit                       │
╰─────────────────────────────────────────────────────────────╯
```

**Medium (80-119 cols):**

- Top: navigation list (full width)
- Bottom: companion pane (no poster)
- Companion toggled with `tab`

**Narrow (60-79 cols):**

- List only; companion hidden
- Footer collapses to 3 actions

#### Filter chips

Displayed as inline underlined text above the list, not as bordered pill buttons:

```
All  <u>Anime</u>  TV  Movies
```

Active filter: amber underline. Inactive: dim.

#### Empty states

No results:

```
  ◌  no results for "evangelio"
     try "evangelion" or browse by genre
```

First launch (no history, no query):

```
  ◈  welcome to kunai
     search for a title to begin  ·  /discover for recommendations
```

---

### 2.2 Post-Playback — 4 Named States

Post-playback never shows: network stats, stream quality dump, provider debug info, resolution/bitrate, HTTP timing.

#### State 1: Mid-series (more episodes in current season)

```
╭─────────────────────────────────────────────────────────────╮
│ kunai  ·  post-play  ·  crunchyroll                         │
│ Attack on Titan  ·  S01  ·  E03 of 24                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [poster]  ↵ continue                                      │
│             S01 E04 — Night of the Disbanding Ceremony      │
│             43 min                                          │
│                                                             │
│   ─────────────────────────────────────────────────────    │
│   you might also like                                       │
│   Vinland Saga · Fullmetal Alchemist · Made in Abyss        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ ↵ continue   b back   q quit   / commands                   │
╰─────────────────────────────────────────────────────────────╯
```

Dominant: up-next card. Recommendations: quiet secondary row.

#### State 2: Caught-up / Airing (watching current on airing series)

```
│   ◉ caught up  ·  next episode in 4 days                   │
│   Fri May 22, 9:00 PM JST                                   │
│                                                             │
│   w  add to watchlist to get notified                       │
│                                                             │
│   ─────────────────────────────────────────────────────    │
│   you might also like                                       │
│   ...                                                       │
```

Primary action: `w` watchlist add (amber). Air date: teal.

#### State 3: Season Finale (last ep of season, next season exists)

```
│   ✦ Season 1 complete                                       │
│                                                             │
│   ↵ continue to Season 2                                    │
│     24 episodes                                             │
│                                                             │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░  48 of 96 eps overall  50%     │
```

Season complete header: green. Overall progress: dim.

#### State 4: Series Complete (last ep of last season)

```
│   ✦ you finished Attack on Titan                            │
│     96 episodes across 4 seasons                            │
│                                                             │
│   ─────────────────────────────────────────────────────    │
│   because you finished this                                 │
│   [Vinland Saga]  [Berserk]  [Claymore]                     │
│   j/k or ← → to browse  ·  ↵ to play                       │
```

Series complete banner: purple. Recommendations become the primary surface.

---

### 2.3 Loading / Resolve Screen

Stage dots — four stages, always in this order:

```
  ◐ Resolving   ◓ Providers   ◑ Stream   ◒ Player
```

- Pending stages: dim
- Active stage: amber, cycling animation on glyph
- Completed stages: green `✓`

Example mid-resolve:

```
  ✓ Resolving   ◓ Providers   ◑ Stream   ◒ Player

  crunchyroll · subtitles  en · pt · es  via OpenSubtitles
  720p H.264 · direct stream
```

Subtitle and quality facts appear as dim lines below the stage rail — never as bordered panels, never as debug dump.

**Banned from loading screen:** raw URLs, provider internal state, HTTP status codes, retry counts as primary text, stream tokens.

---

### 2.4 Active Playback Screen

```
╭─────────────────────────────────────────────────────────────╮
│ kunai  ·  playing  ·  crunchyroll                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Attack on Titan                          720p · 23fps     │
│   S01 E03 — A Dim Light Amid Despair       24.3 MB/s ↓     │
│                                            sub en           │
│   01:12:43 ━━━━━━━━━━━━━━━╸━━━━━━━━━━     1:24:22 total    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ space pause   / commands                                    │
╰─────────────────────────────────────────────────────────────╯
```

Signal rail: right-aligned, dim. Contains: resolution, framerate, download speed, active subtitle track.

Playback footer: minimal — `space pause   / commands` only. No repeated metadata.

---

### 2.5 Episode Picker

Header context strip:

```
Attack on Titan  ·  S01  ·  24 eps  ·  60% complete
```

Row format:

```
  ▶  E03 — A Dim Light Amid Despair                     42m
     ░░░░░░░░░░░████████████████████  65%
```

- Selected row: amber `▶`
- Watched indicator: green progress bar fill
- Partial: amber fill to watched point, then empty
- Unwatched: empty bar (dim)

Never: series title repeated in each row.

---

### 2.6 Settings

```
  PLAYBACK
  ─────────────────────────────────────────
  ● Auto-play next episode             on
  ● Skip intros (AniSkip)              on
  ● Default quality                    720p

  SUBTITLES
  ─────────────────────────────────────────
  ● Subtitle language                  en
  ● Auto-select subtitles              on

  PROVIDERS
  ─────────────────────────────────────────
  ● Preferred provider                 crunchyroll
  ● Anime provider                     AllAnime

  ══════════ DANGER ZONE ══════════
  ─────────────────────────────────────────
  ● Clear watch history
  ● Reset all settings
  ● Remove all downloads
```

Indicator dots: `●` green = on, `●` gray = off, `●` amber = warning, `●` red = danger.

Section headers: amber uppercase. Danger Zone: red uppercase, full-width `══` rule.

---

### 2.7 Calendar

Day strip (always visible):

```
  ←  Mon  Tue  Wed  Thu  ◉Fri  Sat  Sun  →
```

- Today: amber `◉` filled
- Selected (other day): gray filled circle `●`
- `←` / `→` keys navigate days

Type filter tabs below strip:

```
  All  Anime  TV  Movies
```

Active tab: amber underline.

Time-slotted rows (times shown in user's local timezone):

```
  9:00 PM   ▸ Demon Slayer S4 E03
            ▸ Frieren S2 E01

  10:00 PM  ▸ Solo Leveling S2 E05
```

If a show has no confirmed time: listed under `  time tbd  ` at the bottom.

---

### 2.8 Help Menu

Four tabs: `Navigation   Playback   Commands   About`
Active tab: amber underline.

Each tab: `[key]  description` rows. Key in amber, description in default weight. No badges.

```
  Navigation   <u>Playback</u>   Commands   About

  space        pause / resume
  ←  →         seek 5 seconds
  [  ]         seek 85 seconds (op skip)
  s            toggle subtitle
  q            stop and return to browse
  / commands   open command palette
```

---

### 2.9 History Panel (/history)

Grouped sections: `Today` · `This Week` · `Earlier`

Row format:

```
  [poster]  Attack on Titan                  complete ●
            S01 E24 · watched 3h ago
            ██████████████████████████████  100%
```

- Poster: 32w × 46h cells. Real image (Kitty/Ghostty) or hash-color initial block.
- Progress bar: green fill for complete, amber fill for in-progress.
- Status: right-aligned, colored text (`complete` green, `in progress` amber, dim timestamp).

**Hash-color initial block:**

- Hash title string → index into [amber, teal, purple, pink]
- Render: colored background, white initial letter centered
- Never: plain gray placeholder, spinner inside poster cell

---

### 2.10 Continue Watching (/continue)

```
  [poster]  Attack on Titan               ▶ Resume
            S01 E03 — A Dim Light Amid...
            ░░░░░░░███████████████████    65%   episode

  [poster]  Demon Slayer                  ▶ Resume
            S03 E07 — Sword of Destruction
            ░░░░░░░░░░░░░░██████████████  48%   episode
```

- Sorted: most recent first
- Resume action: amber `▶ Resume` right-aligned
- Progress: amber partial fill

Empty state:

```
  ◌  nothing in progress
     search for a title to start watching
```

---

### 2.11 Details Panel

Two zones. Zone 1 always renders immediately from local cache. Zone 2 renders after async fetch.

**Zone 1 — Primary (instant):**

```
  [poster 32×46]  Attack on Titan
                  TV Series · 2013
                  Action · Dark Fantasy · Post-Apocalyptic

                  Humanity lives behind enormous walls,
                  defending against Titans — giant humanoid
                  creatures that devour people without...
```

**Zone 2 — Secondary (lazy, shimmer until loaded):**

```
  ┃ ◉ airing  ·  Season 4 ongoing                           ← teal left border

  progress      S01 E03  ·  12 of 96 episodes  ·  12%
  providers     crunchyroll  ·  AllAnime
  subtitles     en  ·  pt  ·  es  ·  de
```

Shimmer placeholder (before load):

```
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░░░░░░░░░░░░░░░░
  ░░░░░░░░░░░░░░░░░░░░░░
```

Shimmer implementation in Ink: static `░` character lines in `dimColor`. No animation required — the placeholder renders once and is replaced when data resolves. Width of `░` lines matches expected content width.

Series state banner is a left-border color strip (1 cell wide, full height of secondary zone):

- Teal border = airing `◉ airing`
- Green border = ended `✦ ended`
- Purple border = you finished this `✦ complete`
- Amber border = upcoming / not yet watched

Zone 1 never blank. If poster fails: hash-color initial block. If synopsis missing: dim `no synopsis available`.

---

### 2.12 Command Palette — Disabled State

Disabled item:

```
  ▸  [gray]  open downloads         [dim: requires active download]
```

- Background: `#1e293b55` (dark gray muted)
- Label: 35% opacity
- Key chip: gray (never amber)
- Reason: always visible when the item is highlighted — dim, right-aligned or below the label

Never hide why a command is disabled. Never fully suppress a disabled command from the list.

---

### 2.13 Diagnostics Panel (/diagnostics)

Five tabs: `Playback   Providers   Cache   Runtime   Events`

Active tab: amber underline.

All numeric values: tabular-nums.
All timestamps: `HH:MM:SS.ms` format, tabular-nums.
Memory values: `XX.X MB` suffix.

Footer action: `x export bundle` (amber `x`) — bundles logs, diagnostics snapshot, and session info.

---

### 2.14 Discover (/discover)

```
  Continue watching
  ▸ Attack on Titan  S01E03  65%
  ▸ Demon Slayer     S03E07  48%

  Airing today — Fri May 22
  9:00 PM   Frieren S2 E12
  10:00 PM  Solo Leveling S2 E05

  Because you watched Vinland Saga
  ▸ Berserk          ▸ Claymore      ▸ Vagabond

  Trending
  ▸ Dungeon Meshi    ▸ Delicious in Dungeon
```

Per-section reroll: `r` on section header reloads that section only. No full-page spinner.

Empty state (no history):

```
  ◈  nothing to discover yet
     watch something first to get recommendations
```

Fox mascot appears on empty state.

---

### 2.15 Downloads (/downloads) and Library (/library)

**Downloads:**

```
  Active
  ▸ Attack on Titan S01E03        ░░░░░░░░████████████  64%   ↓ 4.2 MB/s  ETA 0:43

  Queued
  2  Demon Slayer S03E07          queued
  3  Frieren S02E12               queued

  Completed
  ✓  Attack on Titan S01E01       1.2 GB   ↵ open
  ✓  Attack on Titan S01E02       1.1 GB   ↵ open
```

Progress bar: amber fill. ETA: tabular-nums. Speed: tabular-nums.

**Library (/library):**

```
  Attack on Titan  (3 episodes)
  ✓  S01 E01 — To You, 2000 Years Later    1.2 GB
  ✓  S01 E02 — That Day                   1.1 GB
  ✕  S01 E03 — A Dim Light Amid Despair   file missing   ↩ re-download

  Demon Slayer  (1 episode)
  ✓  S03 E07 — Sword of Destruction       880 MB
```

Broken artifact: red `✕` + `file missing` dim + amber `↩ re-download` action.

---

### 2.16 Onboarding

#### All deps found (fast path)

```
  ✓ mpv found  ·  ✓ ffmpeg found

  ┄ for best experience, use fullscreen  (recommended for 80+ col layout)

  ↵ continue
```

No blocking. Fullscreen nudge is inline banner only (dim, `┄` prefix).

#### Missing mpv (blocking)

```
  ✕ mpv not found

  kunai requires mpv to play video.

  macOS      brew install mpv
  Windows    winget install mpv
  Linux      sudo apt install mpv

  ↵ retry after installing
```

Retry: amber `↵`. No progress to main shell until mpv is found.

#### Persistent size chip in footer

When terminal is below recommended size, a dim chip appears in the footer:

```
  ...existing footer...   80×24 ←dim
```

Chip turns amber if below 80 cols (suboptimal layout) or below 60 cols (approaching blocker).

---

### 2.17 Error States

#### Provider timeout

```
  ◌  timed out after 30s
     crunchyroll did not respond

  ↻ retry   →  try different provider   q quit
```

#### Stream broken mid-playback

Non-blocking overlay, does not kill playback position:

```
  ⚠  stream interrupted · reconnecting...   attempt 2/3
```

Auto-dismisses on recovery. After 3 failed attempts, escalates to blocking state.

#### Network offline

```
  ○  offline

  /library to watch downloaded content
  /continue to see your downloads
```

#### Title unavailable on any provider

```
  ◌  Attack on Titan not found on any provider

  ↻ check again   w add to watchlist   q quit
```

---

### 2.18 Narrow Mode (60-79 cols)

#### Browse

- Companion pane hidden
- Footer collapses: `↵ play   / commands   q quit`
- List takes full width

#### Post-playback

- Single column, up-next dominant
- Recommendations shelf hidden (accessible via `/ commands` → discover)

#### Calendar

- 3-day strip (yesterday / today / tomorrow)
- Type filter hidden (accessible via `/` filter command)

#### Resize Blocker (< 60 cols OR < 20 rows)

```
  terminal too narrow
  resize to at least 60 × 20
  current: 52 × 24
```

Block is non-dismissable. Clears automatically on SIGWINCH when dimensions meet minimum.

---

## Part 3 — Component Contracts

### 3.1 Viewport Policy Contract

- Single hook: `use-viewport-policy.ts`
- Sole source of terminal dimensions — no other file may call `process.stdout.columns` or Ink's `useStdout()` for layout decisions
- Emits: `{ width: number, height: number, breakpoint: 'narrow' | 'medium' | 'wide' | 'blocked' }`
- Breakpoints:

| Name    | Columns      | Rows | Notes                            |
| ------- | ------------ | ---- | -------------------------------- |
| narrow  | 60-79        | ≥ 20 | companion hidden, footer compact |
| medium  | 80-119       | ≥ 20 | companion below, no poster       |
| wide    | 120+         | ≥ 20 | companion right pane, poster     |
| blocked | < 60 or < 20 | any  | resize blocker shown             |

- SIGWINCH: Ink re-renders on resize automatically; the hook recalculates breakpoint on every render
- Mac default window: ~80 cols. Fullscreen 13": ~220 cols. Windows terminal default: ~120 cols.
- Onboarding tip: "for best experience, use fullscreen" is suggested but not enforced

### 3.2 Shell Frame Invariant

- `ShellFrame` (outer round border + header + footer) never remounts between shells
- Browse → Loading → Playing → Post-play: only the content area swaps
- Footer and header persist through all content state changes
- Exit sequence is the only case where the shell frame unmounts

This means: no full-screen flicker on state transitions. All transitions are content-area-only.

### 3.3 Exit Sequence

```
t=0ms    render all text in dimColor (Ink's color-muted equivalent of opacity 50%)
t=40ms   footer Text unmounts (content area only — not the box)
t=80ms   fox reaction: "◉  see you next time"
t=120ms  closing line: "◈  kunai"
t=200ms  process.exit(0)
```

Each step is a discrete React render via a `setTimeout` state update — not a CSS animation.

Ctrl+C after exit starts: skips directly to t=40ms behavior (footer drop + immediate exit).

### 3.4 History Poster System

- Cell dimensions: 32 wide × 46 tall
- Protocol detection order: Kitty → Ghostty → text fallback
- Real image: rendered via detected protocol, debounced (do not re-render on every keypress)
- Fallback (text):
  1. Hash title string (e.g., djb2 or FNV) → index 0–3 → map to [amber, teal, purple, pink]
  2. Render: solid color block 32×46 cells
  3. Overlay: white initial letter of title, vertically and horizontally centered

Never: plain gray empty block, spinner running inside poster cell, blank whitespace placeholder.

---

## Part 4 — Anti-Patterns

### AP-1: Bordered status chrome in footer

```diff
- [ ⬡ Discord ]  [ ◉ Airing ]  [ Anime ]   ← buttons, chrome, "AI slop"
+ ⬡ discord  ·  ◉ airing  ·  anime         ← typography, color carries signal
```

Applies to: footer, context strip, header status line, any informational status row.

### AP-2: Repeating state across all zones

If the title is in the header context strip, it does not also go in every episode row body, the footer, and the companion pane simultaneously. One zone owns each piece of state.

### AP-3: Diagnostic data in normal flows

Provider resolution logs, raw stream URLs, HTTP status codes, timing breakdowns, retry counts — none belong in: post-playback, loading screen footer, or any surface the user sees without explicitly opening diagnostics.

### AP-4: Full-page spinner for sub-section refreshes

If only the recommendations section is reloading, animate that section. Do not blank the entire screen.

### AP-5: Same box-drawing style on nested surfaces

Ink uses box-drawing characters, not CSS border-radius. But the principle applies: if the outer shell uses `borderStyle="round"` (`╭╮╰╯`), an inner card should use `borderStyle="single"` (`┌┐└┘`) — not another round border. Matching styles on nested surfaces flattens depth.

### AP-6: Misusing Ink dimColor for decoration

Ink has no CSS transitions. State changes are instant. The one "animation" available is cycling `dimColor` on `░` characters for shimmer, or stepping through opacity-equivalent hex values for the exit sequence dim. Do not try to CSS-transition Ink — describe state changes as discrete render steps.

### AP-7: Badges where type is self-evident from context

In the episode picker, every row is an episode. No TYPE badge needed. In the settings panel, every row is a setting. In the loading screen, every line is a stage. Badges only where type is genuinely ambiguous.

### AP-8: Numbers without tabular-nums

Any number that updates dynamically (speed, percentage, timestamp) must use tabular-nums to prevent layout shift.

---

## Part 5 — Out of Scope (This Pass)

The following were requested in the same session but are separate deliverables:

- **README for easy install** — separate doc, after this pass ships
- **Launch video brief** — separate doc, covers feature narrative arc
- **Web / desktop surfaces** — future milestone, not in beta v1
- **Paid compute / relay architecture** — separate plan ([.plans/kunai-architecture-and-cache-hardening.md](../.plans/kunai-architecture-and-cache-hardening.md))
- **Advanced search input redesign** — tracked in [.plans/advanced-search-input.md](../.plans/advanced-search-input.md)
- **Playlist and queue UI** — tracked separately

These are noted here so the implementation plan has clear edges. Do not block the redesign pass on them.

---

## References

- [design-system.md](./design-system.md) — token values and color helpers
- [ux-architecture.md](./ux-architecture.md) — hotkey philosophy, overlay behavior, shell flow
- [ui-redesign-playbook.md](./ui-redesign-playbook.md) — layout rules, priority order for redesign passes
- [poster-image-rendering.md](./poster-image-rendering.md) — Kitty/Ghostty protocol implementation
- [.plans/daily-use-ux-discovery-and-runtime-hardening.md](../.plans/daily-use-ux-discovery-and-runtime-hardening.md) — active UX hardening milestones
- [.plans/fullscreen-root-shell-redesign.md](../.plans/fullscreen-root-shell-redesign.md) — shell frame architecture
