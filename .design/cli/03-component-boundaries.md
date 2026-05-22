# Component Boundaries And State Ownership

This document defines the reusable UI units for the CLI redesign. The goal is to prevent local one-off components from recreating shell, footer, list, picker, and preview behavior differently on every screen.

## Rule

Shared behavior belongs in shared primitives. Screen files provide view models and surface-specific copy.

Do not create separate list, footer, preview, or picker systems per screen.

## Shared Primitives

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
