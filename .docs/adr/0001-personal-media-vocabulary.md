# ADR 0001: Personal Media Vocabulary

Status: accepted
Date: 2026-06-25

## Context

Kunai has several user intents that used to share overlapping names:

- saved-for-later titles
- durable collections
- current playback order
- download jobs
- release attention
- provider switching

The old planning language used `playlist` for the runtime playback queue because `/queue` conflicted with download jobs. That avoided one collision but created a worse one: users could not tell whether "playlist" meant a durable collection or what plays next.

## Decision

Kunai uses one product meaning per noun:

| Term      | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| Watchlist | Built-in watch-later list. It is stable and cannot be deleted.                               |
| Playlists | Durable named collections. They can be loaded into Up Next and safely imported/exported.     |
| Up Next   | Current playback order. It is recoverable and persisted, but it is not a playlist.           |
| Downloads | Offline download jobs and local library management.                                          |
| Bookmark  | Verb/alias for adding or removing the current item from Watchlist.                           |
| Follow    | Explicit release attention for future/current episodes.                                      |
| Unfollow  | Remove explicit release attention without muting, deleting history, or removing saved state. |
| Mute      | Suppress release nudges for a title.                                                         |
| Provider  | Stable surface for changing the active provider or source family.                            |

Canonical command names:

- `/watchlist`
- `/playlists`
- `/up-next`
- `/downloads`
- `/provider`
- `/follow`
- `/unfollow`
- `/mute`

Compatibility aliases are allowed:

- `/playlist` and `/pl` resolve to `/playlists`
- `/queue` resolves to `/up-next`
- `/bookmark` remains a Watchlist verb

## Consequences

- User-facing copy must say **Up Next** for runtime playback order.
- User-facing copy must say **Playlists** for durable collections.
- Internal storage and repository names may keep `queue` or `playlist_queue` where renaming would create churn, but adapters and UI copy must expose the canonical vocabulary.
- `add-to-playlist` must not silently write to Watchlist. A durable playlist add requires a playlist choice.
- Playlist exports must never contain stream URLs, headers, cookies, auth tokens, or local file paths.
- `/provider` is a stable command surface, not a diagnostics-only escape hatch.
- Favorites, Sync, Random, Surprise, and advanced repair commands should stay out of default palettes unless they have a clear stable product role.

## Current Implementation Notes

The 2026-06-25 implementation slice added `playlists`, `up-next`, and `unfollow` command ids; kept legacy aliases; split media actions into Watchlist, Playlist, and Up Next intents; promoted `/provider` in browse command surfaces; and regenerated docs metadata.

Remaining work is tracked in `docs/superpowers/plans/2026-06-25-personal-media-vocabulary-and-keybindings.md`.
