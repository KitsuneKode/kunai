---
title: Kunai CLI Keybindings
description: Screen-by-screen keybinding map for the Kunai terminal shell.
status: current
lastReviewed: "2026-08-18"
---

# Kunai CLI Keybindings

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This page is the source map for shell shortcuts. It is intentionally screen-based:
the same physical key can mean different things only when the active surface is
visibly different.

## Principles

- `/` opens commands anywhere the current surface supports command entry.
- Stable command nouns are `/watchlist`, `/playlists`, `/up-next`, `/downloads`, `/provider`, `/follow`, `/unfollow`, and `/mute`.
- `/playlist` and `/pl` are compatibility aliases for `/playlists`; `/queue` is a compatibility alias for `/up-next`.
- `?` opens help on non-text playback and panel surfaces. In focused search or
  filter fields, use `/help` so `?` can still be typed normally.
- `Esc` closes the top overlay or picker first; in post-playback it returns to
  previous results.
- `Ctrl+C` is the hard global exit.
- Text inputs keep terminal editing behavior. Printable keys type text unless
  the surface explicitly has no focused input.
- Active playback keeps destructive actions explicit. Opening a picker never
  changes source, quality, provider, or episode until a row is confirmed.

## Text Editing

| Key                    | Action                        |
| ---------------------- | ----------------------------- |
| `Enter`                | Submit the field              |
| `Home` / `Ctrl+A`      | Move to start                 |
| `End` / `Ctrl+E`       | Move to end                   |
| `Ctrl+Left` / `Alt+B`  | Move back one word            |
| `Ctrl+Right` / `Alt+F` | Move forward one word         |
| `Ctrl+W`               | Delete previous word          |
| `Ctrl+U`               | Delete before cursor          |
| `Ctrl+K`               | Delete after cursor           |
| `Ctrl+Y`               | Yank killed text              |
| `Ctrl+L`               | Redraw / clear terminal noise |

## Browse And Search

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `Enter`   | Open selected result                          |
| `↑` / `↓` | Move selection                                |
| `Tab`     | Cycle catalog mode (series / anime / YouTube) |

### Language setup (step 3 of `--setup`)

| Key            | Action                                                               |
| -------------- | -------------------------------------------------------------------- |
| `Tab` / `⇧Tab` | Cycle profile — Shows / Movies / Anime / YouTube (Shift reverses)    |
| `1`–`4`        | Jump straight to a profile                                           |
| `→`            | Move to the Subtitles column                                         |
| `←`            | Move to the Audio column; at Audio it backs out to the previous step |
| `↑` / `↓`      | Choose the value in the focused column                               |

| `/` | Open command palette |
| `m` | Open starting-point menu for the highlighted title (same as Enter) |
| `q` | Add selected result to Up Next when the result list, not text input, owns focus |
| `w` | Add selected result to Watchlist when the result list, not text input, owns focus |
| `Shift+W` | Follow selected title when the result list, not text input, owns focus |
| `Shift+Q` | Open Up Next when the result list, not text input, owns focus |
| `Ctrl+F` | Narrow loaded results only (local text filter) |
| `/filters` | Open guided search facets |
| `Esc` | Clear/back depending on focused state |

Use `/provider` from browse or playback command surfaces to change provider. Provider switching should stay explicit; opening the provider picker does not change provider until a row is confirmed.

## Setup Wizard

The language screen keeps a separate audio/subtitle profile for Shows, Movies,
Anime, and YouTube. `Tab` and `Shift+Tab` cycle profiles, `←` / `→` choose the
audio or subtitle column, and `↑` / `↓` choose a value. Press `a` to copy the
active profile to all four lanes. On the playback screen, `Space` toggles the
selected setting; factory defaults are off and `s` applies the recommended
all-on playback defaults for that screen and advances. `S` accepts every
remaining recommendation at once and jumps to the final screen. Neither key
saves: the final screen summarizes every profile and toggle, and only `Enter`
there writes configuration. On the analytics screen both keys record `disabled`,
because a skip may never opt anyone in.

## Active Playback

These keys are available while `mpv` is active and the shell is supervising it.

