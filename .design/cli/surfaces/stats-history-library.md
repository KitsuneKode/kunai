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
- when both local and stream are available: quiet `[l] local · [s] stream` override under the resume card

Continue source default is controlled by `continueSourcePreference` in settings (`auto`, `local`, `stream`, `ask`). `/continue` opens this tab directly.

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
