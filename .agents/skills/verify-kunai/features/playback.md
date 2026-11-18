# Playback and post-play

Selecting a result resolves a stream, hands it to mpv, and on exit shows
post-play with resume, replay and next actions; the watch is recorded in
history.

## Sub-features

- `play-select` Enter on a result starts resolve and playback.
- `play-post` post-play offers Resume and Replay for an unfinished title.
- `play-history` the play writes a `history_progress` row.

## How to get to it (user POV)

- Search, then Enter on a result.

## Driving it with agent:drive

- **Play to post-play.**
  `bun run agent:drive -- --mpv fake --show frame,history --verify-citation "Smoke Movie" --keys smoke "<enter>" "<wait:Smoke Movie>" "<enter>" "<wait:Post-play>"`.
  Frame shows `▌ ↵ Resume  same stream · same position` and `Replay  rewatch
  from the start [r]`; the history table holds `"title_id": "tmdb:smoke-movie-1"`
  with `"media_kind": "movie"`.
- **Pre-load failure (the way out).**
  `bun run agent:drive -- --mpv fake --fake-mpv-mode fail-pre-loaded --show frame --keys smoke "<enter>" "<wait:Smoke Movie>" "<enter>" "<wait:Playback failed>"`.
  Frame shows a `Playback failed` panel with `r retry  ·  Enter / Esc dismiss`
  and `[p] providers`. It must surface; a hang is the bug.

## Gotchas

- Known gap (2026-11-18): that failure panel says `An unknown error occurred`
  and marks the provider `✓`, while the logged diagnostic for the same run
  classifies it (`failureClass: expired-stream`, recovery "Refresh the
  provider source"). Quote the panel as it is; do not cite it as proof the
  cause is shown.

- Without `--mpv fake` there is no player, and the drive proves resolve only.
- Fake mpv proves Kunai's orchestration, not decoding. Real playback is L4
  (`KUNAI_REAL_MPV=1`, see the skill).
- A resolve that needs a live provider is out of scope for L2; fixture
  providers are `Smoke *`.
