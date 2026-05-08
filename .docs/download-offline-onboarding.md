# Kunai — Download, Offline Library, And Onboarding

This is the canonical design reference for future download/offline/onboarding work.

Status: partially implemented (feature gate + config fields + `download_jobs` persistence + initial worker + `--setup` + `--offline` landed; shell-native download actions/library playback polish pending).

## Product Shape

Downloads should be a local-first capability:

- current stream plus headers are handed to a local downloader
- status is visible in the shell
- finished files appear in an offline library
- missing dependencies are explained at point of use

The feature must not make startup slower or more fragile.

## Proposed Layers

| Layer             | Responsibility                                                           |
| ----------------- | ------------------------------------------------------------------------ |
| Onboarding wizard | First-run dependency checks, opt-in features, setup rerun                |
| Feature gate      | Pure capability checks such as downloads enabled and ffmpeg available    |
| Download service  | Queue, ffmpeg process lifecycle, progress, retries, SQLite state         |
| Offline library   | Browse and play completed local files from stored download metadata      |
| Notification rail | Small queued status messages for downloads, updates, and offline prompts |

Layering rule: UI asks services for capability/state; services do not render UI.

## Desired Download Behavior

- `ffmpeg` is optional but required for downloads.
- Downloads are opt-in and confirmed before writing large files.
- HLS size is reported honestly as unknown when content length cannot be known.
- Temporary files use a `.tmp.*` suffix and are renamed only after a clean exit.
- Abort deletes temporary files and persists an aborted job state.
- Failed jobs retry with bounded backoff and then surface as failed.
- Quit with active downloads asks whether to keep, wait, or cancel.

## Desired Offline Behavior

- No aggressive startup network probe.
- Offline prompt appears only after a real network failure.
- `--offline` enters local library listing mode from completed `download_jobs`.
- Local files should validate before playback; corrupt or missing files should offer re-download, not crash.

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
