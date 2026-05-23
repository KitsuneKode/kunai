# Kunai CLI Design Reference Bundle

Generated from `.design/cli` on 2026-05-23. Source code remains the truth; this bundle exists so another design or implementation agent can ingest the current CLI design direction in one file.

Canonical visual direction: Sakura. Rose is focus/progress/action, mint is ready/complete/playable, crimson is real failure, and media-type hues are restricted to Stats/data visualization. Calendar distinguishes broadcast state from provider availability.

---

## 00-principles.md

# Kunai CLI Design Principles

Source code is the implementation truth. These specs are the design contract for the next CLI UI pass and should be updated when the shipped UI changes.

## Product Feel

Kunai should feel like a premium media command shell: fast, calm, keyboard-native, and rich only where richness helps a decision.

The user-facing audience is closer to a streaming product than a developer tool. The interface should help people search, choose, play, recover, and continue watching with low cognitive load.

## Core Rule

Every screen has one primary job. Everything visible must support that job.

If information is useful but not needed now, move it to one of:

- selected preview rail
- details sheet
- command palette
- diagnostics
- scrollable secondary region

Do not make normal screens feel like logs, dashboards, or provider inspectors.

## Information Hierarchy

- Header: identity, mode, compact context, readiness/error state.
- Body: the actual decision or current state.
- Preview rail: confidence about the selected item.
- Footer: repeated actions only.
- Command palette: less frequent or scoped commands.
- Diagnostics: evidence, internals, and failure investigation.

## Screen Budget

- One major mode chip per screen.
- Four visible footer actions plus `[/] commands` is the comfort ceiling.
- Prefer one selected row and one selected preview over many equal-weight regions.
- Use posters/thumbnails for orientation, not decoration.
- Hide images before hiding critical text.

## Anti-Overload Rules

- Do not repeat the same fact in header, body, preview, and footer.
- Do not show provider internals unless they affect a user decision or diagnosis.
- Do not turn every metadata value into a badge.
- Do not use fake cards or component-note cards as product UI.
- Do not add full boxes around every group. Use spacing, alignment, muted bands, and line rhythm first.
- Do not let a modal become a portal to the whole app.

## Visual Identity

Canonical direction: `Sakura`.

Kunai uses a dusk-plum base with a tight two-note chord:

- Rose for brand, focus, selected rows, primary keys, active progress, and in-progress states.
- Mint for ready, playable, available, attached, complete, and finished states.
- Crimson for real actionable failure only.
- Warm text ramp for titles, body, metadata, and unavailable/lower-confidence text.

This replaces the earlier amber/teal exploration. The goal is not more color. The goal is stronger identity with less cognitive load.

The palette should stay restrained. Color communicates state and action, not decoration.

### Sakura Tokens

- Background: dusk plum, near black but not pure black.
- Surface: slightly lifted dusk plum for headers, footers, selected row bands, and preview rails.
- Text: warm rose-white for titles and important values.
- Body: muted warm gray/rose for normal copy.
- Dim: lower-confidence, unavailable, later, and secondary metadata.
- Rose: brand, selected row marker, active tab, primary footer key, in-progress, expected-today, active playback/progress.
- Rose-deep: determinate progress fill.
- Rose-soft: hairline accents only.
- Mint: meaningful success, playable/ready/available, subtitle attached, download ready, episode complete.
- Crimson: failed, missed, blocked, broken, action required.

### Color Discipline

- Rose is not decoration. If everything is rose, hierarchy collapses.
- Mint is reserved for actual readiness or completion. Do not use it for neutral positive copy.
- Crimson is rare. Do not use it for absence, disabled, or low-priority states.
- Media-type hues are allowed only in Stats data visualization. Normal lists, pickers, calendar rows, playback surfaces, and command palettes must not become color-coded by anime/series/movie.
- Provider/source details stay muted unless they are the selected object or the user's current decision.
- Metadata should usually be text-ramp hierarchy, not color.

## Glyph Rules

Use glyphs when they improve scan speed or state recognition. Do not use glyphs just to make the UI look designed.

Good candidates:

- `[▶ n]` next/play
- `[◀ p]` previous
- `[↻ r]` replay
- `[☰ e]` episodes
- `[≋ t]` tracks
- `[⌕ s]` search
- `[/]` commands

State glyphs belong in body/status facts:

- `● ready`
- `✓ complete`
- `△ warning`
- `× failed`

Text labels must carry meaning even if glyphs render poorly.

## Terminal Constraints

Kunai should look good in a normal monospace terminal. Recommended fonts may improve screenshots, but the CLI must not depend on one.

Design for:

- Kitty, Ghostty, Alacritty, WezTerm, tmux, SSH.
- Terminals without image support.
- Narrow and medium terminal sizes.
- Stable dimensions to avoid flicker.

## State Contract

Every major surface needs designed states:

- loading
- success
- empty
- error

Loading should be subtle and non-blocking. Error states should be actionable. Empty states should suggest the next best action without becoming tutorial copy.

---

## 01-shell-footer-contract.md

# Shell And Footer Contract

The shell frame is the shared visual language across playback, browse, pickers, calendar, history, library, and system panels.

## Header

Header grammar:

```text
🦊 Kunai · [Mode] · context · compact facts                     ● status · size
```

