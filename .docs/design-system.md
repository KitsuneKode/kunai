# Kunai — Terminal Design System (Sakura)

Use this doc when changing terminal styling, color, tokens, layout primitives, or interaction presentation. It is the design contract; source code is the implementation truth. Keep it lightweight — enough to preserve coherence, not so strict it blocks better UI.

Visual reference prototypes live in [`.design/cli/kunai-sakura.html`](../.design/cli/kunai-sakura.html) (feel tour) and [`.design/cli/kunai-sakura-systems.html`](../.design/cli/kunai-sakura-systems.html) (onboarding, calendar, library, queue). The rollout is tracked in [`.plans/sakura-rollout.md`](../.plans/sakura-rollout.md).

## Source of Truth

- `packages/design/src/tokens.ts` owns shared token values (sRGB hex, tuned from an oklch source).
- `apps/cli/src/app-shell/shell-theme.ts` adapts tokens into the `palette` consumed by Ink surfaces, plus `statusColor`, `contentTintColor`, `heatColor`.
- `apps/cli/src/menu.ts` owns legacy ANSI helpers tied to interactive flows.

Do not duplicate raw hex anywhere else. New code references semantic palette names.

## The Theme: Sakura

A dusk-plum surface with a two-note color chord:

- **Rose** — everything you act on: focus, selection, brand, in-progress.
- **Mint** — everything ready or done: available, complete, healthy. Rose's complement.

A vivid **alarm red** is held back for real, actionable errors — deliberately brighter and more saturated than the soft rose so an error never reads as "just part of the theme". A single plum is reserved for the series-complete milestone and nothing else.

## THE ONE RULE

**Color encodes state or focus — never identity.**

Titles win by _weight_ (bright + bold), not by hue. Provider, audio language, episode codes, and recency are muted text. A list never goes rainbow.

The single exception: **media-type hue** (anime / series / movie) is allowed **only on the Stats surface**, where "type" is literally the data being charted (`contentTintColor`, the paint-mix heatmap). Everywhere else, type is a muted label or glyph.

## Semantic Tokens

Prefer these names in all new code:

```ts
// surfaces (dusk plum, faintly rose-tinted)
tokens.bg  tokens.surface  tokens.surfaceElevated  tokens.surfaceActive  tokens.raised
tokens.line  tokens.lineSoft  tokens.lineStrong  tokens.scrim

// accent — rose, two-step for depth
tokens.accent       // focus · selection · brand · in-progress
tokens.accentDeep   // progress fill (gives bars body)
tokens.accentSoft   // hairline / whisper
tokens.accentFill   // pre-blended onto bg for selection / badge depth

// state
tokens.ok      tokens.okDim      // ready · complete · available (mint)
tokens.danger  tokens.dangerDim  // real, actionable error (crimson)
tokens.milestone                 // series-complete only (plum)

// text ramp — carries ~80% of hierarchy
tokens.text  tokens.textDim  tokens.muted  tokens.dim  tokens.faint

// media-type hues — STATS SURFACE ONLY
tokens.typeAnime  tokens.typeSeries  tokens.typeMovie  tokens.typeMixed
tokens.heatRamp   // rose, 5-step
```

Use the helpers, not raw tokens, where one exists:

- `statusColor(tone)` — `success → ok`, `warning → accentDeep`, `error → danger`, `info`/`neutral → muted`.
- `contentTintColor(kind)` — type hue; **Stats only**.
- `heatColor(index)` — clamps into the rose ramp.

### Deprecated color-named tokens

`amber*`, `pink*`, `teal`/`cyan`, `info*`, `lavender*`, `green*`, `red*`, `yellow*`, `purple*`, `border*`, `gray` still resolve (aliased to the semantic values) so surfaces build during migration. **Do not introduce new uses.** Migrate call sites to the semantic name shown in the `tokens.ts` / `palette` comments and delete the alias when a family is fully migrated (tracked in `.plans/sakura-rollout.md`).

## Layout Primitives

```ts
sep(width?)  headerLine(title, sub?)  shortcuts(pairs)
progressBar(current, total, width?)  statusLine(items)  startSpinner(label)
box.tl box.tr box.bl box.br box.h box.v
```

