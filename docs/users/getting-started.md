# Getting Started

Kunai is a terminal-first media shell. Start it, search for a title, pick what to watch, and Kunai hands playback to `mpv`.

## Common Starts

```sh
kunai
kunai -S "Dune"
kunai -S "Dune" --jump 1
kunai -a -S "Attack on Titan" --jump 1
kunai --continue
kunai --history
kunai --offline
kunai --zen --offline
kunai --discover
kunai --random
kunai --calendar
```

## What The Flags Mean

- `-S "Title"` searches and opens results. It does not auto-play by itself.
- `--jump 1` selects the first result after search.
- `-q` is quick search mode and acts like `--jump 1` when a search query is present.
- `--continue` or `--resume` opens the newest unfinished local history entry.
- `--history` opens history first so you can choose what to continue.
- `--offline` opens completed local downloads first.
- `--zen --offline` opens the completed offline library with minimal chrome.
- `--discover`, `--random`, and `--calendar` start directly in recommendation, surprise, or release views.

## In The Shell

- `/` opens the command palette.
- `/history` opens recent progress.
- `/downloads` manages queued, running, and failed download jobs.
- `/library` or `/offline` opens playable completed downloads.
- `/diagnostics` shows runtime state.
- `/update` checks for a new Kunai version and shows manual update guidance.
- `/filters` adds guided search chips while browsing.
- `/recover` refreshes the current stream during playback; `/fallback` tries the next compatible provider.

## Recommended First Session

1. Run `kunai --setup` to review optional tools and local download defaults.
2. Run `kunai -S "Dune"` or `kunai -a -S "Attack on Titan"`.
3. Press `/` to see context-aware commands.
4. Try `/discover`, `/random`, or `/calendar` when you do not know what to watch.
5. If playback has provider trouble, use `/recover`, `/fallback`, then `/diagnostics`.

More flag details live in [`../../.docs/cli-reference.md`](../../.docs/cli-reference.md).
