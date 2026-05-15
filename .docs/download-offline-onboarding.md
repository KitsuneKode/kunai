# Kunai — Download, Offline Library, And Onboarding

This is the canonical design reference for future download/offline/onboarding work.

Status: in progress (`--download`, `/download`, `/downloads`, `/library`, validated
`--offline`, local poster/timing metadata, and best-effort video thumbnails are implemented;
daemon extraction and batch downloads are still pending).

## Product Shape

Downloads should be a local-first capability:

- current stream plus headers are handed to a local downloader
- status is visible in the shell
- finished files appear in an offline library
- missing dependencies are explained at point of use

The feature must not make startup slower or more fragile.

## Proposed Layers

| Layer             | Responsibility                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Onboarding wizard | First-run dependency checks, opt-in features, setup rerun                                     |
| Feature gate      | Pure capability checks such as downloads enabled and `yt-dlp` available                       |
| Download service  | Queue, yt-dlp process lifecycle, progress, retries, SQLite state                              |
| Media artifacts   | Persist poster URL, cached IntroDB/AniSkip timing, subtitles, and optional thumbnail sidecars |
| Offline library   | Browse and play completed local files from stored download metadata                           |
| Notification rail | Small queued status messages for downloads, updates, and offline prompts                      |

Layering rule: UI asks services for capability/state; services do not render UI.

## Desired Download Behavior

- Downloads use **`yt-dlp`**; **`ffprobe`** on `PATH` is optional for validating completed artifacts.
- **`ffmpeg`** on `PATH` is optional for generating local `*.thumbnail.jpg` sidecars after a successful download.
- Downloads are opt-in and blocked at enqueue time when feature gates are not usable.
- HLS size is reported honestly as unknown when content length cannot be known.
- Temporary files use a `.tmp.*` suffix and are renamed only after a clean exit.
- Abort terminates active download processes (`yt-dlp`), deletes temporary files, and persists an aborted job state.
- App shutdown pauses active downloads, cleans temporary workers, and leaves jobs retryable.
- Failed jobs retry with bounded backoff and then surface as failed when retry limits are exhausted.
- Quit with active downloads asks whether to keep, wait, or cancel; Ctrl+C and signals use the same cleanup path.
- Progress is parsed from yt-dlp newline output and persisted for shell diagnostics/UI.
- Download-only mode resolves a playable stream without launching mpv.
- Selected poster URL and IntroDB/AniSkip timing are persisted at enqueue time when available.
- Thumbnail generation is best-effort and post-completion: failure or missing `ffmpeg` must never fail or delay a completed download.
- Thumbnail sidecars are written through a temporary file and renamed only after a non-empty image exists.

## Desired Offline Behavior

- No aggressive startup network probe.
- Offline prompt appears only after a real network failure.
- `--offline` and `/library` list completed `download_jobs` and validate artifact readability.
- Local files should validate before playback; corrupt or missing files should offer re-download, not crash.
- Offline shelf rows are grouped by title and may render the best local preview image:
  generated thumbnail first, then persisted poster URL, then text-only fallback.
- Opening `/offline` must not fetch remote metadata. Stored poster URLs are only fetched by the
  terminal image renderer when the selected row needs a preview.
- Deleting a downloaded artifact removes the media file, subtitle sidecar, recorded thumbnail,
  and deterministic derived thumbnail path to avoid orphaned local preview files.

## Config Fields (current + planned)

Keep config flat unless the config model is deliberately refactored:

- Current:
  - `onboardingVersion`
  - `downloadsEnabled`
  - `downloadPath`
  - `downloadOnboardingDismissed`
- Planned follow-up fields:
  - `suppressOfflinePrompt` (or keep `downloadOnboardingDismissed` as the canonical equivalent)
  - `autoSkip`

## Related Plan

Implementation is tracked in [download-offline-onboarding.md](../.plans/download-offline-onboarding.md).
