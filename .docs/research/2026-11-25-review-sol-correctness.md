---
status: draft
lastReviewed: "2026-11-25T05:44:33Z"
---

# Review: user-facing correctness, sync and build (GPT 6.2 Sol, 2026-11-25)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

A point-in-time review by GPT 6.2 Sol (Codex-1, high reasoning), run read-only against `16f4d210c`.
Each finding was probed with production helpers, the session reducer and in-memory SQLite, not just
read. Evidence for planning, not authority: the tree wins where they disagree. File references are
as of that commit.

## Verification (2026-11-25, against `main@879b668f4`)

| Finding                                              | Verdict                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7 inbox reports a rejected download as queued        | **Confirmed.** `queueDownloadFromMediaItem` discards `commitDownloadIntent`'s `blocked`/`none` result and the router returns `handled`.                |
| 3 inbox retry can enqueue E01 for an E12 notice      | **Consistent with the code:** the same adapter forwards only `season`/`episode` to `resolveDownloadIntentItems`.                                       |
| 2 stale Settings session reverts tracker preferences | **Consistent with the code:** each sync control writes a whole `sync` object from its own snapshot; Sol reproduced the loss with two config instances. |
| 1, 4, 5, 6, 8, 9, 10                                 | Traced and probed by the reviewer; not independently re-run here.                                                                                      |

The reviewer's own Turbo integration run hit sandbox process and I/O failures (126 failed); it did
not treat those as findings, and neither should a reader.

## Report

## Ranked top 10

| Rank | Severity | Finding                                                                                               | Effort |
| ---: | -------- | ----------------------------------------------------------------------------------------------------- | :----: |
|    1 | High     | Post-play Up Next drops the requested episode and can consume the row when a different episode starts |   M    |
|    2 | High     | A stale Settings session can revert a saved tracker preference while changing another preference      |   M    |
|    3 | High     | Inbox download retries can queue E01 for an anime notice naming E12                                   |   M    |
|    4 | High     | Browse and the Up Next overlay can launch a queued title in the wrong provider lane                   |   M    |
|    5 | High     | Share links can leave playback in the recipient’s previous lane                                       |   M    |
|    6 | Medium   | Calendar selection discards its projected episode and local download choice                           |   M    |
|    7 | Medium   | The inbox reports a download queued and marks the notice read after a rejected enqueue                |   S    |
|    8 | Medium   | Search-anchored share links lose the episode while keeping the resume timestamp                       |   M    |
|    9 | Medium   | Tracker sync resets its Retry-After backoff at each batch boundary                                    |   M    |
|   10 | Low      | A cold CLI integration graph invokes the same development bundle build three times                    |   S    |

Reviewed `t3/audit-user-facing-flows` at `16f4d210cc63e48812ebd83949a9fe10b49887f5`. The worktree was clean at entry. Effort and fix risk are estimates. The findings are distinct from the supplied exclusions. The roadmap already owns general queue, sync, correctness, and CI work. The triggers below identify concrete cases inside those areas. The CI audit asks for duplicate-build measurement and W6 covers the correctness sweep. CI audit:395 Road to 9.5:45

## Findings

### 1. Post-play Up Next loses the episode and consumes the wrong intent

Selecting an explicit S02E07 row from the post-play rail claims that row and returns a playlist advance with the correct numbers. The session controller dispatches the episode, resets content, and carries only the title into the next iteration. Both reset and title selection clear the episode. With no history, playback opens its starting picker. If the viewer selects S01E01, the startup callback acknowledges the original S02E07 claim by ID. In a Bun probe using the production outcome helper, reducer, picker policy, and an in-memory SQLite queue, I measured `target=[2,7]`, `picker=menu`, and `rowStatus=played` after selecting S01E01 and invoking the startup acknowledgement.

I checked the countdown path and the existing outcome tests. The countdown also produces a playlist advance, and the tests check the numbers on that object before the session controller drops them. The sibling history-entry branch already preserves `pending.initialEpisode`.

