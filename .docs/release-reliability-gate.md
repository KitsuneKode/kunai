# Kunai Release Reliability Gate

Use this gate before release candidates and after changes to playback lifecycle, provider resolution, Discord presence, storage, or startup behavior.

## Required Deterministic Gate

Run from the repo root:

```sh
bun run fmt:check
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
bun run test:live:miruro 1159 21 "One Piece"
```

YouTube provider:

```sh
bun run test:live:youtube
# optional cold cache:
KITSUNE_CLEAR_CACHE=1 bun run test:live:youtube
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

Provider smokes should be run once per touched provider family, not in a loop while developing. Repeated iteration belongs in fixture-backed provider tests and mocked fetch/runtime ports.

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
- last-episode EOF opens post-playback controls quickly even when recommendations are unavailable
- auto-next uses a prefetched stream if available and otherwise falls back to normal resolve after a short visible handoff

## Attention, Queue, And Playlist Gate

Run these when notifications, queue recovery, history, recommendations, downloads, or playlists change:

- open `/notifications` during playback and confirm playback continues
- press `Enter` on a recoverable queue notice and confirm pending items restore without autoplay
- press `a` on a notice and confirm explicit action rows can be selected or escaped without side effects
- press `x` on a notice and confirm it is dismissed
- press `q` in `/history` and confirm the selected title is queued without replacing playback
- press `q` on a search/recommendation row and confirm the selected title is queued without opening playback
- after an episode ends with a recommendation rail visible, press `1` and confirm the pick is queued while the post-playback panel stays open
- after an episode ends with a recommendation rail visible, press `i`, open Details, and confirm no provider or download diagnostics are emitted
- from that same recommendation action panel, choose Download then Back/Cancel and confirm no provider resolution or download job is created
- from that same panel, choose Download then confirm queueing and verify the normal download flow starts only after confirmation
- queue an item from a non-playback surface and confirm it does not start immediately
- with `KUNAI_EXPERIMENTAL_PROVIDER_AVAILABILITY_SYNC` unset, confirm availability sync records no provider calls
- crash or kill a session with queued items, restart, and confirm a recoverable queue notice appears
- dismiss or ignore the recoverable queue notice and confirm Kunai does not auto-restore
- export a Kunai playlist and inspect the JSON for no stream URLs, headers, cookies, tokens, or local paths
- import a playlist with an unresolved item and confirm the item does not autoplay

## YouTube Golden Path Gate

Run when the YouTube lane, yt-dlp integration, or `youtubeMetadata` settings change:

| Step           | Action                                              | Pass criteria                                          |
| -------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Mode cycle     | `m` through series → anime → youtube                | Lands in youtube lane                                  |
| Search         | `/S` query in youtube mode                          | Results with duration/channel                          |
| Play           | Enter on result                                     | mpv opens; progress saves                              |
| Quality        | Change quality pre-play                             | Different ytdl-format applied                          |
| Continue       | Quit mid-video, resume from history                 | Restores youtube mode + position                       |
| Playlist       | Open playlist, pick `#N` item                       | Label `#N`, plays                                      |
| Share          | `/share` + `kunai open`                             | Round-trip to same video                               |
| Download       | Enqueue youtube job                                 | Completes; subs sidecar when configured                |
| SponsorBlock   | Enable categories in settings, play sponsored video | Segments skipped (manual verify)                       |
| Diagnostics    | `/diagnostics` in youtube mode                      | yt-dlp version + Invidious health                      |
| Settings       | Change cookies/instance, save                       | Rebind without restart                                 |
| Missing yt-dlp | Temporarily hide yt-dlp binary                      | Play blocked with clear message; search may still work |

Live smoke (opt-in):

```sh
bun run test:live:youtube
```

Expected: `ok: true`, `streamResolved: true`, `streamHost` contains `youtube.com`. When yt-dlp is intentionally absent on the runner, `skipped: true` is acceptable.
