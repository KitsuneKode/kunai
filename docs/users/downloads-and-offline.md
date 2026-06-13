---
title: Downloads And Offline
description: Manage download queues, local playback, cleanup, and offline diagnostics safely.
---

Kunai separates the download queue from the offline library.

## Queue Versus Library

- `/downloads` is for active, failed, queued, and retryable jobs.
- `/library` and `/offline` are for completed local media that can be played.
- `--offline` starts Kunai directly in the completed offline library.
- `--zen --offline` starts in the same local shelf with minimal chrome for quick local playback.

This split keeps "is my download running?" separate from "what can I watch locally?"

## Enabling Downloads

Run:

```sh
kunai --setup
```

The setup flow checks optional tools and lets you enable downloads. `yt-dlp` is required for download processing. `ffprobe` is optional and helps validate completed artifacts. Local artwork sidecars are best-effort and never decide whether a completed video is playable.

## Playing Offline

Use:

```sh
kunai --offline
kunai --zen --offline
```

Or from inside Kunai:

```text
/library
/offline
```

Completed local playback writes history through the same history shape as online playback.

Offline titles are grouped by series/movie name so a shelf does not become a flat pile of files.
Inside a title group you can play a completed item, reveal the folder, re-download an item,
repair missing local files, or delete a whole local title after confirmation.

## Launch download mode

`kunai --download` is a **process flag**, not the same as `/downloads` in the shell:

```sh
kunai --download -S "Dune"
kunai --download -i 438631 -t movie
```

This resolves a title at launch, runs the download flow, and exits without opening the interactive shell queue UI. You need `-S` or `-i` bootstrap.

Inside a normal session:

- `/downloads` — queue overlay (queued, running, failed jobs)
- `/download` during playback — queue the current item for offline

## Safety Rules

- Kunai does not silently delete completed artifacts.
- Cleanup candidates are surfaced explicitly.
- Re-download uses the saved download intent when available.
- Opening the offline library uses local SQLite/filesystem facts and must not trigger provider calls.
- Artifact validation records local size and duration when available, which makes offline rows easier to inspect.
- Delete actions ask for confirmation before removing a whole offline title.
- Network handoff stays explicit: if the local shelf is exhausted, Kunai points you toward online search instead of silently switching modes.

More detail is in [Diagnostics and reporting](/docs/users/diagnostics-and-reporting) and the [CLI reference](/docs/users/cli-reference#mpv-and-diagnostics).
Continue Watching behavior is covered in
[`continue-watching-and-new-episodes.mdx`](./continue-watching-and-new-episodes.mdx).
