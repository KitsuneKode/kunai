# Search

Typing a title on Browse and pressing Enter searches the active lane (series,
movie or anime) and lists results; a query with no matches says so.

## Sub-features

- `search-submit` runs one search for the full typed text.
- `search-results` lists matches with a preview rail for the selected row.
- `search-empty` shows a cause-named empty state.

## How to get to it (user POV)

- Launch Kunai; Browse opens with focus in `Search title`. Type, press Enter.
- `-S "<query>"` on the command line searches on launch.

## Driving it with agent:drive

- **Results.** `bun run agent:drive -- --show frame --keys smoke "<enter>" "<wait:Smoke Movie>"`.
  Frame shows `2 results · Smoke TMDB` and `▌ Smoke Movie (2026)`.
- **Empty.** `bun run agent:drive -- --show frame --keys volcano "<enter>" "<wait:No results>"`.
  Frame shows `0 results · Smoke TMDB` and `· No results for "volcano"`.

## Gotchas

- The results list and the header are separate readers of search state. A
  frame that shows results while the header says `Searching…` is a bug (#702
  fixed one such path), not a timing artefact.
- Submitting a query saves it to search history. A unit test that mounts
  `BrowseShell` and presses Enter must isolate storage (`applyStorageRootEnv`)
  and wait for `flushSearchHistory()`; the drivers already isolate.
