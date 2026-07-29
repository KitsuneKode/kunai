# Personal Media Vocabulary And Keybindings Design

**Status:** Partially implemented; remaining slices tracked in the companion plan
**Date:** 2026-06-25
**Commit reviewed:** `527be9b6`

## Implementation Update

The first implementation slice landed on 2026-06-25:

- `playlists`, `up-next`, and `unfollow` are real command ids.
- `/playlist` and `/pl` are compatibility aliases for `/playlists`.
- `/queue` is a compatibility alias for `/up-next`.
- `add-to-playlist` no longer silently writes to Watchlist.
- media actions distinguish `add-to-watchlist`, `add-to-playlist`, and `add-to-up-next`.
- `unfollow` writes neutral `implicit` attention state.
- `/provider` is promoted in browse command surfaces and covered by dispatcher tests.
- generated docs metadata includes the new command ids.

The canonical decision record is `.docs/adr/0001-personal-media-vocabulary.md`.

## Problem

Kunai's personal-media surface currently mixes several different user intents:

- durable saved collections
- the current playback order
- release notifications
- one-off sharing
- diagnostics and advanced repair actions

The result is a wide command palette and confusing vocabulary. In particular, `playlist` currently describes both durable playlist behavior and the Up Next playback queue. `bookmark` means watchlist, `follow` means release attention, and `favorites` exists without a strong product role.

## Locked Vocabulary

Kunai should use these meanings consistently:

| Term           | Meaning                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Playlist       | A durable named collection of titles or episodes.                                               |
| Watchlist      | A built-in playlist for "watch later" intent. It cannot be deleted.                             |
| Up Next        | The current playback queue/order. It is checkpointed and recoverable, but it is not a playlist. |
| Bookmark       | A verb/alias for adding or removing the current item from Watchlist.                            |
| Follow         | Explicit release attention for airing/current titles.                                           |
| Unfollow       | Remove explicit follow state without muting or deleting saved/history state.                    |
| Mute           | Suppress future release nudges for a title.                                                     |
| Share current  | A `kunai://play?...` or `kunai://download?...` one-item target.                                 |
| Share playlist | A safe `.kunai-playlist.json` identity document.                                                |

## Stable Surface

The stable command surface should be small:

- `/search`
- `/continue`
- `/watchlist`
- `/playlists`
- `/up-next`
- `/download`
- `/downloads`
- `/library`
- `/provider`
- `/share`
- `/follow`
- `/unfollow`
- `/mute`
- `/calendar`
- `/settings`
- `/help`

Aliases may preserve old muscle memory, but displayed labels and help text must use the locked vocabulary.

## Experimental Or Advanced Surface

These should be gated, hidden from default root palette contexts, or moved under `Advanced`/`Experimental` groups until the feature is complete:

- Favorites
- Sync
- playlist import/export if the playlist manager UI is not ready
- recompute sources
- reset provider health
- clear cache
- export diagnostics
- report issue
- mark anime/series

## Architecture

### Playlist Module

The Playlist module owns durable collections.

It includes:

- built-in Watchlist playlist
- custom playlists
- create/list/rename/delete for custom playlists
- add/remove/reorder playlist items
- safe import/export documents
- load playlist into Up Next
- progress projection from history, without copying mutable progress into playlist storage

Watchlist should be represented as the built-in playlist rather than a separate product concept.

### Up Next Module

The Up Next module owns current playback order.

It includes:

- enqueue next / end / after current chain
- reorder/remove/clear/clear played
- recover previous pending queue sessions
- load from durable playlist
- late stream resolution when the user actually plays

Up Next may be persisted for crash recovery, but it is not the same as a playlist.

### Attention Module

The Attention module owns release interest.

It includes:

- follow releases
- unfollow releases
- mute release nudges
- release/calendar/notification eligibility

Follow is for current/airing titles where the user wants updates. Mute suppresses attention without deleting watchlist, playlists, or history.

### Command Registry Module

The Command Registry module owns:

- command ids
- labels
- aliases
- grouping
- visibility
- disabled reasons
- help copy

The command palette, footer hints, help overlay, and keybindings must derive from the same command registry or keybinding registry wherever possible.

### Keybindings Module

The Keybindings module owns:

- global shortcuts
- per-surface shortcuts
- collision tests
- footer hint labels
- help overlay shortcut copy

Printable keys must not hijack focused text inputs. Familiar player/list keys should be used where they do not conflict with text entry.

## Command Naming

Preferred command ids and labels:

| Command id        | Label                                    | Primary aliases                               |
| ----------------- | ---------------------------------------- | --------------------------------------------- |
| `watchlist`       | Watchlist                                | `watchlist`, `wl`, `watch-later`              |
| `playlists`       | Playlists                                | `playlists`, `playlist`, `pl`                 |
| `up-next`         | Up Next                                  | `up-next`, `queue`, `queue-playlist`          |
| `playlist-add`    | Add to Up Next                           | `playlist-add`, `add-to-up-next`, `queue-add` |
| `add-to-playlist` | Add to Playlist                          | requires a chosen durable playlist            |
| `bookmark`        | Add to Watchlist / Remove from Watchlist | `bookmark`, `save-current`, `watchlist-add`   |
| `follow`          | Follow Releases                          | `follow`, `track-releases`                    |
| `unfollow`        | Unfollow Releases                        | `unfollow`, `stop-following`                  |
| `mute`            | Mute Releases                            | `mute`, `hide-releases`                       |
| `share`           | Share Current                            | `share`, `share-link`                         |

If legacy command ids are retained internally for compatibility, the displayed labels must still follow this table.

## Keybinding Principles

- `/`, `?`, `Esc`, and `Ctrl+C` are global.
- Printable keys type text when text input is focused.
- Browse result shortcuts apply only when the result list is focused.
- `q` should not mean quit in browse/search; it can queue/add only in non-text list focus.
- `n` and `p` are next/previous in playback and post-playback.
- `a` can toggle autoplay in playback contexts.
- `u` can toggle autoskip only where that context is visible.
- `x` removes from lists/queues or toggles stop-after-current only where the surface makes that visible.
- `m` should open a contextual menu when no text input is focused.

## Testing Requirements

- Command registry tests must prove stable commands are present in the right contexts and experimental/advanced commands are omitted or grouped.
- Keybinding collision tests must cover global plus active scope.
- Command palette tests must assert grouping and aliases.
- Shell/input tests must assert printable keys do not hijack text input.
- Watchlist/playlist/up-next tests must prove the same action reaches the same app intent from palette and direct keybinding.

## Non-Goals

- Do not build user-customizable keybindings in this pass.
- Do not add cloud sync or public sharing.
- Do not store stream URLs, local paths, headers, cookies, or auth tokens in playlist exports.
- Do not remove legacy aliases abruptly.
- Do not rework provider resolution or download jobs except where command naming must distinguish `/downloads` from `/up-next`.

## Open Follow-Up

After this pass, decide whether Favorites remains hidden, becomes a built-in playlist, or is removed from the visible product vocabulary.

## Remaining Follow-Up

- Keybinding parity and help/footer docs need a focused pass.
- Watchlist submenu should expose Unfollow when a title is explicitly followed.
- Durable playlist manager needs create/rename/delete/add-to-specific-playlist polish.
- Experimental and advanced command visibility should be finalized for Favorites, Sync, Random, Surprise, cache repair, provider health reset, and diagnostics export.