**Impact.** The viewer can start the wrong episode and lose the pending item they meant to watch. Both series lanes are affected. **Effort M. Fix risk medium** because title-level queue entries and pre-start rollback must stay valid. **Fix direction.** Carry the episode in the pending launch and require confirmed startup to match any explicit episode in the claim.

Evidence — run-post-playback-menu.ts:660, playback-outcome.ts:101, SessionController.ts:136, SessionController.ts:240, SessionState.ts:814, PlaybackPhase.ts:2734, queue-playback-attempt.ts:41, playback-outcome.test.ts:18.

### 2. Two Settings sessions can overwrite each other’s tracker preferences

Open two sessions from the same persisted config. Change AniList “Send episode progress” in A, then change “Pause sync” in B. Both controls produce a replacement `sync` object from that session’s snapshot. The save chain acquires the store lock and reads disk, then overlays the whole dirty top-level `sync` key. Two real `ConfigServiceImpl` instances sharing a cloned in-memory store reproduced the loss with writes strictly sequenced. A saved `trackWatched=true`, B saved a pause, and disk returned to `trackWatched=false`. The same overwrite can restore an older enabled preference after a user disables it. The production sync reader consumes the instance’s config snapshot.

I checked the lock and sibling-store regression. The lock serializes writes. The regression changes distinct top-level keys, so it cannot expose a collision between leaves of `sync`. No remote mutations were made or observed.

**Impact.** Unrelated settings edits can restore an older sync preference on disk and change subsequent tracking behavior. **Effort M. Fix risk medium** across nested settings and migration paths. **Fix direction.** Persist changed sync leaves against the locked live config, with separate tests for pause, opt-out, and a sibling’s unrelated tracker change.

Evidence — sync.ts:114, sync.ts:123, sync.ts:201, apply-settings-to-runtime.ts:36, ConfigServiceImpl.ts:582, bootstrap-persistence.ts:461, config-save-debounce.test.ts:361.

### 3. Inbox retry can enqueue the wrong anime episode

Download failure events enter bootstrap with the failed job ID. Bootstrap emits an anime media target with `absoluteEpisode` and omits season and relative episode. The notification action parses that absolute episode, translates Retry download into a fresh generic media download, and passes only season and episode into the download intent selector. That selector defaults to S01E01. An isolated production-router probe with a stub enqueue port returned `handled` and captured S01E01 for an E12 notice. Even when the episode numbers survive, retry builds a new job using the active session’s provider and default profile, so the original job’s source and output settings can be lost.

I compared the notification entry point with Downloads. Downloads calls `retry(job.id)` and requeues or repairs the existing job. The existing notification test asserts the generic download mapping, which is where the job identity disappears.

**Impact.** A user can download the wrong file or retain an unretried failed job alongside a new download. Notification-backed retries can also lose TMDB or YouTube job settings. **Effort M. Fix risk medium** because old notifications lack an exact job ID. **Fix direction.** Persist the exact job reference for new notices and reuse the Downloads retry path, with an explicit unavailable state or an unambiguous lookup for older notices.

Evidence — bootstrap-services.ts:225, NotificationEngine.ts:191, NotificationActionRouter.ts:133, NotificationActionRouter.ts:219, create-container-media-action-router.ts:263, DownloadIntentService.ts:85, DownloadIntentService.ts:173, download-manager-shell.tsx:438, NotificationActionRouter.test.ts:202.

### 4. The lane depends on how a queued title is opened

Enqueue an anime episode, switch to the series lane, and press Enter on the idle Up Next row or select it in the Up Next overlay. Those routes claim the intended row and carry the title and episode. The title adapter sets `isAnime`. The launch never aligns the session lane, and playback reads the active provider and mode from the session. In the reducer and SQLite queue probe, the adopted title had `isAnime=true` with `mode=series` and the existing TMDB-lane provider. The reverse mismatch applies to a TMDB row selected from anime mode. The queue intent also normalizes stored `video` to `series`, which matters for a YouTube entry enqueued through a generic media action.

