---
status: current
lastReviewed: "2026-08-24"
---

# Kunai Release Reliability Gate

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this gate before release candidates and after changes to playback lifecycle, provider resolution, Discord presence, storage, or startup behavior.

```sh
bun run verify:build-pipeline:pr
```

Use the command above before CLI build or release-pipeline changes (covers build, pkg:check, and partial Linux binary compile).

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
- build writes `apps/cli/dist/kunai.js` and the host compiled binary under `apps/cli/dist/bin/`
- an all-target release build writes exactly eight deterministic archives,
  eight preserved raw binaries, `SHA256SUMS`, and `SHA256SUMS.archives`
- package check rejects `dist/bin/**`, source/maps, analyze metafiles, lifecycle scripts, dependency drift, and oversized launcher tarballs
- release dry-run completes build, checks, and packability without publishing

The release workflow additionally opens the exact preserved
`.release-candidate/kunai-npm.tgz` after `release:pack`, both before candidate
upload and after protected-job download. It must contain only `package.json`,
`LICENSE`, `README.md`, and `dist/npm-launcher.mjs` under `package/`; publication
uses those same verified bytes rather than repacking them.

For native release assets, the legacy `SHA256SUMS` name continues to cover the
eight raw compatibility binaries because already-published installers and
updaters request it. `SHA256SUMS.archives` separately covers the eight
archives. Verification rejects
missing, duplicate, unexpected, empty, oversized, hash-mismatched, or
non-canonical assets. A canonical archive has one entry whose name is the raw
asset name and no directory prefix; tar metadata is normalized with executable
mode `0755`, while zip records that Unix mode but Windows extraction does not
promise to restore it. Archive consumers are intentionally outside the first
creation/verification slice. This builder slice does not close issue #132 and
does not yet reduce user downloads: 0.3.0 release dispatch remains blocked until
the installer/updater archive-consumption stack lands and is verified.

## Native Installer Activation Gate

Native install, in-process update, rollback, and uninstall share one short
cross-language activation lock at `{dataDir}/locks/activation.lock`. The Bash,
PowerShell, and TypeScript implementations exclusively create the same schema-1
JSON record (`schemaVersion`, `scope`, `pid`, `version`, `execPath`, `ownerId`,
`acquiredAt`, `hostname`, `processStartId`). A live local owner is waited on for
a bounded interval; fresh live-PID records receive a one-second grace before
process-start validation so Windows contenders do not spawn a probe storm; PID
reuse is then rejected when a process-start identity is available. A valid
foreign-host owner is never declared dead from a local PID probe, and unreadable
metadata receives a short grace period before reclaim.
The acquisition deadline starts before ownership identity is collected or a
same-process contender waits its turn. Every retry sleeps for at most the real
time remaining; failed reclaim attempts return to that same deadline instead of
hot-looping. Poll values at or below zero are clamped to one millisecond in all
three implementations. A zero timeout still permits one uncontended exclusive
create, but never waits. External process-start probes are bounded where the
runtime must launch a helper process.
Stale/corrupt reclamation first publishes a unique token-owned reclaim claim.
Claimants elect one reclaimer by lexical claim order, then that owner re-reads
and atomically renames the canonical file to quarantine for validation. It
publishes its successor lock before removing the claim, so the canonical path
never becomes an acquisition window and no contender can delete a newer owner
through a read/delete race. Release uses the same token-owned quarantine rule.
TypeScript release cleanup and Bash quarantine restoration report failures and
leave the evidence in place; neither path treats failed cleanup as a successful
release or reclaim.

The activation critical section contains only the shared launcher replacement
and `install.json` publication. Artifact download, checksum verification,
versioned binary installation, and `version.json` publication remain under the
independent per-version lock and must complete without holding the activation
lock. If manifest publication fails after launcher replacement, the previous
launcher is restored before the activation lock is released. The lifecycle lock
also excludes new installs while uninstall is active. Its purge-safe guard at
`{dataDir}.lifecycle.lock` remains outside the removable data root; uninstall
holds that guard through the final root operation and never sweeps another
owner's lock after releasing it. Both lifecycle paths use a schema-1 `lifecycle`
record with the same normalized `hostname` and `processStartId` identity fields.
A valid foreign-host lifecycle owner blocks without a local PID probe. On the
same host, a dead PID or a mismatched available process-start identity is stale;
an unavailable identity fails closed while the PID is live. Pre-schema records
remain compatible through legacy local-PID liveness. Empty, unreadable, or
incomplete schema-intent lifecycle records block for a 250-millisecond
partial-write grace, then become recoverable if unchanged or aged past that
grace, so a writer cannot be deleted mid-publication and crash residue does not
block forever.
TypeScript likewise surfaces failure to remove an owner-matching lifecycle
guard; pruning the empty compatibility lock directory remains best-effort.