Mode chips are reserved for major surfaces:

- Browse
- Search
- Now Playing
- Post-play
- Episodes
- Tracks
- Recommendations
- Calendar
- History
- Library
- Downloads
- Settings
- Diagnostics

Do not chip every fact. Context facts such as provider, title, episode, hardsub, or mode should be plain text unless they are the major mode.

## Body

The body owns the current decision:

- Search: enter query or choose a result.
- Calendar: choose a release.
- Playback: understand current episode and session health.
- Post-play: decide what to do next.
- Tracks: inspect/change stream setup.

Body content should not duplicate footer instructions.

## Footer

Footer grammar:

```text
[key] label   [key] label   [/] commands                         Surface
```

Rules:

- Maximum four visible primary actions plus `[/] commands`.
- Use brackets around keys to avoid run-on command sentences.
- Show repeated actions only.
- Move secondary actions into command palette.
- Collapse secondary footer actions first on smaller terminals.

Examples:

```text
[↑↓] select   [enter] open   [m] similar   [/] commands
[space] pause   [q] stop   [☰ e] episodes   [≋ t] tracks   [/] commands
[tab] type   [←→] day   [enter] open   [shift+enter] details   [/] commands
```

## Footer vs Palette

Footer teaches what the user will repeatedly do on that screen.

Command palette exposes:

- less frequent actions
- scoped commands
- configuration toggles
- diagnostics or global exits where appropriate

## Responsive Rules

Wide:

- Show primary list/content and preview rail.
- Footer can show four actions plus commands.
- Header can show provider, title, episode, and one or two compact facts.

Medium:

- Hide image/poster before hiding text.
- Preview rail may collapse into a toggled details surface.
- Footer drops secondary actions.

Small:

- Header keeps brand, mode, status.
- Body keeps the primary list/input.
- Footer can collapse to `[/] commands` and `[?] help`.

## Flicker And Stability

Stable dimensions are required for:

- shell frame
- footer
- selected rows
- preview rail
- poster/thumb cells
- progress bars
- loading/error/empty states

Dynamic text truncates instead of shifting layout.

## Preview Rail Stability

Preview rails must reserve stable poster/thumb space even while media is loading.

Rules:

- Poster area has a fixed row/column budget for the current terminal size.
- Metadata starts below the reserved poster area, not below the actual rendered image height.
- Loading, missing, failed, and rendered poster states all occupy the same layout slot.
- If image rendering is delayed, show a quiet `Loading poster...` line or placeholder inside the poster slot.
- Do not let title, overview, facts, or action rows jump when the image appears.
- On small terminals, hide the poster slot first and keep metadata stable.

---

## 02-state-ux.md

# State UX Contract

Every user-facing surface must have designed loading, success, empty, and error states. Generic fallback text is not acceptable for primary flows.

The goal is not to show more information. The goal is to keep the user oriented and give one good next action.

## Global State Rules

### Loading

Loading should be calm, stable, and specific.

- Keep the shell/header/footer stable.
- Show what is being loaded in plain language.
- Use subtle progress/dot/step indicators only when they clarify the wait.
- Avoid noisy bootstrap dashboards.
- Do not move the layout when loading completes.

Good:

```text
Resolving stream...
Searching TMDB...
Loading poster...
Fetching calendar...
```

Bad:

```text
Loading...
Please wait...
provider scrape resolve cache subtitle status startup wait...
```

### Success

Success should usually be quiet.

- Do not celebrate every normal state.
- Use mint only for meaningful ready/available/playable/complete states.
- Use rose for active focus, active progress, and expected-near-term states.
- Use crimson only for actionable failure.
- Prefer stable body updates over banners.
- Toasts are only for short-lived confirmations.

### Empty

Empty states should answer:

1. What is empty?
2. Why might it be empty?
3. What is the next best action?

Keep copy short. Do not teach the whole app.

### Error

Errors should be actionable and scoped.

Show:

- what failed
- whether user can retry
- one or two recovery actions
- diagnostics only as a secondary action

Do not show raw provider traces in normal UI.

## Playback Family

Surfaces:

- active playback
- post-playback
- playback issue
- tracks panel
- episode/season picker

### Loading

Active playback startup may show a compact trail:

```text
search -> scrape -> resolve -> play
```

After playback starts, compress or hide the trail. Active playback becomes the episode control surface.

### Empty

Examples:

- no next episode
- no track alternatives
- no subtitle choices exposed
- no watched progress

Empty should not open dead pickers. Show the fact and keep action available elsewhere.

### Error

Playback errors are first-class states:

- `Playback did not start`
- `Stream stalled`
- `No source available`
- `Quality variants unavailable`
- `Subtitles failed to attach`

Promote recovery actions only while relevant:

```text
[r] recover   [f] fallback   [≋ t] tracks   [/] commands
```

When healthy, keep recovery/fallback in commands.

## Search And Browse

### Loading

Keep the one-line query visible.

Use focused loading copy:

```text
Searching "The Boys"...
Loading poster...
Checking availability...
```

Provider availability may load lazily. Do not block result selection on poster or availability.

### Empty

Search empty:

```text
No results for "The Boys"
Try fewer words, switch mode, or open filters.
```

Filter empty:

```text
No results match this filter
Clear result filter or return to all results.
```