I checked whether provider preference compensates. Playback passes the existing mode to the preference helper, which rejects registered cross-lane preferences. The palette’s local-title launch explicitly aligns the lane, and post-play resolves a mode before dispatch. The shared claim bridge tests cover row handoff, with lane routing happening outside that bridge.

**Impact.** An otherwise valid queued title can encounter the wrong picker, provider chain, or identity classification depending on which control starts it. **Effort M. Fix risk medium** across browse, overlay, palette, and post-play. **Fix direction.** Resolve the target lane and provider in the shared queue launch and preserve title-level video intent through the queue adapter.

Evidence — SearchPhase.ts:1319, dispatch-palette-command.ts:142, root-overlay-shell.tsx:1547, root-queue-bridge.ts:80, queue-playback-intent.ts:18, PlaybackPhase.ts:797, playback-provider-switch.ts:121, palette-title-launch.ts:117.

### 5. Share links inherit the previous provider lane

The resolver produces anime, series, or YouTube mode. Startup applies `SET_MODE` only for anime and changes only the provider for other accepted hints. In an isolated bootstrap/reducer probe, opening a YouTube catalog link in a normal series session left `series / vidking`. Opening a TMDB series link in anime mode left `anime / allmanga`. The clipboard `/watch` catalog route returns a title and episode without applying the resolved mode. At startup the prerequisite check also derives yt-dlp requirement from flags and saved mode, before applying a YouTube share.

I checked the reducer, the history-entry handoff, and the share bootstrap tests. `SET_PROVIDER` leaves mode intact. The handoff dispatches title and episode, and the tests exercise anime dispatch and the resolved title rather than cross-lane transitions in all three directions.

**Impact.** A valid shared link can enter the wrong provider lane, and the result depends on the recipient’s previous mode. **Effort M. Fix risk medium** around provider validation, native anime mapping, and the untrusted handoff’s confirmation order. **Fix direction.** Apply the resolved lane and a compatible provider through one shared launch path for `/watch`, `--open`, and confirmed protocol links.

Evidence — resolve-share-target.ts:24, apply-resolved-share-target.ts:39, main.ts:975, main.ts:1052, shell-workflows.ts:2403, SessionState.ts:426, apply-resolved-share-target.test.ts:89.

### 6. Calendar discards its continuation choice at launch

A playable Calendar result goes through the continuation engine. The helper dispatches the selected episode and returns the history-based title. Search then dispatches `SELECT_TITLE`, which clears the episode. A synthetic TMDB Calendar row with S01E03 finished and S01E04 released produced `target=S01E04` and `currentEpisode=S01E04` before the caller’s title dispatch, then `currentEpisode=null` afterward. Playback can reconstruct the same episode when history and the catalog happen to agree. It has lost the Calendar’s explicit target when they diverge. Both `localJobId` branches in the Calendar launcher also take the same provider/history route, so the local choice is left to a later lookup after remote preparation.

I compared History and inline Continue. History consumes a local job via the unified offline launcher. Inline Continue selects the title before the episode. The Calendar test checks only the projection and stops before the clearing transition.

**Impact.** A displayed resume or next-episode action can open the generic picker or resolve a different target. A ready download selected by Calendar can incur remote preparation. **Effort M. Fix risk medium** because calendar projection, anime remapping, and local-only playback share the launch. **Fix direction.** Return an explicit title/episode or local-job launch from Calendar and apply it in title-first order.

Evidence — calendar-continue-launch.ts:125, calendar-continue-launch.ts:155, SearchPhase.ts:1395, SessionState.ts:485, PlaybackPhase.ts:785, history-selection-launch.ts:39, calendar-continue-launch.test.ts:43.

### 7. Inbox reads a rejected download as queued

When enqueue eligibility is denied, such as for missing yt-dlp, the intent service returns `blocked` and dispatches a failure reason. A duplicate or enqueue failure before the first job returns `none`. The container media router discards that result, invokes its queued callback, and returns control to a router that reports `handled`. The inbox then marks the notice read and shows “Download queued.” The stubbed eligibility probe recorded the real failure feedback, zero additional jobs, one queued callback for the blocked action, and a `handled` result.

