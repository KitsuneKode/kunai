# Kunai Launch Video Playbook

This is a practical storyboard for a cinematic product launch video using VHS for terminal capture, with an optional local screen recorder for `mpv`.

## Core Pitch

**The terminal can have nice things.**

Kunai is for the moment when a terminal user wants the speed of `ani-cli`, the continuity of a streaming app, and the playback quality of `mpv` without turning the experience into browser tab archaeology.

## Recommended Format

- Length: 75-100 seconds
- Aspect: 16:9
- Style: dark terminal, fox-amber accent, calm cinematic cuts
- Music: slow build for search/selection, stronger hit when `mpv` opens, softer outro
- Capture method:
  - Use VHS for polished terminal-only shots.
  - Use OBS, Screen Studio, Kooha, or a local recorder for the real `mpv` window.
  - Stitch both together in the edit.

VHS is excellent for terminal UI. It is not the best tool for external GUI windows, so the cleanest launch video is usually a hybrid: VHS for the shell, local recorder for `mpv`.

## Story Arc

### Act 1: The Problem

Visual:

- Empty terminal.
- A few fast fake fragments: browser tabs, provider names, "where was I?", "which episode?", "subs?"
- Cut back to a clean prompt.

Voiceover or caption:

> Watching from the terminal should not mean giving up the features that make watching feel good.

Terminal beat:

```bash
kunai
```

Mood:

Quiet, confident. Do not over-explain. Let the app appear.

### Act 2: Search Like A Streaming App

Visual:

- Kunai fullscreen TUI opens.
- Search anime mode first because it has the strongest story: episode flow, sub/dub, intro skip.
- Type a recognizable query.

Suggested query:

```text
Demon Slayer
```

Show:

- Browse results.
- Poster/details pane if available.
- Provider/mode status.
- Command palette with `/`.

Caption:

> Search, inspect, and choose without leaving the shell.

### Act 3: Choose The Exact Episode

Visual:

- Select a result.
- Show season/episode picker.
- Filter or move selection.
- Pick a later episode to imply real catalog navigation.

Show:

- Season picker for series.
- Episode picker.
- Anime sub/dub preference in settings or picker, if useful.
- Subtitle policy or subtitle picker.

Caption:

> Seasons, episodes, subtitles, providers. Structured, not guessed.

### Act 4: Resolve And Open `mpv`

Visual:

- Terminal shows resolving status.
- Provider state changes.
- Cut to `mpv` opening.
- Let the video play for 2-4 seconds.

Caption:

> Kunai finds the stream. `mpv` does the watching.

Recording note:

VHS may not capture the separate `mpv` GUI window. For this shot, use a local screen recorder and cut from the VHS terminal capture into the `mpv` capture.

### Act 5: Show The Magic Features

Visual sequence:

1. Subtitle attached or subtitle inventory ready.
2. Intro skip chip/countdown in `mpv`.
3. Press `b` or let auto-skip trigger.
4. Press `n` for next episode.
5. Shell shows post-playback actions/history/diagnostics.

Caption options:

- `Subtitles attached`
- `Intro detected`
- `Auto-skip armed`
- `Next episode ready`
- `History saved`

Voiceover:

> It is still a terminal app. It just refuses to act like one from the stone age.

### Act 6: Reliability And Diagnostics

Visual:

- Open `/diagnostics`.
- Show provider, subtitle, stream, cache, and recent events.
- Do not linger long.

Caption:

> When providers drift, Kunai tells you what happened.

### Act 7: Outro

Visual:

- Back to shell.
- Maybe show history.
- End on command prompt or Kunai title.

Final line:

> Kunai. Anime, shows, movies, and `mpv` from a terminal that remembered it could be fun.

End card:

```text
Kunai
The terminal can have nice things.
github.com/kitsunekode/kunai
```

## VHS Tape Skeleton

This skeleton captures the terminal story. Tune waits and search terms based on provider speed.

```tape
Output kunai-launch-terminal.gif

Set Width 1600
Set Height 900
Set FontSize 18
Set Theme "Catppuccin Macchiato"
Set Padding 24
Set Margin 24
Set MarginFill "#12121a"
Set BorderRadius 10
Set Framerate 30
Set PlaybackSpeed 0.75

Hide
Type "cd /home/kitsunekode/Projects/hacking/kitsunesnipe"
Enter
Type "clear"
Enter
Show

Sleep 800ms
Type "bun run dev -- -a"
Enter
Wait+Screen /Browse your favorite anime/
Sleep 900ms

Type "Demon Slayer"
Sleep 500ms
Enter
Sleep 2500ms

Type "/"
Sleep 300ms
Type "help"
Sleep 300ms
Enter
Wait+Screen /Global commands/
Sleep 1200ms
Escape
Sleep 500ms

Type "/"
Sleep 300ms
Type "settings"
Sleep 300ms
Enter
Sleep 1200ms
Escape
Sleep 500ms

Type "/"
Sleep 300ms
Type "diagnostics"
Sleep 300ms
Enter
Sleep 1400ms
Escape
Sleep 500ms

Ctrl+C
Wait
```

## Hybrid Capture Plan

Use two recordings:

1. `kunai-launch-terminal.gif` or `.mp4` from VHS for terminal flow.
2. A local screen recording for real playback:
   - Start Kunai normally.
   - Pick the same title and episode.
   - Record the moment `mpv` opens.
   - Capture subtitle attach, skip prompt, and next episode action.

In the edit:

- Cut from terminal "Resolving..." to `mpv` opening.
- Add a short bass hit or visual snap on the `mpv` cut.
- Overlay tiny labels for features instead of long explanatory text.
- Keep each feature shot under 4 seconds.

## Shot Checklist

- Opening terminal
- Anime browse
- Movie or series search
- Result details
- Provider switcher
- Season picker
- Episode picker
- Subtitle setting or picker
- Resolve status
- `mpv` opening
- Subtitle attached
- Intro skip prompt or auto-skip
- Next episode action
- Watch history/resume
- Diagnostics panel
- Final tagline

## Copy Bank

- The terminal can have nice things.
- Streaming-app comfort, CLI speed.
- Search in the shell. Watch in `mpv`.
- Episodes, subtitles, history, providers, diagnostics.
- No browser tab archaeology.
- Inspired by `ani-cli`. Raised with streaming-app expectations.
- It is a TUI, not a punishment.
- Kunai: for people who think arrow keys and good UX can coexist.