| Key         | Action                                                                               |
| ----------- | ------------------------------------------------------------------------------------ |
| `q`         | Stop playback and enter post-playback controls                                       |
| `Shift+S`   | Stop playback and return to search                                                   |
| `n`         | Next episode, starting from the beginning with mpv resume prompt when applicable     |
| `p`         | Previous episode, starting from the beginning with mpv resume prompt when applicable |
| `a`         | Pause/resume autoplay for the current chain                                          |
| `u`         | Pause/resume autoskip for the current title/session                                  |
| `e`         | Open episode picker without changing episode until selection is confirmed            |
| `k`         | Open quality picker in the terminal (mpv itself may still use `v`)                   |
| `o`         | Open source picker without changing source until selection is confirmed              |
| `Shift+F`   | Try fallback provider when available (bare `f` is intentionally unbound)             |
| `l`         | Favourite / unfavourite the current title (not `f`, which sits beside `Shift+F`)     |
| `/provider` | Open provider picker without changing provider until a row is confirmed              |
| `Ctrl+R`    | Refresh / recover the current stream                                                 |
| `s`         | Reload subtitles                                                                     |
| `b`         | Manually skip the currently offered timing segment                                   |
| `m`         | Open title control menu                                                              |
| `/memory`   | Toggle the temporary memory/health panel                                             |
| `x`         | Toggle stop-after-current when available                                             |

`Shift+S` is intentionally uppercase because lowercase `s` reloads subtitles
during active playback. Lowercase `g` is not used for this action because `g`
already opens settings in the playback loading/resolving shell.

Public docs consume a deliberately reduced subset via `publicShortcutMetadata()`
in `apps/cli/src/app-shell/keybindings.ts`. Prefer that generated table and in-app
`?` over copying chords into README.

## Playback Loading And Resolving

| Key       | Action                                                           |
| --------- | ---------------------------------------------------------------- |
| `/`       | Open command palette                                             |
| `Shift+F` | Skip remaining retries and try fallback provider, when available |
| `l`       | Favourite / unfavourite the title being opened                   |
| `g`       | Settings                                                         |
| `h`       | History                                                          |
| `d`       | Diagnostics                                                      |
| `?`       | Help                                                             |
| `Esc`     | Cancel when the loading state is cancellable                     |

Fallback is `Shift+F` everywhere. A bare `f` is bound only while browsing (where
it toggles a favourite) and is deliberately unbound in the loading and player
scopes, so a slipped shift cannot turn "favourite this" into "switch provider
mid-session". `l` carries the favourite toggle on those screens instead.

## Post-Playback

| Key             | Action                                                                               |
| --------------- | ------------------------------------------------------------------------------------ |
| `/`             | Open command palette                                                                 |
| `↑` / `k`       | Move selection up through the action list                                            |
| `↓` / `j`       | Move selection down through the action list                                          |
| `Enter`         | Run the highlighted action (or the first recommendation on series-complete)          |
| `n`             | Continue / next — resume, next episode, next season, or queued head per footer label |
| `r`             | Replay from start with mpv resume prompt available when applicable                   |
| `e`             | Episode picker                                                                       |
| `o`             | Source picker                                                                        |
| `Shift+F`       | Fallback provider                                                                    |
| `m`             | Title control menu                                                                   |
| `h`             | History                                                                              |
| `w`             | Watchlist (caught-up only)                                                           |
| `d`             | Diagnostics                                                                          |
| `1` / `2` / `3` | Play recommendation 1 / 2 / 3 when the rail is visible                               |
| `!` / `@` / `#` | Open action menu for recommendation 1 / 2 / 3 when the rail is visible               |
| `?`             | Help                                                                                 |
| `s`             | Fresh search                                                                         |
| `q`             | Quit                                                                                 |
| `Esc`           | Back to previous results                                                             |

## Pickers

Applies to episode, provider, stream, source, quality, settings choices, and
history pickers.

| Key       | Action                                                                           |
| --------- | -------------------------------------------------------------------------------- |
| Type      | Filter rows                                                                      |
| `↑` / `↓` | Move selection                                                                   |
| `Enter`   | Confirm selected row                                                             |
| `Esc`     | Clear filter first; close picker if filter is already empty                      |
| `/`       | Command palette only when the picker router gives command ownership to the shell |

For download episode checklists specifically, `Space` toggles the highlighted
episode, `Ctrl+A` selects all visible episodes, and `Enter` queues the selected
set.

## Timing And Autoskip

