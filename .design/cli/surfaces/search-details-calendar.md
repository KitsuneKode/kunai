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
- Type tabs: `All`, `Anime`, `TV`, `Movies`, `Tracked` (keyboard `1`–`5`).
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