Continue watching empty:

```text
Nothing in progress
Search for a title or open trending.
```

### Error

Search errors should distinguish:

- metadata source failed
- provider availability failed
- poster failed
- partial results available

If partial results exist, show them and mark the degraded source quietly.

## Calendar Family

Calendar states must separate broadcast/release timing from provider availability.

- `available` means Kunai can reasonably open or resolve the episode now.
- `aired · resolving` means the episode has broadcast, but no playable provider result is ready yet.
- Countdown states should use relative time for same-day releases, such as `in 3h 20m`.
- Calendar should prioritize the return loop: tracked shows, saved titles, and `new since E#` context before generic releases.

Do not send users into a dead playback attempt from an `aired · resolving` row. Offer details, refresh, track/untrack, or wait-copy instead.

## Details Sheet

Details should be scrollable and resilient to missing metadata.

### Loading

- Reserve poster slot.
- Load text first.
- Poster/trailer/cast can fill in later.

### Empty/Missing Metadata

Dim missing optional fields:

```text
Trailer unavailable
Cast unavailable
Episode count unknown
```

Do not fail the entire details sheet for optional metadata.

## Calendar

### Loading

Keep tabs/day controls stable and show:

```text
Fetching releases for Today...
```

If cached data exists, show stale cache with a quiet refresh status.

### Empty

Calendar empty should be type/day-specific:

```text
No anime releases today
Try Tomorrow, This week, or All.
```

### Error

Calendar errors should distinguish:

- schedule source failed
- provider availability failed
- partial day data available

If schedule loads but availability does not, still show release rows.

## Recommendations

### Loading

Show the context:

```text
Finding picks after MARRIAGETOXIN...
```

Do not block PPS primary actions while recommendations load.

### Empty

```text
No recommendations yet
Watch more titles or search for something new.
```

### Error

If recommendation service fails, PPS should still be usable:

```text
Recommendations unavailable
Search, calendar, and history still work.
```

## Downloads / Library / History

These utility surfaces should be quieter and more operational.

- Empty states should point to the action that creates data.
- Errors should include a diagnostics path.
- Loading should preserve list/header/footer layout.

Examples:

```text
No downloads queued
Queue downloads from playback or details.

No watch history yet
Start watching and progress will appear here.
```

---

## 03-component-boundaries.md

# Component Boundaries And State Ownership

This document defines the reusable UI units for the CLI redesign. The goal is to prevent local one-off components from recreating shell, footer, list, picker, and preview behavior differently on every screen.

## Rule

Shared behavior belongs in shared primitives. Screen files provide view models and surface-specific copy.

Do not create separate list, footer, preview, or picker systems per screen.

## Shared Primitives

### ThemeTokens

Owns semantic role names, not raw colors:

- background, surface, line, text, body, muted, dim
- rose, roseDeep, roseSoft
- mint, mintDim
- crimson
- statsAnime, statsSeries, statsMovie

Rules:

- Sakura is the canonical direction.
- Rose means brand, focus, selected rows, primary keys, active progress, and in-progress states.
- Mint means ready, available, attached, complete, and playable.
- Crimson means real actionable failure.
- Media-type hues are confined to Stats and charts. Do not turn normal browse/search metadata into a rainbow.
- Screen code should consume token roles. Do not hardcode exploration colors inside surfaces.

### ShellFrame

Owns:

- outer frame
- header slot
- body slot
- footer slot
- responsive width/height constraints

Does not own:

- surface-specific state
- command availability
- data fetching

### ModeChip

Owns:

- rendering the current major mode
- consistent chip shape

Does not own:

- arbitrary badges
- status facts

### Footer

Owns:

- `[key] label` grammar
- action truncation/collapse
- max visible action count
- right-side surface label

Input:

```ts
type FooterAction = {
  key: string;
  label: string;
  glyph?: string;
  priority: "primary" | "secondary";
  disabled?: boolean;
};
```

Rules:

- Render primary actions first.
- Hide secondary actions first on smaller terminals.
- Always preserve `[/] commands` when commands exist.

### MediaList

Owns:

- selected row styling
- keyboard row geometry
- title/detail/state alignment
- scroll window

Input should be a view model, not raw provider data:

```ts
type MediaListRow = {
  id: string;
  title: string;
  detail?: string;
  state?: string;
  tone?: "normal" | "success" | "warning" | "danger" | "info" | "muted";
  disabled?: boolean;
};
```

Used by:

- search results
- recommendations
- trending/browse
- history-like lists where media selection is primary

### PreviewRail

Owns:

- poster/thumb slot
- stable poster loading state
- selected title/details/facts
- collapse behavior

Rules:

- reserve poster slot before image load
- metadata anchors below poster slot
- hide image before metadata
- do not fetch data directly

Input:

```ts
type PreviewRailModel = {
  title: string;
  subtitle?: string;
  overview?: string;
  posterUrl?: string;
  posterState: "none" | "loading" | "ready" | "failed";
  facts: Array<{ label: string; value: string; tone?: string }>;
};
```

### DetailsSheet

Owns:

- scrollable details layout
- full metadata sections
- stable poster area
- footer/action scope for details

Used when selected preview is not enough:

- `shift+enter` from search/results/calendar/recommendations
- details command from command palette

### ActionList / ActionRow