I checked the outer action flow for a guard. It marks read only for `handled`, so its guard works with the signal it receives. The retry-mapping test stubs an executor that completes and does not check a rejection represented by a resolved result.

**Impact.** A download never appears in Downloads and the attention item is treated as addressed. Both media lanes can hit this. **Effort S. Fix risk low** if partial batch success stays distinguishable from zero queued rows. **Fix direction.** Propagate the typed enqueue result to the action router and only acknowledge an inbox download when at least one job was admitted.

Evidence — DownloadIntentService.ts:115, DownloadIntentService.ts:206, create-container-media-action-router.ts:138, create-container-media-action-router.ts:263, MediaActionRouter.ts:117, notification-action-flow.ts:91, root-overlay-shell.tsx:1428.

### 8. Search-anchored share links drop the episode

Kunai’s own link builder falls back to a search anchor for titles without a portable catalog ID and still encodes season, episode, and timestamp. The resolver’s search branch returns the query, first-result auto-pick, and timestamp without constructing an episode. Bootstrap then clears its episode and passes the query into search. Using the production link builder and bootstrap resolver with a synthetic provider-native series and S02E07 at 42 seconds produced a launch with a query and auto-pick index and no episode. Playback consumes the one-shot timestamp against the episode the regular entry policy chooses. The clipboard search-anchor branch also drops the timestamp before it returns.

I checked the codec and catalog-anchored tests. The codec preserves the coordinates. The catalog branch calls `buildEpisode`; the search branch exits earlier.

**Impact.** A link that names a precise episode can start another episode or open the starting picker. The timestamp can land on a different episode. **Effort M. Fix risk medium** because search may resolve a different title and explicit `-e` already has precedence rules. **Fix direction.** Carry the share episode and timestamp with the search launch and bind both to the chosen title and episode before playback.

Evidence — share-ref-from-title-context.ts:12, share-ref-from-title-context.ts:66, share.ts:271, resolve-share-target.ts:29, apply-resolved-share-target.ts:60, main.ts:1104, shell-workflows.ts:2407, PlaybackPhase.ts:729.

### 9. Tracker backoff stops at the batch boundary

The sync drain processes batches of 25, up to 100 per pass. Its tracker backoff map lives in `drainOnce`, so each subsequent batch starts without it. An in-memory SQLite outbox seeded with 26 due AniList operations and a fake adapter that always requests a 30-second wait made **two adapter calls** in one drain, with all 26 rows deferred. The production adapters call `waitInline` before sending, and the limiter caps that wait at three seconds. They never use the full-wait deferral predicate. That makes a second early network request reachable with a longer Retry-After, though this review measured adapter calls with fixtures only.

I checked the production limiter and the test named “stops asking a rate-limited tracker for the rest of the drain.” The test seeds five rows, within a single batch. The per-row wait remains useful, and the outbox correctly retains deferred items.

**Impact.** A large sync backlog can spend several requests and waits during the same rate-limit window. Each batch can postpone its own rows again. **Effort M. Fix risk medium** because healthy trackers should continue to drain and cancelled claims must be released. **Fix direction.** Keep a per-tracker deadline across batches and passes, and make adapters return a deferred outcome before waiting when the deadline exceeds the inline cap.

Evidence — SyncService.ts:131, SyncService.ts:577, SyncService.ts:625, rate-limit.ts:124, AniListAdapter.ts:623, TmdbAdapter.ts:111, sync-drain.test.ts:833.

### 10. Integration verification rebuilds into the same output directory

A cold CLI Turbo integration graph depends on the package build, then the release-build test directly invokes the build script and the npm-pack guard test invokes the same package build again. The dependency is deliberate because those tests rebuild into the shared `dist/` and can race a concurrent build or cache restore. A forced filtered Turbo run confirmed the graph build executed with **zero cache replays** and reported **93 ms** inside the build script. The separate focused test run measured **111 ms** for release-build and **449 ms** for npm-pack guard, the latter including packing and verification. These are local observations, with hosted CI savings unmeasured.

