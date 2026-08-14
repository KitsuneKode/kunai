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
