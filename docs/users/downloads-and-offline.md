# Downloads And Offline

Kunai separates the download queue from the offline library.

## Queue Versus Library

- `/downloads` is for active, failed, queued, and retryable jobs.
- `/library` and `/offline` are for completed local media that can be played.
- `--offline` starts Kunai directly in the completed offline library.

This split keeps "is my download running?" separate from "what can I watch locally?"

## Enabling Downloads

Run:

```sh
kunai --setup
```

The setup flow checks optional tools and lets you enable downloads. `yt-dlp` is required for download processing. `ffprobe` is optional and helps validate completed artifacts.

## Playing Offline

Use:

```sh
kunai --offline
```

Or from inside Kunai:

```text
/library
/offline
```

Completed local playback writes history through the same history shape as online playback.

## Safety Rules

- Kunai does not silently delete completed artifacts.
- Cleanup candidates are surfaced explicitly.
- Re-download uses the saved download intent when available.

More design detail lives in [`../../.docs/download-offline-onboarding.md`](../../.docs/download-offline-onboarding.md).