Run the focused cross-language contract before changing installer activation:

```sh
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/activation-lock.test.ts \
  test/unit/services/update/native-installer/version-lock.test.ts \
  test/unit/services/update/native-installer/install-latest.test.ts \
  test/unit/services/update/native-installer/migrate-flat-install.test.ts \
  test/unit/services/update/native-installer/rollback.test.ts \
  test/unit/services/update/native-installer/native-uninstall.test.ts \
  test/unit/services/update/native-installer/install-diagnostic.test.ts \
  test/integration/install-scripts.test.ts \
  test/integration/install-scripts-pwsh.test.ts
```

The PowerShell integration suite skips when `pwsh` is unavailable locally;
Windows CI remains the required native-platform parity run. `kunai doctor`
reports stale activation ownership without mutating the lock.

## Changelog Gate

User-facing changes need a changeset before release:

```sh
bun run changeset
```

The generated `.changeset/*.md` file should summarize behavior, migration, and reliability impact.
The release workflow uses Changesets to open a version PR, update package changelogs, and publish after
that PR is merged.

## Provider Reality Gate

For a release candidate, run the route-derived signoff first. It derives cases
from the production provider registry so a provider cannot silently disappear
from a hand-written checklist:

```sh
KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
```

Then run one focused live smoke per provider family touched by the change.

Series/movie direct providers:

```sh
bun run test:live:videasy
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

Before changing the default resolve hedge delay, aggregate actual
`provider.resolve.hedge-outcome` diagnostics by route and latency profile. The
current delay values are reasoned defaults; a single local run is not evidence
for global calibration.

## Tracker Sync Promotion Gate

Tracker sync may ship as fail-closed experimental code, but must not be called
release-ready or exposed as a stable feature until this disposable-account gate passes:

```sh
KUNAI_LIVE_SYNC=1 \
KUNAI_LIVE_SYNC_ANILIST_MEDIA_ID=<disposable-media-id> \
bun run test:live:tracker-sync
```

Expected evidence: OAuth returns the matching attempt state; the production
container persists one desired-state mutation in `sync_outbox`; disposal and a
fresh container preserve it; the restarted service drains it; remote read-back
confirms the state; cleanup restores the disposable title and removes test
activity. The isolated profile must be removed at exit. This check is never run
with a maintainer's real library.

## Analytics Deployment Gate

Analytics may ship with an empty endpoint and explicit opt-in because that
configuration sends nothing. Before deploying or configuring a public endpoint:

Run the storage path against a real Postgres. The local harness needs only
Docker — it starts a throwaway database plus the Neon HTTP proxy the driver
requires, migrates, runs, and tears down:

```sh
bun run --cwd apps/analytics-ingest test:pg
```

Against an isolated Neon project instead, opt in explicitly. The suites write
and prune, so they gate on `ANALYTICS_TEST_DATABASE_URL` rather than
`DATABASE_URL`:

```sh
DATABASE_URL=<isolated-neon-url> bun run --cwd apps/analytics-ingest migrate
ANALYTICS_TEST_DATABASE_URL=<isolated-neon-url> bun run --cwd apps/analytics-ingest test
```

Expected evidence: all 12 Postgres integration cases run instead of skip;
the production stable-hash secret is configured; Vercel/Neon secrets, firewall,
retention, cron freshness, and cost limits are verified; a live opt-in ping is
stored once, appears only as bounded aggregate data, and disabling analytics in
Settings stops later sends. These checks block endpoint deployment, not a code
release whose endpoint remains empty.

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

## Migration Upgrade Check

Run before any release that adds a data migration. Fresh-install coverage does
not prove an upgrade: the rows that break a migration are the ones an old
version wrote, and no fixture reproduces those faithfully.

Never point this at the live database — copy it first. The data directory is
platform-resolved by `getKunaiPaths()` in `packages/storage/src/paths.ts`:
Linux `~/.local/share/kunai`, macOS `~/Library/Application Support/kunai`,
Windows `%LOCALAPPDATA%\kunai`.

Copy the `-wal` and `-shm` siblings too, or the copy loses whatever the last
session had not yet checkpointed.

```sh
SHADOW=/tmp/kunai-shadow && rm -rf "$SHADOW" && mkdir -p "$SHADOW"
cp ~/.local/share/kunai/kunai-data.sqlite* "$SHADOW"/   # Linux
```

Record every table's row count, run the migrations against the copy, then
compare. Pass criteria:

- every pre-existing table holds the same number of rows afterwards
- new tables appear empty rather than back-filled with guesses
- the repositories read the migrated rows, and a column added to existing rows
  comes back as `undefined` rather than throwing

Verified for 031–034 on a 2.7 MB database at migration 029: 6 ms, no row
changed, `content_type` reads as `undefined` on all 78 legacy queue rows.

## Time-Rot Sweep

```sh
bun run --cwd apps/cli test:future
```

Runs the unit suite 180 days ahead. A test that owns both sides of its clock
does not care what day it is; one that freezes an injected clock at a literal
while its fixtures use the real clock fails immediately. This class has shipped
three times — the prune-clock bomb, the stats-service window, and the sync
retry wake — and each time it looked like an unrelated CI regression months
later.

Two known wall-clock-dependent tests currently fail under it and are not
release blockers: the install-manifest `updatedAt` test and the `downloadToFile`
total-deadline test. Investigate any _new_ name that appears.

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

## Withdrawing a Released Version

Every gate above exists to stop a bad release shipping. This section is for when
one ships anyway. Rehearse it before tagging, not during an incident.

Nothing here needs a code change. Both update channels resolve a *server-side
mutable pointer*, so withdrawal is a metadata edit and is reversible.

| Channel | Pointer read at runtime | Read by |
| ------- | ----------------------- | ------- |
| `binary` | `https://api.github.com/repos/KitsuneKode/kunai/releases/latest` → `tag_name` | `apps/cli/src/services/update/latest-version.ts` |
| `npm-global`, `bun-global` | `https://registry.npmjs.org/@kitsunekode%2fkunai/latest` | `apps/cli/src/services/update/UpdateService.ts` |

`apps/cli/src/services/update/resolve-latest-version.ts` is the single entry
point that routes an install method to its channel.

### 1. Stop the binary channel

`parseVersionFromTag` rejects prerelease tags, so marking the GitHub release as
a prerelease removes it from `releases/latest` and clients resolve the previous
stable release instead.

```sh
gh release edit v0.3.0 --prerelease
```

Do not delete the release or its assets. Anyone already pinned to that version
still needs the assets to reinstall or roll back, and deletion is not
reversible.

### 2. Stop the npm channel

Move `latest` back and mark the bad version deprecated. Prefer this over
`npm unpublish`, which is only permitted within 72 hours and hard-breaks anyone
who pinned the version.

```sh
npm dist-tag add @kitsunekode/kunai@<previous-good-version> latest
npm deprecate @kitsunekode/kunai@0.3.0 "Withdrawn — run: kunai rollback"
```

The platform packages are exact-version `optionalDependencies` of the launcher,
so moving the launcher's `latest` tag is sufficient; the matching platform
package is pinned by the launcher version that resolves.

### 3. Recover users already on the bad version

`kunai rollback` restores the previously activated version from the versioned
install layout. Verify the real rollback, not only `--dry-run` — it is the
least-exercised path that matters most, and it runs when everything else has
already failed.

```sh
kunai rollback --list
kunai rollback
```

### 4. Say so where people look

Release notes, `README.md`, and the docs site. A withdrawn version that is
withdrawn silently gets reinstalled from a cached tarball, a pinned CI file, or
a blog post.

### Rehearsal

Before tagging, confirm on the candidate that:

- `kunai rollback --list` shows the previous version
- a real `kunai rollback` restores a working launcher and manifest
- `kunai --version` reports the restored version afterwards
- the native installer Docker lifecycle passes (`bun run test:installer:docker`)
