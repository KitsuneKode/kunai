# Architecture Review — Status Board

Living tracker for the architecture deepening orchestrator. Visual before/after report: [architecture-review.html](./architecture-review.html).

## Phase status

| Phase | Focus                                        | Status                                                         |
| ----- | -------------------------------------------- | -------------------------------------------------------------- |
| 0     | Persist review + shared test harness         | completed                                                      |
| 1     | Connectivity seam (reactive online/offline)  | completed                                                      |
| 2     | Kill side-channels + layering inversion      | completed                                                      |
| 3     | `resolveNextUp()` unification                | completed                                                      |
| 4     | PlaybackPhase decompose + PlaybackIntent bus | completed (slice: intent bus + iteration state)                |
| 5     | mpv kernel + IPC resilience                  | completed (slice: shared progress throttle)                    |
| 6     | Resolve/cache/health clarity                 | completed (slice: provider alias helper + advisory health doc) |
| 7     | Post-play honesty + offline continuity       | completed                                                      |
| 8     | Test-debt + clutter sweep                    | completed (slice: fixtures + sink/shell tests)                 |

## Decision log

| Phase | Decision                            | Choice                                                      |
| ----- | ----------------------------------- | ----------------------------------------------------------- |
| 5     | IPC reconnect vs graceful-fail      | graceful-fail + clear surface (reconnect deferred)          |
| 6     | Title-health drives ordering        | advisory-only (documented in ProviderCandidatePlanner)      |
| 7     | `post-playback` RootContentKind     | adopt kind when `postPlayState` is set                      |
| 7     | Runway on offline playback complete | wired `offline-playback-complete` on local episode complete |

## Candidates (summary)

1. **Connectivity seam** — `Connectivity` module with subscribe + `useConnectivityOnline`
2. **Offline-launch mailbox** — removed; typed `OfflinePlaybackRequestResult`
3. **Infra→app-shell inversion** — `PlayerPresentationPort` injected at container
4. **root-content global** — deferred unless second surface
5. **PlaybackPhase god-module** — `PlaybackIntentBus` + `PlaybackIterationState` (full step extraction deferred)
6. **resolveNextUp unused** — `evaluateAutoAdvanceNextUp` in catalog/playlist/rec paths
7. **Four intent channels** — `PlaybackIntentBus` introduced (mailbox collapse deferred)
8. **Post-play kind drift** — `openPlaybackShell` mounts `post-playback` when appropriate
9. **Offline continuity half-wired** — runway enqueue on local playback complete

## Test harness

Shared fixtures live under `apps/cli/test/support/`:

- `container-fixture.ts` — `createContainerFixture()`
- `session-state-fixture.ts` — `createSessionStateFixture()`

Proof migrations: `workflows-history.test.ts`, `command-router.test.ts`, `settings-controller.test.ts`.

Integration isolation: `apps/cli/test/integration/helpers/isolated-container.ts`.

## Env-gated tests (intentional, not in default CI)

- `KUNAI_INSTALLER_DOCKER=1` — native installer docker
- `KUNAI_BINARY_SMOKE=1` — compiled binary smoke
- `pwsh` on PATH — install-scripts-pwsh
- `KUNAI_LIVE_*` / `KUNAI_RELAY_BASE_URL` — live smokes under `test/live/`