Owns:

- selectable action rows
- labels, detail, shortcut, disabled reason
- selected row focus

Used by:

- PPS
- playback issue
- command-like task surfaces

### PickerSurface

Owns:

- focused list/picker shell
- compact title/subtitle
- row selection
- scoped footer
- empty/error picker states

Used by:

- episode picker
- season picker
- settings value pickers
- root overlays where a single choice is the job

Do not use `PickerSurface` for tracks if tracks needs multiple sections. Use `CapabilityRows`.

### CapabilityRows

Owns:

- grouped capability sections
- selected/current/locked/unavailable/failed row rendering
- deep-link focus for sections

Used by:

- tracks panel
- source/quality/audio/hardsub sections

### CalendarSchedule

Owns:

- type tabs
- day navigation row
- vertical time groups
- release row geometry
- state coloring for release status

Does not own:

- schedule fetching
- provider availability fetching

### StateBlock

Owns:

- loading
- empty
- error
- success/info copy
- primary recovery action

StateBlock should be surface-aware through copy and action inputs, not hardcoded globally.

### ActivityHeatmap

Owns:

- compact day/week rendering
- stable color scale
- responsive week count
- empty heatmap presentation

Used by:

- stats overview

Does not own:

- history aggregation
- streak computation

### MetricRows

Owns:

- label/value alignment
- compact two-column wrapping
- tone for meaningful values

Used by:

- stats
- details sheet facts
- download/library summary facts

## State Ownership

### Search

Search must separate query, submitted results, result filtering, selection, and details.

Recommended reducer state:

```ts
type SearchFocus = "query" | "results" | "result-filter" | "preview" | "details";

type SearchUiState = {
  queryDraft: string;
  submittedQuery: string;
  resultFilter: string;
  focusedRegion: SearchFocus;
  selectedIndex: number;
  detailsOpen: boolean;
  detailsScroll: number;
};
```

Rules:

- Editing `queryDraft` does not refetch.
- Submitting query updates `submittedQuery` and starts a search.
- `resultFilter` only filters current results.
- Returning from details preserves selection and result set.

Use a local reducer first. Move to a small store only if the state is shared across distant components or becomes difficult to test.

### Playback

Playback view state should derive from session state:

- loading/bootstrap
- playing
- stalled
- stopped early
- complete
- did not start
- caught up

Do not infer watched/completed state from UI copy.

### Tracks

Tracks view state should be normalized before rendering.

### Stats

Stats view state should be built before rendering.

Recommended builder input:

- raw `WatchStats`
- active range
- active media kind
- viewport budget

Recommended builder output:

- selected tab/range/kind labels
- summary lines
- metric rows
- optional heatmap model
- top title rows
- footer actions
- loading/empty/error/success state

Do not mix SQL aggregation, display grammar, and Ink layout in the same component.

### History / Library

History and library should share list and preview rail models:

- history rows are resume-first
- library rows are availability-first
- queue rows are operation-first

Deletion/cancel actions must require confirmation and should never visually outrank continue/open/retry.

UI receives capability sections. It does not decide from raw streams whether a provider supports quality/audio/subtitles.

### Calendar

Calendar view state:

```ts
type CalendarFocus = "type-tabs" | "day-tabs" | "releases" | "preview" | "details";
```

Calendar owns UI navigation state. Data ownership remains in schedule services/cache.

## Testing Seams

Prefer testing view model builders and reducers:

- footer action selection/collapse
- search reducer transitions
- calendar grouping by day/time/status
- tracks capability normalization
- PPS state mapping
- preview rail poster-state stability

---

## surfaces/post-playback.md

# Post-Playback Surface

North star:

```text
Post-playback = episode page + remote
```

The screen should answer:

1. What did I just watch?
2. What happened?
3. What can I do next?
4. What metadata helps me decide?
5. What deeper controls are available if I need them?

## Primary Layout

- Header: `Kunai · Post-play · mode · provider · title · episode`.
- Main identity: show title strongly, episode/season/title metadata below.
- State line: complete, stopped early, caught up, season complete, series complete, or playback issue.
- Action list: selectable rows. Keymaps are accelerators, not the only path.
- Preview rail: episode thumbnail or season poster fallback when useful.
- Footer: primary post-play actions.

## Footer

Recommended PPS footer:

```text
[▶ n] next   [◀ p] previous   [↻ r] replay   [☰ e] episodes   [⌕ s] search   [/] commands
```

If too dense, keep:

```text
[▶ n] next   [↻ r] replay   [☰ e] episodes   [/] commands
```

`stop after current` is not a default footer action. It belongs in session commands.

## States

### Episode Complete

Primary action: next episode.

Show:

- watched duration
- next episode title/thumb if available
- recommendations as secondary loop
- replay, episodes, tracks, search

### Stopped Early

Primary action: resume from timestamp.

Show:

- saved position
- replay
- episode picker
- tracks/recover only if useful

### Caught Up

Do not mix with series complete.

Primary actions:

- calendar
- watchlist/tracked state
- recommendations
- replay
- search

Show expected next airing only if schedule data exists. If not, say it quietly.

### Season Complete

If next season exists:

- primary action: start next season
- secondary: season picker, recommendations, replay finale

If next season exists but is unavailable:

