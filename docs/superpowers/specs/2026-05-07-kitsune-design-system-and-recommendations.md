# Kitsune Design System + Recommendations Feature

Date: 2026-05-07
Status: Approved for implementation

## Scope

Two tightly related deliverables:

1. **Kitsune design token system** — a shared token layer that formalizes the existing `shell-theme.ts` palette, extends it with anime/violet semantics, and creates a single source of truth consumable by both the CLI (ANSI/Ink) and future web (CSS custom properties).

2. **Recommendations & Discover feature** — a lazy-loaded, opt-in discovery surface powered by TMDB and local watch history. Surfaces in a `/discover` command, a post-playback nudge on series completion, and an optionally-configured startup hint. Does not block startup or make network calls unless explicitly triggered.

---

## 1. Design Token System

### Goals

- One canonical token definition; CLI and web each consume it in their native format
- No values duplicated between `design.ts`, `shell-theme.ts`, and any future web theme
- New `violet` token for anime secondary accent; amber remains primary brand/action
- Tokens are the floor: callers may derive from them but should not define new raw hex values outside the token layer

### Token Package: `packages/design`

New Turborepo package `@kunai/design`. Exports one file: `tokens.ts`.

```ts
// packages/design/src/tokens.ts
export const tokens = {
  // backgrounds
  bg:              "#17130f",
  surface:         "#211a14",
  surfaceElevated: "#2b2219",
  border:          "#3a2e24",
  borderDim:       "#2a2018",

  // primary brand — amber / fox
  amber:           "#f6a23a",
  amberDim:        "#a66b22",
  amberGlow:       "rgba(246,162,58,0.12)",

  // anime / secondary accent — violet
  violet:          "#b08cff",
  violetDim:       "#7055bb",

  // status
  teal:            "#67d8d4",
  tealDim:         "#3a8a87",
  green:           "#8fd36a",
  red:             "#ff6b5f",
  rose:            "#d9a06f",

  // text scale
  text:            "#f4eadf",
  muted:           "#b6a696",
  dim:             "#8f8173",
  faint:           "#5a4e44",
} as const;

export type TokenName = keyof typeof tokens;
```

### CLI consumption

`apps/cli/src/app-shell/shell-theme.ts` imports from `@kunai/design` and re-exports as Ink-compatible `palette`:

```ts
import { tokens } from "@kunai/design";

export const palette = {
  ...tokens,
  // Ink uses hex strings directly — tokens are already hex, no adaptation needed
} as const;
```

`apps/cli/src/design.ts` updates `clr` helpers to add `violet` and `teal`:

```ts
clr.fox     // amber — hotkeys, CTA, brand mark
clr.violet  // anime badges, secondary accent
clr.teal    // status, input cursor, info
```

### Web consumption

A build step (or simple TS script) in `packages/design` generates `tokens.css`:

```css
:root {
  --k-bg:           #17130f;
  --k-surface:      #211a14;
  --k-amber:        #f6a23a;
  --k-violet:       #b08cff;
  /* ... all tokens */
}
```

The web app imports this file. No token values appear in component CSS — only `var(--k-*)` references.

### Accent semantics (enforced by convention, not compiler)

| Token    | Role                                      |
|----------|-------------------------------------------|
| amber    | Hotkeys, active selection border, CTA, brand mark `⬡` |
| violet   | Anime/content-type badges, secondary highlights |
| teal     | Status dots, input cursor, info messages  |
| green    | Success, healthy, completed               |
| red      | Error, failed, degraded                   |

---

## 2. Shell Design Language

### Frame model

All screens share one outer frame: `AppRoot` owns the border, header row, and footer strip. Child surfaces (browse, playback, picker, discover) render into the content region only — no nested full-width borders.

Header row:
```
⬡ kunai  ‹mode›  provider  ·  provider   ● status
```

Footer strip: amber hotkeys, muted labels, task-first phrasing.

### Border model

- One `╭╮╰╯` rounded border at the outer shell level
- One inner `├┤` separator between header/content and content/footer
- Pickers and overlays use a nested box anchored inside the content region — no additional outer frame
- Command palette is an inset overlay with amber-glow left border on the active item

### Picker design

- Title + subtitle at top
- Filter input immediately below (always visible, not toggled)
- Separator line
- Scrollable option list, active item full-width highlight
- Short orientation line in footer: `↵ select  esc back  / commands`