Keep these composable; screen-specific policy lives in the caller.

### Shared shell components (Sakura rollout)

- **`ClaudeTabRow`** (`apps/cli/src/app-shell/primitives/ClaudeTabRow.tsx`) — tier-1 tabs with `accentFill` active pill; used on History, Calendar type filters, and Stats. Prefer over ad-hoc tab text.
- **`MediaListShell`** — list + `PreviewRail` two-pane layout; collapses rail on narrow terminals. Browse, Calendar, History, Discover, and Library queue rows should compose through it.
- **`ListRow` / `SectionGroup` / `ResumeCard`** — History makeover list rhythm (title · ep · status · recency) with resume card under selection.
- **Calendar (locked)** — visual authority: [`.design/cli/kunai-sakura-calendar-locked.html`](../.design/cli/kunai-sakura-calendar-locked.html). Shipped shape: `ClaudeTabRow` type tabs + horizontal day strip + unified schedule rows (`calendar-ui.tsx`). Calendar is always scoped to one selected date (today or the first available date); it is not an all-days or week view.
- **Discover** — hybrid list + preview rail per [`.design/cli/surfaces/recommendations-viewer.md`](../.design/cli/surfaces/recommendations-viewer.md); section header + **emphasized reason line** (`discover-reason.ts`) in the list, reason echoed in the rail note.
- **Return loop copy** — shared strings in `return-loop-copy.ts` for browse idle “Unwatched releases”, calendar empty tail, history new-episodes section “Ready for you now”, and post-play caught-up calendar action.

F1 layout captures: `bun apps/cli/test/harness/capture-*.tsx` → `apps/cli/test/__captures__/*.txt` (see `render-capture.ts`).

## Shell UX Standard

Kunai feels like a calm, fast media command shell: content-first in normal use, diagnostic-rich only when asked.

- Put the title/active task in the strongest position; everything else supports that one job.
- One compact context strip per screen for stable state (provider, mode, episode, filters). Do not repeat the same fact in header, badges, detail lines, and footer.
- Selection: a rose left rule (`▌`) + `accentFill` band. Unselected rows are calm (no fill, two-space prefix).
- Progress: `accentDeep → accent` fill while in-progress; settles to `ok` on complete, `danger` on failure — so color alone reads state.
- Badges only for active filters, warnings/errors, and actionable exceptional state. Never badge rendering state (poster loading/ready, selection preview).
- Missing data stays honest but quiet (dim placeholder) unless it blocks the task.
- Footer teaches live actions: prefer 3–4 shortcuts plus `[/] commands`; never duplicate footer instructions in companion panels.

## Surface Contracts (states every surface owns)

Loading · success · empty · error — see [.design/cli/02-state-ux.md](../.design/cli/02-state-ux.md). Failure/recovery surfaces (`playback did not start`, `stream stalled`, `no source`, `provider degraded`, diagnostics) are first-class, not afterthoughts — they are where a scraper app earns trust.

## Portability (degradation order)

The design must read on a plain terminal, not only Kitty + truecolor + 178×41.

- **Poster**: rendered image → letter/initials tile → hidden. Reserve the slot before load; metadata anchored below never jumps.
- **Color**: truecolor hex → 256-color → 16-color fallback. Token resolution owns this mapping (see rollout plan).
- **Width**: preview rail collapses before the primary list; on narrow/SSH/tmux keep brand · mode · status, the list/input, and `[/] commands`.
- **Text**: long romaji/CJK titles truncate cleanly; never reflow the layout. Account for CJK double-width when aligning columns.

## Accessibility

Color is always paired with a glyph or word (`✓ complete`, `✗ failed`, `● ready`), so state survives color-blindness and 16-color terminals. Keep accent/text contrast within readable range on the dusk-plum base.

## Migration Note

If future web/desktop surfaces consume this identity, keep the semantic layer intact: token naming, the one rule, spacing/box conventions, and fast-scan low-breakage behavior carry forward. See [.plans/sakura-rollout.md](../.plans/sakura-rollout.md) and [.plans/ink-migration.md](../.plans/ink-migration.md).