- show expected/unknown availability
- primary: calendar/watchlist

### Series Complete

Primary loop becomes recommendations.

Show:

- completion state
- recommended next titles
- more recommendations
- history/stats if useful

### Playback Did Not Start

This is not post-play completion.

Show:

- `Playback did not start`
- brief reason if known
- try again
- choose source/tracks
- diagnostics
- search

Never mark watched or offer next as primary if playback never started.

## Poster And Thumb Rules

- Current episode thumbnail first.
- Season poster fallback.
- Title poster for series/movie-level states.
- Hide images before hiding action rows or state.

---

## surfaces/active-playback.md

# Active Playback

Approved direction:

```text
Active playback = episode control surface
```

Kunai should not pretend to be the video player. mpv owns video. Kunai owns session state, progress, recovery, and next actions.

## Layout

Show:

- current episode identity
- short current-watch summary
- playback health
- provider/source facts only if useful
- active tracks/subtitle state
- autoplay/autoskip state
- compact startup trail after play starts
- episode thumbnail or season poster fallback
- up next
- progress

Do not leave a blank void. Do not show a noisy bootstrap dashboard after playback has started.

## Footer

```text
[space] pause   [q] stop   [☰ e] episodes   [≋ t] tracks   [/] commands
```

Recovery/fallback stay in command palette unless playback is in trouble. When trouble happens, promote recover/fallback into body and footer temporarily.

## Trouble States

If stream stalls:

- show `Stream stalled`
- show subtitle state if relevant
- promote fallback/recover

If mpv exits before playback starts:

- route to Playback Issue state
- do not mark watched
- do not offer next as primary

If near end:

- apply configured quit-near-end behavior
- explain only if user needs to act

## Loading And Startup

Startup can show a subtle step trail:

- search
- scrape
- resolve
- play

Once playing, compress it into health context or hide it.

---

## surfaces/tracks-panel.md

# Tracks Panel

Tracks is one unified scoped panel.

Commands `/tracks`, `/source`, and `/quality` open the same surface. `/source` and `/quality` deep-link focus into their sections.

## Purpose

Help the user understand or change stream setup without opening many generic one-row pickers.

## Sections

- Source
- Quality
- Audio
- Subtitles
- Hardsub

## Row Rules

- Rows with real alternatives are selectable.
- Single-option sections render as facts.
- Unavailable sections explain why.
- Failed candidates may appear only if the reason helps recovery.

Examples:

```text
Source
> VID MP4        current · direct-http · cache hit
  Fallback host  available · lower confidence
  Mirror 3       failed last attempt

Quality
  Best available provider did not expose variants

Subtitles
  English        attached in mpv · 151 tracks available
  Select in mpv  switching belongs to mpv when all tracks are attached
```

## Subtitle Policy

Subtitles are informational by default because Kunai attaches tracks to mpv.

Only make subtitles selectable in Kunai if the backend exposes a true pre-play subtitle choice that affects stream resolution.

## Backend Contract

UI should render normalized capabilities, not raw provider fragments:

```ts
type TrackCapabilitySection = "source" | "quality" | "audio" | "subtitle" | "hardsub";

type TrackCapability = {
  section: TrackCapabilitySection;
  label: string;
  value: string;
  selected: boolean;
  enabled: boolean;
  reason?: string;
  detail?: string;
  risk?: "normal" | "fallback" | "failed" | "unavailable";
};
```

## Footer

```text
[↑↓] select   [enter] change   [r] refresh   [esc] back   [/] commands
```

If no rows can change, `enter` should not open a dead picker.

---

## surfaces/episode-season-picker.md

# Episode And Season Picker

Approved direction:

```text
Dense episode list + selected preview rail
```

This picker is shared by:

- post-playback episode selection
- active playback episode switching
- season navigation
- next-season transitions

## Layout

Left:

- season tabs or season selector
- dense episode list
- watched/current/available/upcoming states

Right:

- selected episode thumbnail
- season poster fallback
- episode title and metadata
- progress/watched state
- tracks/provider availability if useful
- next/previous context

The preview rail must reserve the thumbnail/poster slot before media loads. Metadata below the image should stay anchored and must not jump when rendering finishes.

## Episode Row Data

Rows may show:

- episode code
- episode title
- runtime
- air date
- watched/current/available/upcoming state

Do not show unavailable future episodes as normal playable rows.

## States

- watched
- current
- available
- upcoming/not aired
- missing metadata
- unavailable from provider

## Footer

```text
[↑↓] select   [enter] play   [s] season   [/] commands   [esc] back
```

## Responsive

Preview rail hides first.

On narrow terminals, keep:

- current season
- episode code/title
- state
- footer basics

---

## surfaces/recommendations-viewer.md

# Recommendations Viewer

Recommendations should feel like "what to watch next", not database search results.

Approved direction:

```text
Hybrid list + preview rail
```

On compact terminals, collapse to list only.

## Layout

Left:

- curated recommendation list
- reason text
- type/year/episode count when useful
- availability if known

Right:

- poster
- selected title
- short reason/overview
- useful metadata

Reserve poster space so reason text and metadata do not move when the poster loads. If image support is slow or unavailable, keep a stable placeholder or hide the poster slot at smaller sizes.

## Pagination

Avoid infinite scroll as the primary mental model.

Use:

