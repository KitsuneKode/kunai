# Playback and post-play

Users resolve a title to a stream, watch through mpv, and land on post-play actions that reflect real outcomes.

## Sub-features

- `resolve-play` selects a source and starts playback with probed streams only.
- `mpv-progress` advances time-pos and records history progress on fixtures/real mpv tiers.
- `post-play` surfaces resume, next, queue, and return actions matching SQLite.
- `live-provider` pins one production adapter with others disabled.

## How to get to it (user POV)

- Search or direct-id launch, select a row, confirm play when resolve completes.
- Wait for playback chrome or post-play after mpv exits or user stops.

## Driving it with verify-kunai

Preconditions:

- L2 + `--mpv fake` for wiring; L4 `KUNAI_REAL_MPV=1` for real IPC; Kitty `--live --provider ID` for upstream.

- **Fixture playback (L2).** Quickstart smoke play with fake mpv; cite history row and post-play frame.
- **Real mpv (L4).** `KUNAI_REAL_MPV=1 bun run test:agent` real-mpv test — IPC `time-pos` and `history_progress` both advance.
- **Live smoke (Kitty).** `bun run agent:kitty --matrix --live --evidence /tmp/kunai-live-NEW` or single provider pin; read `playback.json` **and** inspect `decoded-frame.png`. Status `playback-progress-observed` is not visual approval.
- **Reverse: cancel / fail.** Stop before resolve completes; queue/history must not claim success without probe gate passage.

## Gotchas

- Provider reachability probes reject HTML challenges and unparsed manifests — a 200 response alone is not a verified stream.
- Intro skips and seeks cannot manufacture the full observation window; see `playback-observation.json` on failure.
- Audio with cover art can show positive dimensions without video — inspect captured video frames.