I checked whether packaging runs a different compiler and whether the Turbo wrapper makes testing vacuous. Both tests use the same development build and distinct assertions. The effective Turbo graph schedules both CLI suites, so the wrapper’s early exit is intentional.

**Impact.** Extra work on cold CI and release verification, plus a fragile shared-output dependency for people running build and integration checks concurrently. **Effort S. Fix risk low** if standalone tests retain a self-contained path and pack checks still cover their fixture. **Fix direction.** Build once into an isolated fixture and let the build and pack assertions consume the same outputs.

Evidence — ci.yml:271, turbo.json:27, release-build.test.ts:10, npm-pack-guard.test.ts:38, run-default-tests.ts:16.

## Competitive gaps ranked by user value

1. **User-supplied Stremio add-ons.** High value for users whose bundled sources lack coverage. MovieBox-TUI documents add-on support. Kunai’s W5 already owns this. A shared probe and ordinary playback/resume behavior are the relevant acceptance criteria. Effort L, integration risk high. [MovieBox-TUI](https://github.com/mesamirh/MovieBox-TUI)
2. **Desktop VLC and IINA.** High value when mpv is unavailable or a user already depends on another player. MovieBox-TUI documents both. At this head desktop VLC is rejected by player-mode resolution, and IINA is absent from the choice enum. VLC work in open PRs is outside this snapshot. Effort M for launch support, L for useful parity with mpv controls. player-choice.ts:44. [MovieBox-TUI](https://github.com/mesamirh/MovieBox-TUI)
3. **M3U and programme guide.** Medium value for users who also watch live channels. MovieBox-TUI documents M3U import, channel categories, and EPG. Kunai’s plan already lists this as a follow-up. Effort L, integration risk medium given the separate live channel and scheduling model. [MovieBox-TUI](https://github.com/mesamirh/MovieBox-TUI)
4. **Watch together using Syncplay.** Medium value for occasional group viewing. ani-cli documents a Syncplay launch flag for mpv. Kunai’s roadmap parks watch rooms. A minimal handoff and the broader shared-session product have different costs. Effort M for the handoff, integration risk medium around player ownership. [ani-cli manual](https://github.com/pystardust/ani-cli/blob/master/ani-cli.1)

The road-to-9.5 list also calls out a pre-play resolution picker. This head already has an opt-in Tracks step before mpv when the inventory qualifies, so I excluded it as a missing capability. PlaybackPhase.ts:2512, 2026-11-24-road-to-9-5.md:130.

## Verification

- **Focused suites:** `bun run --cwd apps/cli test:file --` with the Calendar, share bootstrap, share resolver, playlist outcome, notification router, container media router, sync drain, config debounce, release-build, and npm-pack-guard files. **95 passed, 0 failed** across 10 files in **2.52 s**, plus one separately passing timeout-budget architecture test. These runs bypass Turbo.
- **Fresh Turbo run:** `node_modules/.bin/turbo run test --filter=@kitsunekode/kunai --dry=json` confirmed the task graph. The same command with `--force` executed the build and typechecks. Integration reported **287 passed, 27 skipped, 126 failed** across 41 files, with sandbox-related process and I/O failures observed. I did not attribute every failure to the sandbox. Turbo stopped its unit sibling after integration failed. A standalone `bun run --cwd apps/cli test:unit` remained at the parallel runner banner and was interrupted, exit 130.
- **Fixture scope:** Findings 1–9 were probed with the named helpers, a session reducer, synthetic title and notification data, two config service instances with a fake store, and/or in-memory SQLite. These checks verify the state transitions and service calls described above. Full terminal journeys, decoded playback for the reported cases, remote tracker mutations, live provider health, hosted CI timing, and macOS/Windows behavior remain unverified.
- **Isolation:** Commands used disposable HOME with XDG and Windows profile variables unset and `DO_NOT_TRACK=1`. Offline install hit a read-only cache, so I used the existing local dependency links with worktree-local workspace package resolution. The review added this report and generated ignored test/build artifacts.