- first page: 8-12 strong picks
- `similar`: refine around selected item
- `more`: intentionally load next batch
- search: exit into explicit search

## Footer

Default:

```text
[↑↓] select   [enter] open   [m] similar   [/] commands
```

Optional only if repeatedly useful:

```text
[h] hide   [s] search
```

## Shared Component

This surface should reuse the same `MediaList + PreviewRail` pattern as search/browse, with recommendation-specific reason text.

---

## surfaces/search-details-calendar.md

# Search, Details, And Calendar

This spec covers the corrected discovery/search model and the calendar utility surface.

## Browse Start

Keep the first screen plain and direct.

Show:

- one-line search input
- compact token/filter hint
- continue watching rows
- footer

Continue watching should show 2-3 compact rows and become scrollable when more exist.

Do not show a preview rail before results exist.

## Search Results

Search results use:

```text
one-line query input
result list
selected preview rail
details sheet on demand
```

### Query vs Result Filter

Search query and result filter are separate.

- Query input changes do not refetch until submitted.
- Result filter narrows only the current result set.
- Switching back to results should preserve the submitted result set.

Recommended state model:

```ts
type SearchFocus = "query" | "results" | "result-filter" | "preview" | "details";

type SearchUiState = {
  queryDraft: string;
  submittedQuery: string;
  resultFilter: string;
  focusedRegion: SearchFocus;
  selectedIndex: number;
  detailsOpen: boolean;
  detailsScroll: number;
};
```

Use a reducer or small store if local state becomes tangled. Do not layer unrelated booleans.

### Input Styling

Use the current one-line bar style for normal browse/search.

Avoid large boxed query controls in browse/search. Boxed input is acceptable in settings/modals.

### Result Rows

Do not use provider as the primary right column.

Use useful signals:

- best match
- weak match
- status
- seasons/episodes
- year
- airing state
- availability

Provider can appear in preview or details.

### Preview Rail Stability

Search preview must not jump when poster rendering finishes.

- Reserve poster space before fetching/rendering.
- Keep selected title, overview, and fact rows anchored below the poster slot.
- `Loading poster...`, missing poster fallback, and rendered poster must use the same slot.
- If there is not enough room, hide the poster and keep the selected metadata.

## Details Sheet

`shift+enter` opens details for selected result.

Details is scrollable and does not replace query/result state.

Details can include:

- overview
- genres
- status
- first air date / release date
- seasons and episode count
- cast top 4
- trailer link if metadata has it
- season/episode entry point
- provider availability

Preview stays short. Details is where depth lives.

## Calendar

Calendar is not search results with dates. It is a tabbed vertical schedule and a return-loop surface for tracked media.

The calendar must distinguish broadcast state from playable availability. A release can have aired but still not be playable through any provider Kunai can resolve. Do not label something `available` until the provider contract says it can be opened or resolved with reasonable confidence.

### Layout

- Header: Calendar mode and schedule context.
- Type tabs: `All`, `Anime`, `Series`, `Movies`, `Tracked`.
- Week strip: seven day cells with release markers and a selected day.
- Main list: `For you` first, then `Also today`.
- Vertical time groups or release bands, depending on density.
- Preview rail: selected release details, countdown, availability, and return-loop context.

### Priority Bands

Use this order:

1. `For you`: tracked shows, new episodes since the user's last watched episode, or saved titles.
2. `Also today`: non-tracked releases for the selected type/day.
3. `Later`: future releases when there is enough room.

The important user-facing fact is not only `S01E29`. It is `3 new since E5`, `available now`, or `in 3h 20m`.

### Controls

```text
[tab] type
[shift+tab] previous type
[←→] day
[enter] open
[shift+enter] details
[/] commands
```

### State Colors

Calendar uses the canonical Sakura token model:

- Mint: provider-available / playable now.
- Rose: countdown today, active near-term, selected/focused release.
- Text/body: normal upcoming release when it does not require attention.
- Dim: aired but not provider-available yet, provider pending, resolving, later, or not actionable yet.
- Crimson: missed or metadata failure, only when useful.

Recommended release states:

```text
✓ available          playable on a provider now
◷ in 3h 20m          countdown to today's drop
◐ aired · resolving  broadcast happened, provider availability is not ready yet
· Fri                future release
× failed             metadata/provider failure, only if actionable
```

Do not open dead playback from `aired · resolving`. Offer refresh, track, details, or wait-copy instead.

### Release Row Data

Rows may show:

- title
- episode code
- availability state
- countdown or scheduled date
- new-since-current context
- tracked/watched state
- type
- provider only when it changes the decision

Keep rows scannable. Put long details in preview/details.

---

## surfaces/stats-history-library.md

# Stats, History, And Library

These surfaces are the memory layer of Kunai. They should help a user return, understand their watching rhythm, and manage local copies without feeling like a developer dashboard.

## Jobs

### Stats

Primary job: show useful personal viewing insight.

Stats is not diagnostics. It should not explain storage internals, provider health, or implementation details. It should answer:

- What have I watched lately?
- Am I keeping a streak?
- What titles am I spending time on?
- What kind of media am I watching most?
- Is there a nice thing worth sharing?

### History

Primary job: resume or inspect past watching.

History should answer:

- What can I continue now?
- What did I finish?
- What has a new episode after my last watched episode?
- What should I remove only if I intentionally manage history?

### Library / Downloads

Primary job: manage offline availability.

Library is operational, but should still feel calm. It should answer:

- What is ready offline?
- What is downloading or failed?
- What is protected from cleanup?
- What action fixes a failed download?

## Visual Direction

Use the same shell as browse/playback. Do not make these screens feel like a separate app.

- Prefer tab rows over nested boxes.
- Use one selected row/section at a time.
- Use charts only when they explain a pattern at a glance.
- Use muted labels and strong values.
- Use color for meaning, not decoration.
- Keep the footer capped.

Claude Code's stats screen is a useful inspiration for rhythm: top identity, tabs, simple chart, key values, and a small copy/share action. Do not copy the developer metrics model directly.

## Stats Surface

### Tabs

Recommended first pass:

- `Overview`
- `Titles`

Optional later:

- `Genres`
- `Providers`

Avoid shipping empty tabs. If genres/providers do not have reliable data yet, keep them out of the default UI.

### Range And Type Filters

Use compact filters:

- range: `30d`, `90d`, `all`
- type: `All`, `Series`, `Anime`, `Movies`

Controls:

- `[tab] range`
- `[shift+tab] type`
- `[1-3] range`
- `[s] share`
- `[/] commands`
- `[esc] back`

### Overview Layout

Best-case wide layout:

```text
🦊 Kunai · Stats · personal watch rhythm                  ● ready · 180x45

Overview  Titles                         All  Series  Anime  Movies     30d  90d  all

🔥 3d streak · 18 episodes · 7h 42m watched
This week: 6 ep · 2h 31m · more than last week

May Jun Jul Aug Sep Oct Nov Dec Jan Feb Mar Apr May
Su · · · ░ ▒ █
Mo · · ░ ▒ · █
Tu · · · · ░ ▓
We · ░ · ▒ █ ·
Th · · · · ░ ░
Fr · ░ ▒ █ █ ·
Sa · · · ░ ▒ █

Top titles
MARRIAGETOXIN          ███████░  5 ep · 1h 58m
The Boys               ████░░░░  2 ep · 52m
Frieren                ██░░░░░░  1 ep · 24m

[tab] range  [shift+tab] type  [s] share  [/] commands                      Stats
```

Small layout should keep summary, selected range/type, and top titles before the heatmap. Hide the heatmap first if height is tight.

### Stats Worth Showing

Ship:

- current streak
- longest streak
- total watched time
- episodes/movies watched in selected range
- active days in selected range
- top titles
- weekly trend
- activity heatmap when space allows

Consider later:

- favorite genres
- most watched provider
- completion rate per series
- weekday/time-of-day pattern

Avoid:

- raw database counts
- provider technical metrics
- fake precision
- guilt-heavy copy
- too many leaderboards

### Empty, Loading, Error

Empty:

```text
No watch stats yet
Watch an episode and Kunai will build your rhythm here.

[s] search  [h] history  [/] commands
```

Loading:

```text
Building watch stats...
Reading local watch history.
```

Error:

```text
Could not read watch stats
History is still safe. Open diagnostics if this keeps happening.

[d] diagnostics  [/] commands
```

## History Surface

History should reuse `MediaList` and `PreviewRail`.

Tabs:

- `Continue`
- `Completed`
- `New episodes`
- `All`

Rows should show:

- title
- season/episode
- progress or finished state
- last watched recency
- next release/new episode state when available

Preview rail should show:

- poster or initials fallback
- local progress
- last watched
- next available episode if known
- primary action: continue/open

Footer:

```text
[enter] continue  [tab] filter  [x] remove  [/] commands                    History
```

Deletion should be confirm-on-second-press or use a scoped confirmation picker. Never make removal look like the primary action.

## Library / Downloads Surface

Use two tabs:

- `Library`
- `Queue`

Library rows:

- title
- offline episode count
- ready/partial/protected state
- last watched progress if available

Queue rows:

- title/episode
- queued/downloading/failed/complete
- progress
- next retry or failure reason

Footer:

```text
[enter] open  [tab] queue  [p] protect  [/] commands                        Library
```

Queue footer:

```text
[r] retry  [x] cancel  [tab] library  [/] commands                          Queue
```

Do not show all download settings in the footer. Put auto-download, cleanup, download path, and diagnostics in the command palette or settings.

## Implementation Contract

Keep services separate from presentation:

- `StatsService` reads and aggregates local history data.
- `StatsFormatter` formats durations and share text.
- A new stats view-model builder should decide tabs, visible sections, ranges, and display rows.
- `StatsShell` should render the model and handle input.

Suggested shape:

```ts
type StatsTab = "overview" | "titles";
type StatsRange = "30d" | "90d" | "all";
type StatsKind = "all" | "series" | "anime" | "movie";

type StatsOverviewModel = {
  tab: StatsTab;
  range: StatsRange;
  kind: StatsKind;
  summary: string;
  weeklyDigest: string;
  metrics: Array<{ label: string; value: string; tone?: string }>;
  heatmap: HeatmapModel | null;
  topTitles: MediaListRow[];
  footer: FooterAction[];
  state: "loading" | "empty" | "success" | "error";
};
```

History and library should also build view models before rendering. Do not let row text, progress math, or preview facts spread across shell files.