| Segment                       | Source names                                                         | Automatic behavior                                                                                              |
| ----------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Recap                         | IntroDB `recap`; AniSkip `recap` if ever returned by a safe endpoint | Auto-skipped only when `skipRecap` is on and session autoskip is not paused                                     |
| Intro                         | IntroDB `intro`; AniSkip `op` / `mixed-op`                           | Auto-skipped only when `skipIntro` is on and session autoskip is not paused                                     |
| Credits / outro               | IntroDB `credits`; AniSkip `ed` / `mixed-ed`                         | Auto-skipped when `skipCredits` is on, or when autoplay needs credits-as-end, unless session autoskip is paused |
| Preview                       | IntroDB `preview`                                                    | Manual prompt only; never auto-skipped                                                                          |
| Prologue / epilogue / unknown | Any unsupported external label                                       | Ignored                                                                                                         |

AniSkip is anime-only and currently queried with `types=op&types=ed` because the
live API rejects mixed unsupported type requests. The mapper still refuses
unknown labels defensively.

`u` is a session-level override. It does not write config; it only suppresses
automatic segment skipping for the current title/session so you can watch intros
or outros without changing your permanent preferences. The mpv skip banner and
manual skip key can still offer finite known segments while autoskip is paused.

## Up Next Queue

| Key       | Action                           |
| --------- | -------------------------------- |
| `Enter`   | Play the selected item now       |
| `J` / `K` | Move item down / up one slot     |
| `g` / `G` | Move to top (play next) / bottom |
| `x`       | Remove the selected item         |
| `c` / `C` | Clear queue / clear played       |
| `r`       | Restore your last queue          |

## History

| Key            | Action                                     |
| -------------- | ------------------------------------------ |
| `Enter`        | Resume the highlighted title               |
| `q`            | Add the highlighted title to Up Next       |
| `m`            | Open title actions for the highlighted row |
| `w`            | Toggle watched for the highlighted row     |
| `Tab` / `⇧Tab` | Cycle history tabs (Shift reverses)        |
| `←` / `→`      | Cycle type filter (← reverse, → forward)   |
| `x`            | Delete episode progress                    |
| `⇧X`           | Delete whole title from history            |

## Notifications

| Key       | Action                              |
| --------- | ----------------------------------- |
| `Enter`   | Run the primary notification action |
| `a`       | Open all notification actions       |
| `s`       | Cycle notification sort             |
| `r`       | Mark selected notification as read  |
| `d`       | Delete selected notification        |
| `A`       | Mark all notifications as read      |
| `x`       | Archive the selected notification   |
| `C`       | Clear archived notifications        |
| `[` / `]` | Previous / next page                |
| `Tab`     | Switch Active / Archive             |

## Stats

| Key            | Action                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| `Tab` / `⇧Tab` | Next / previous stats tab (Overview · Titles · Insights)                  |
| `r` / `⇧R`     | Cycle range forward / back (All time · Last 7d · Last 30d)                |
| `←` / `→`      | Cycle media type forward / back (All · Anime · Series · Movies · YouTube) |
| `1`–`3`        | Jump straight to a range                                                  |
| `s`            | Copy a shareable summary                                                  |
| `e`            | Export stats to a file                                                    |
| `q`            | Back                                                                      |

## Library

| Key     | Action                    |
| ------- | ------------------------- |
| `Enter` | Open selected title       |
| `x`     | Delete offline title      |
| `p`     | Toggle cleanup protection |
| `Tab`   | Switch Library / Up Next  |

The library has no title-control menu key. `m` was registered for one and shown
in the footer, but no handler read it — the keystroke fell through to the filter
input. The binding was removed rather than wired: `openTitleControlMenu` drives
its own picker from a phase, so reaching it from inside the mounted library
overlay needs a phase/shell seam and a decision about what the menu offers for an
offline entry.

## Outside The Ink Shell

`Ctrl+Shift+S` copies the share link during mpv playback. It is bound in the mpv
Lua bridge (`apps/cli/assets/mpv/kunai-bridge.lua`), not in `keybindings.ts`, so
it does not appear in the `?` overlay or any footer.

## Collision Notes

| Key | Collision risk                                          | Decision                                                                             |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `g` | Settings in playback loading/resolving                  | Do not use for return/search                                                         |
| `s` | Subtitles during active playback; search after playback | Keep contextual; use `Shift+S` for active return-to-search                           |
| `r` | Recover during active playback; replay after playback   | Context is visible and acceptable                                                    |
| `f` | Favourite while browsing; fallback elsewhere            | Bare `f` is browse-only; fallback is `Shift+F` in loading, player, and post-playback |
| `e` | Episode picker in playback surfaces                     | Same intent across surfaces                                                          |
