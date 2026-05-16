# Kunai Release Reliability Gate

Use this gate before release candidates and after changes to playback lifecycle, provider resolution, Discord presence, storage, or startup behavior.

## Required Deterministic Gate

Run from the repo root:

```sh
bun run fmt
bun run lint
bun run test
bun run typecheck
bun run build
```

Expected result:

- formatting completes without modifying unrelated files
- lint reports 0 warnings and 0 errors
- unit and integration tests report 0 failures
- typecheck exits 0
- build writes `apps/cli/dist/kunai.js`

## Provider Reality Gate

Run one live smoke per active provider engine touched by the change.

Series/movie direct providers:

```sh
bun run test:live:vidking
bun run test:live:rivestream
```

Anime providers:

```sh
bun run test:live:allanime
bun run test:live:miruro
```

Expected result for each provider:

- JSON output has `ok: true`
- `streamResolved` is true
- `streamHost` is present
- `failureCodes` is empty or contains only non-blocking fallback evidence when a fallback stream was selected
- output includes `isolatedProfile: true`

Do not run live provider smokes in default CI. They are opt-in checks for provider drift and release confidence.

## Discord Presence Gate

Run this only when Discord Rich Presence behavior changed:

```sh
KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord
```

Expected result:

- Discord desktop app is running
- JSON output has `ok: true` and `skipped: false`
- `clientIdSource` is `default`, `environment`, or `config`
- Discord visibly shows Kunai activity during the smoke
- activity clears after the script exits

Without `KUNAI_LIVE_DISCORD_PRESENCE=1`, the script must skip safely and avoid Discord IPC.

## Playback Lifecycle Gate

For playback-sensitive changes, confirm the deterministic fake IPC harness remains covered by `bun run test`:

- first play readiness and end-file result
- episode transition through `loadfile`
- property flood before ready work
- external subtitle cleanup
- resume prompt and resume seek
- in-process reconnect after `file-loaded`

The fake harness does not replace a manual mpv smoke. It proves app-side orchestration without requiring a real player.

## Manual Smoke

After major playback or shell changes, run at least one real mpv flow:

```sh
bun run dev -- -S "Dune" --jump 1
bun run dev -- -a -S "Attack on Titan" --jump 1
```

Check:

- terminal shell stays responsive
- mpv opens and starts playback
- `/diagnostics` shows provider and playback events
- next/previous/refresh controls do not leave the terminal or mpv in a stuck state