## Tests

Add targeted tests for:

- stats range filtering
- stats type filtering
- empty history stats state
- longest/current streak behavior
- history row view-model progress grammar
- library queue row failure grammar

Do not require live providers for these tests.

## Anti-Patterns

Avoid:

- turning stats into diagnostics
- showing provider/source details unless the user asks
- stuffing every metric into the first screen
- using charts when text is clearer
- making history deletion too easy
- letting queue failures look like normal muted rows
- separate one-off footers for stats/history/library
- recomputing heavy aggregates on every keypress without memoized state

---

## surfaces/command-palette.md

# Command Palette Scope

The palette is powerful, but every surface must stay scoped.

## Scope Levels

### PPS Palette

Contextual hub. It can include:

- next/resume/replay
- episodes
- tracks
- recommendations
- search
- calendar
- autoplay/autoskip
- stop after current
- diagnostics when relevant

### Subpanel Palette

Scoped tool menu. It can include:

- commands for that panel
- back/close
- adjacent panel jumps when useful
- disabled commands with useful reasons

It should not show the whole app.

### Global Palette

Available from root/global mode. Includes:

- settings
- diagnostics
- provider
- setup
- docs/about/update
- presence

Exact typed global commands may be supported later, but they should not appear by default in scoped panels.

## Groups

Use groups only when relevant:

- Suggested
- Watch next
- Session
- This panel
- Return
- Diagnostics

## Footer

```text
[tab] complete   [↑↓] choose   [enter] run   [esc] close
```

---

## implementation-split.md

# Implementation Split

Use this file to parallelize work without overlapping ownership.

## Shared First

Before screen-specific implementation, create or refine shared primitives:

- `ShellFrame`
- `ModeChip`
- `Footer`
- `MediaHeader`
- `ActionList`
- `ActionRow`
- `PreviewRail`
- `PickerSurface`
- `CapabilityRows`
- `MediaList`
- `DetailsSheet`
- `ThemeTokens`

Shared primitives must encode the contracts in:

- `00-principles.md`
- `01-shell-footer-contract.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Recommended shared work before parallel screen edits:

- footer action model and collapse behavior
- Sakura theme token model and terminal color adapter
- preview rail stable poster slot
- state block contract for loading/empty/error/success
- media list row view model
- search reducer/view model shape
- tracks capability normalization view model
- calendar day/time grouping view model
- stats/history/library view models

## Agent A

Owns playback family:

- Post-playback
- Active playback
- Command palette scope for PPS/playback
- Playback issue state
- Footer behavior for playback surfaces

Primary specs:

- `surfaces/post-playback.md`
- `surfaces/active-playback.md`
- `surfaces/command-palette.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Likely files:

- `apps/cli/src/app-shell/post-play-shell.tsx`
- `apps/cli/src/app-shell/loading-shell.tsx`
- `apps/cli/src/app-shell/ink-shell.tsx`
- `apps/cli/src/domain/session/command-registry.ts`
- shared shell primitives as needed

## Agent B

Owns picker/discovery family:

- Tracks panel
- Episode/season picker
- Recommendations viewer
- Search/results/details
- Calendar
- Stats/history/library visual contract, if not split to a third agent

Primary specs:

- `surfaces/tracks-panel.md`
- `surfaces/episode-season-picker.md`
- `surfaces/recommendations-viewer.md`
- `surfaces/search-details-calendar.md`
- `surfaces/stats-history-library.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Likely files:

- `apps/cli/src/app-shell/root-overlay-shell.tsx`
- `apps/cli/src/app-shell/root-overlay-model.ts`
- `apps/cli/src/app-shell/workflows.ts`
- `apps/cli/src/app-shell/picker-overlay.tsx`
- `apps/cli/src/app-shell/pickers/*`
- shared shell primitives as needed

## Coordination Rules

- Shared primitives need a small API agreement before both agents edit them.
- Do not create separate footer/list/picker models per surface.
- Do not duplicate preview rail logic.
- Use source code as truth when current docs disagree.
- Update `.design/cli` when implementation intentionally changes the contract.
- If two agents are active, keep stats/history/library lower priority than playback and browse unless the shared primitive work already touches them.

## Acceptance Checks

Each implemented surface must pass:

- Header follows shell contract.
- Footer has at most four primary actions plus commands.
- Screen has loading/success/empty/error states.
- Preview rail hides before critical text.
- Preview rail reserves poster space and does not jump when images load.
- No dead picker opens for one-option capability sections.
- Command palette stays scoped.
- Source/provider internals are hidden unless useful.
- Search query and result filter state are separate.
- Calendar uses vertical time grouping and type/day navigation.
- Stats are motivational/product-facing, not diagnostics.
- History is resume-first and deletion is never the primary action.
- Library/downloads separate ready offline items from queue/failure management.
- Sakura token discipline is preserved: rose focus/progress, mint ready/complete, crimson failure, media-type hues only in Stats.
- Reducers/view model builders have targeted tests when state transitions are nontrivial.

## Suggested Verification

Use deterministic checks first:

```sh
bun run typecheck
bun run lint
bun run fmt
```

Use targeted tests if changing reducers/view models.

For visual-heavy changes, capture before/after screenshots or VHS tapes where available.
