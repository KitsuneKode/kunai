# Offline Artwork Cache And Library Previews

Status: planned

## Goal

Make downloaded series and movies feel rich and polished while keeping offline playback fast, local-first, and non-blocking.

## Preview Priority

1. Generated local video thumbnail.
2. Locally cached poster image.
3. Remote poster only when network is available and artwork previews are enabled.
4. Text fallback.

## Download-Time Artwork

- Persist remote poster URL as metadata.
- Best-effort cache poster bytes after download completion.
- Generate local video thumbnail when `ffmpeg` is available.
- Artwork failure never fails the download job.
- Record artwork failures as diagnostics/debug facts only.

## Lazy Repair

- If local thumbnail and local cached poster are missing, offline library may repair artwork only when:
  - network is available
  - artwork previews are enabled
  - the item has a remote poster URL
- Lazy repair must dedupe in-flight poster fetches and never block navigation/playback.

## UI Contract

- Offline library should feel offline-first.
- Missing artwork shows calm text fallback.
- Do not show network warnings just because remote artwork cannot load.
- If previews are disabled, do not fetch/render remote artwork.
- Keep rendered terminal image cache bounded and renderer-aware.

## Tests

- Offline preview prefers generated thumbnail over cached poster over remote.
- Offline library does not fetch remote poster when offline.
- Artwork repair is skipped when previews are disabled.
- Poster fetch failure does not fail download completion.
- Rapid selection changes do not create duplicate poster fetches.