### Content type badges

Anime content shows a `violet` `anime` badge inline in result rows. Movie/series use `muted` text labels. This replaces emoji-only type indicators in dense list contexts.

---

## 3. Recommendations & Discover Feature

### Design principles

- **Startup is never affected.** No network calls on launch. No data is prefetched until explicitly triggered.
- **Opt-in everywhere.** Post-playback nudge is a menu item, not a prompt. Discover screen is slash-command-accessible, never default home.
- **Configurable startup hint.** A config option `discover.showOnStartup: boolean` (default `false`) shows a dim footer hint `/ discover` when history is non-empty.

### Data sources

| Signal                  | API / Source                          | When fetched             |
|-------------------------|---------------------------------------|--------------------------|
| "Because you watched X" | TMDB `/tv/{id}/recommendations`       | On Discover open, per-title |
| "Because you watched X" | TMDB `/movie/{id}/recommendations`    | On Discover open, per-title |
| Trending this week      | TMDB `/trending/all/week`             | On Discover open         |
| Genre affinity          | Local history + TMDB `/discover/tv`   | On Discover open         |

Genre affinity: scan completed titles in history → collect genre IDs from TMDB detail cache → rank top 2-3 genres → fetch `/discover/tv?with_genres=...&sort_by=vote_average.desc`.

### Surfaces

**1. `/discover` command (primary)**

Opens the Discover screen as a full content-region view. Three sections, each a navigable list:

- "Because you watched {most recently completed title}"
- "Trending this week"
- "Top in {top genre} · from your watch pattern"

Keyboard: `↑↓` navigate within section, `Tab` jump to next section, `↵` open in browse, `r` refresh, `esc` back.

**2. Post-playback nudge on series complete**

When the last episode of a series is marked completed, the post-playback action list gains a first item:

```
⬡  see what's similar
```

Selecting it opens the Discover screen pre-filtered to "Because you watched {title}". A dim hint line below the action list reads `recommendations ready · / discover` for users who dismiss and want to come back.

**3. Manual trigger at any time**

`/ → recommendations` or `/ → discover` from any screen.

**4. Configurable startup hint (opt-in)**

When `discover.showOnStartup: true` and history is non-empty, the browse screen footer shows a faint extra line:

```
/ discover  ·  based on your history
```

No network call happens until the user opens Discover.

### Service architecture

New service: `apps/cli/src/services/recommendations/RecommendationService.ts`

```ts
export interface RecommendationSection {
  label: string;
  reason: "similar" | "trending" | "genre-affinity";
  items: SearchResult[];
}

export interface RecommendationService {
  getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection>;
  getTrending(): Promise<RecommendationSection>;
  getGenreAffinitySection(history: HistoryEntry[]): Promise<RecommendationSection>;
}
```

Implementation (`RecommendationServiceImpl`) uses the existing TMDB key and proxy from `apps/cli/src/tmdb.ts`. Results are cached in the existing `CacheStore` with a 24h TTL for similar/genre and 6h for trending.

### Configuration additions

In `ConfigService`:

```ts
discover: {
  showOnStartup: boolean;   // default false
  refreshOnOpen: boolean;   // default true — re-fetch stale results on each Discover open
}
```

---

## 4. What is Not In Scope

- Web implementation of Discover (uses the same token layer, but the React/web component is a separate effort)
- Account-based cross-device recommendation sync (deferred to v3 metadata + sync plan)
- AniList recommendations (deferred — TMDB covers anime adequately through AllAnime/Miruro title IDs)
- Personalisation beyond genre affinity + direct similar (no ML, no collaborative filtering)
- Making Discover the default home screen (explicitly deferred — browse with blank search stays default)

---

## 5. Implementation Order

1. `packages/design` token package — zero runtime impact, purely additive
2. Update `shell-theme.ts` and `design.ts` to import from `@kunai/design`; add `violet` + `teal` to `clr`
3. Apply shell design language: frame model, border cleanup, badge semantics (scoped to ongoing fullscreen-redesign slices)
4. `RecommendationService` + TMDB endpoints + cache wiring
5. Discover screen component
6. Post-playback series-complete nudge
7. `/discover` command registration
8. Config additions (`discover.showOnStartup`, `discover.refreshOnOpen`)
