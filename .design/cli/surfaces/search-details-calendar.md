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

Calendar is not search results with dates. It is a tabbed vertical schedule.

### Layout

- Header: Calendar mode and schedule context.
- Type tabs: `All`, `Anime`, `Series`, `Movies`, `Tracked`.
- Day range: five visible day controls such as `Yesterday`, `Today`, `Tomorrow`, `Weekend`, `Next week`.
- Main list: vertical time groups.
- Preview rail: selected release details.

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

- Green: aired / available / playable.
- Amber: expected today.
- Blue/info: upcoming soon.
- Dim: later / not actionable yet.
- Red: missed or metadata failure, only when useful.

### Release Row Data

Rows may show:

- time group
- title
- episode code
- aired/expected/upcoming state
- tracked/watched state
- availability
- type

Keep rows scannable. Put long details in preview/details.
