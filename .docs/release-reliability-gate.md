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
bun run pkg:check
bun run release:dry-run
```

Expected result:

- formatting completes without modifying unrelated files
- lint reports 0 warnings and 0 errors
- unit and integration tests report 0 failures
- typecheck exits 0
- build writes `apps/cli/dist/kunai.js`
- package check prints npm pack contents without leaking source-only test fixtures
- release dry-run completes build, checks, and packability without publishing

## Changelog Gate

User-facing changes need a changeset before release:

```sh
bun run changeset
```

The generated `.changeset/*.md` file should summarize behavior, migration, and reliability impact.
The release workflow uses Changesets to open a version PR, update package changelogs, and publish after
that PR is merged.

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
- `skipped` is false
- `providerId`, `engine`, and `resolveDurationMs` are present
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
- Discord application asset `kunai` is uploaded before artwork is treated as verified
- activity clears after the script exits
- if `Open in Kunai` changed, `/presence` can set or clear the safe button URL
- if `kunai://` changed, `kunai --install-protocol-handler --dry-run` shows the expected XDG
  desktop entry, then `kunai --install-protocol-handler` has been run on the smoke machine
- the clicked `kunai://` action shows local confirmation before playback or download

Without `KUNAI_LIVE_DISCORD_PRESENCE=1`, the script must skip safely and avoid Discord IPC.

## Playback Lifecycle Gate

For playback-sensitive changes, confirm the deterministic fake IPC harness remains covered by `bun run test`:

- first play readiness and end-file result
- episode transition through `loadfile`
- property flood before ready work
- external subtitle cleanup
- resume prompt and resume seek
- resume prompt timeout starts over without applying the resume seek
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
- background presence/cache/timing failures appear as redacted diagnostics instead of disappearing silently
- next/previous/refresh controls do not leave the terminal or mpv in a stuck state

## Attention, Queue, And Playlist Gate

Run these when notifications, queue recovery, history, recommendations, downloads, or playlists change:

- open `/notifications` during playback and confirm playback continues
- press `Enter` on a recoverable queue notice and confirm pending items restore without autoplay
- press `a` on a notice and confirm explicit action rows can be selected or escaped without side effects
- press `x` on a notice and confirm it is dismissed
- press `q` in `/history` and confirm the selected title is queued without replacing playback
- press `q` on a search/recommendation row and confirm the selected title is queued without opening playback
- after an episode ends with a recommendation rail visible, press `1` and confirm the pick is queued while the post-playback panel stays open
- queue an item from a non-playback surface and confirm it does not start immediately
- with `KUNAI_EXPERIMENTAL_PROVIDER_AVAILABILITY_SYNC` unset, confirm availability sync records no provider calls
- crash or kill a session with queued items, restart, and confirm a recoverable queue notice appears
- dismiss or ignore the recoverable queue notice and confirm Kunai does not auto-restore
- export a Kunai playlist and inspect the JSON for no stream URLs, headers, cookies, tokens, or local paths
- import a playlist with an unresolved item and confirm the item does not autoplay
