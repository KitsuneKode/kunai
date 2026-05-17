---
title: Kunai CLI Keybindings
description: Screen-by-screen keybinding map for the Kunai terminal shell.
---

# Kunai CLI Keybindings

This page is the source map for shell shortcuts. It is intentionally screen-based:
the same physical key can mean different things only when the active surface is
visibly different.

## Principles

- `/` opens commands anywhere the current surface supports command entry.
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

| Key       | Action                                |
| --------- | ------------------------------------- |
| `Enter`   | Open selected result                  |
| `↑` / `↓` | Move selection                        |
| `Tab`     | Switch series/anime mode              |
| `/`       | Open command palette                  |
| `Esc`     | Clear/back depending on focused state |

## Active Playback

These keys are available while `mpv` is active and the shell is supervising it.

| Key       | Action                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| `q`       | Stop playback and enter post-playback controls                                       |
| `Shift+S` | Stop playback and return to search                                                   |
| `n`       | Next episode, starting from the beginning with mpv resume prompt when applicable     |
| `p`       | Previous episode, starting from the beginning with mpv resume prompt when applicable |
| `a`       | Pause/resume autoplay for the current chain                                          |
| `u`       | Pause/resume autoskip for the current title/session                                  |
| `e`       | Open episode picker without changing episode until selection is confirmed            |
| `k`       | Open combined stream picker without changing stream until selection is confirmed     |
| `o`       | Open source picker without changing source until selection is confirmed              |
| `v`       | Open quality picker without changing quality until selection is confirmed            |
| `f`       | Try fallback provider when available                                                 |
| `r`       | Recover current playback                                                             |
| `s`       | Reload subtitles                                                                     |
| `b`       | Manually skip the currently offered timing segment                                   |
| `m`       | Temporarily show runtime memory/health panel                                         |
| `x`       | Toggle stop-after-current when available                                             |

`Shift+S` is intentionally uppercase because lowercase `s` reloads subtitles
during active playback. Lowercase `g` is not used for this action because `g`
already opens settings in the playback loading/resolving shell.

## Playback Loading And Resolving

| Key   | Action                                                           |
| ----- | ---------------------------------------------------------------- |
| `/`   | Open command palette                                             |
| `f`   | Skip remaining retries and try fallback provider, when available |
| `g`   | Settings                                                         |
| `h`   | History                                                          |
| `d`   | Diagnostics                                                      |
| `?`   | Help                                                             |
| `Esc` | Cancel when the loading state is cancellable                     |

## Post-Playback

| Key   | Action                                                             |
| ----- | ------------------------------------------------------------------ |
| `/`   | Open command palette                                               |
| `n`   | Next episode                                                       |
| `p`   | Previous episode                                                   |
| `c`   | Continue from saved point when resumable                           |
| `r`   | Replay from start with mpv resume prompt available when applicable |
| `e`   | Episode picker                                                     |
| `k`   | Streams                                                            |
| `o`   | Source                                                             |
| `v`   | Quality                                                            |
| `f`   | Fallback provider                                                  |
| `a`   | Toggle autoplay                                                    |
| `d`   | Download current episode                                           |
| `i`   | Recommendation pick actions, when the rail is visible              |
| `1-3` | Queue visible recommendation pick, when the rail is visible        |
| `?`   | Help                                                               |
| `s`   | Fresh search                                                       |
| `q`   | Quit                                                               |
| `Esc` | Back to previous results                                           |

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

## Collision Notes

| Key | Collision risk                                          | Decision                                                   |
| --- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `g` | Settings in playback loading/resolving                  | Do not use for return/search                               |
| `s` | Subtitles during active playback; search after playback | Keep contextual; use `Shift+S` for active return-to-search |
| `r` | Recover during active playback; replay after playback   | Context is visible and acceptable                          |
| `f` | Fallback in resolve/playback/post-playback              | Same intent across surfaces                                |
| `e` | Episode picker in playback surfaces                     | Same intent across surfaces                                |
