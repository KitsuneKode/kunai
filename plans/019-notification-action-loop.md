# 019 — Make notifications actionable (play / open details from the inbox)

> **2026-07-22 — the remaining half is fully mapped. Read this box first; it is
> the hard part of the work and it is done.**
>
> **The defect is not notification-specific.** Overlays opened by the _direct_
> `OPEN_OVERLAY` route have no channel back to the phase loop, so any result they
> produce is dropped. Three instances of the same hole:
>
> | Site                                             | Dropped result                                         |
> | ------------------------------------------------ | ------------------------------------------------------ |
> | `root-overlay-shell.tsx:823-845` (notifications) | staged playback intent — nobody consumes it            |
> | `root-overlay-shell.tsx:1444` (history)          | `resolveRootHistorySelection` with no pending resolver |
> | `root-workflow-dispatch.ts:21`                   | `ShellWorkflowResult` awaited and **discarded**        |
>
> **Why the obvious fixes do not work** (all three were checked):
>
> - `subscribeNotificationPlayback` — the staged-global pattern that caused the
>   bug. The repo memory note forbids it.
> - `resolveRootHistorySelection` — `RootHistorySelection` demands a full
>   `HistoryProgress` record; a `{title, episode}` intent cannot produce one
>   without fabricating history.
> - Resolving the browse-shell promise from the overlay — **not reachable**.
>   `ink-shell.tsx:59` renders `RootContentBody`, so the overlay tree is a
>   _sibling_ of the `openBrowseShell` promise, not inside it.
>
> **The seam that does exist.** `SearchPhase.ts:690-696` handles a
> `BrowseShellResult` variant `offline-playback` by dispatching `SELECT_TITLE` +
> `SELECT_EPISODE` and returning from the phase — which is exactly how playback
> starts. It is byte-for-byte the same handling as `history-entry`
> (`SearchPhase.ts:900-906`). **It is already the generic "launch this
> title/episode" channel; only its name is offline-specific.**
>
> **Recommended shape.**
>
> 1. Rename the `offline-playback` variant to something honest
>    (`launch-playback`) in `types.ts:380-383` and its two handlers. Pure rename,
>    no behaviour change — do it as its own commit so the real change is readable.
> 2. Add a playback-launch promise bridge mirroring `root-history-bridge.ts`
>    (~40 lines, a proven pattern in this repo), awaited by the phase loop
>    alongside the browse shell.
> 3. Route all three sites above through it, so the direct and palette routes
>    converge instead of drifting.
>
> Steps 2 and 3 are the actual work. Do **not** patch per-action: the three rows
> in the table are one defect, and fixing them separately is what produced the
> current drift.

- **Written against commit**: `01ab215b`
- **Priority**: P1
- **Effort**: M
- **Risk**: MED (re-enters the playback bridge while a session may be live)
- **Depends on**: nothing. Ship 019 and 020 together if possible — 020 fixes a data
  bug that makes `play-now` point at a non-existent provider.

## Why this matters

The maintainer's summary: "we have a notification system but we can't play from
it." That is exactly true, and the cause is one function.

A `download-complete` notice cannot play the file that just downloaded. A
`new-episode` notice cannot play or open the episode it is announcing. Meanwhile
roughly 400 lines of router, confirm-flow, bridge and picker code exist purely to
serve actions that are never emitted. The inbox is the only surface in the product
that knows "a thing you care about just became watchable", and it is a dead end.

## Current state (read these before changing anything)

### 1. The only writer of the action payload emits six ids, none of them play

`apps/cli/src/services/notifications/NotificationService.ts` — around line 142,
`defaultNotificationActionIds()` is the sole writer of `actionJson`. Verify with:

```sh
rg -n 'actionJson' apps/cli/src packages/storage/src
```

It returns one of exactly four arrays, keyed on notification kind:
`["restore-queue","dismiss"]`, `["retry-download","dismiss"]`,
`["update-app","dismiss"]`, `["queue-next","queue-end","dismiss"]`.

### 2. Ten more actions are defined, labelled, and unreachable

`apps/cli/src/app-shell/notification-overlay-model.ts:8` — `OVERLAY_NOTIFICATION_ACTIONS`
advertises `play-now`, `open-details`, `download`, `follow`, `unfollow`, `mute`,
`unmute`, `add-to-watchlist`, `add-to-up-next`, `queue-after-current-chain`.

`getExecutableNotificationActions` (same file, ~line 67) filters that catalogue
against the **stored** list from (1). Since (1) never stores them, none can appear.
Lines 139-172 of the same file already ship finished labels and one-line
explanations for all 17 actions — copy no user can currently read.

`getNotificationPrimaryAction` (~line 51) picks the first non-dismiss id, so Enter
on a "new episode" notice always means _queue-next_.

### 3. The play intent is staged but only consumed on one of two routes

`apps/cli/src/app-shell/root-overlay-bridge.ts`:

- `takeNotificationPlaybackIntent()` (~line 78) has exactly one production caller:
  `apps/cli/src/app-shell/dispatch-palette-command.ts:106` (`openNotificationsOverlay`),
  which reads the intent _after_ the overlay closes.
- `subscribeNotificationPlayback` (~line 52) and `getNotificationPlaybackPending`
  (~line 59) exist, carry a doc comment describing this exact bug, and have **zero**
  production callers. Confirm:

  ```sh
  rg -n 'subscribeNotificationPlayback|getNotificationPlaybackPending' apps/cli/src
  ```

- The sibling **details** bridge _is_ subscribed, at `apps/cli/src/app-shell/browse-shell.tsx:817`.
  That asymmetry is the model to copy.

`apps/cli/src/app-shell/root-overlay-shell.tsx:1015` currently _discards_ the staged
intent when the overlay opens — a workaround for the missing subscription. Line 838
opens `{type:"notifications"}` by direct `OPEN_OVERLAY` whenever `/notifications` is
run from inside another root overlay, which is the route that strands the intent.

Result today: "Play now" sets `overlayStatus` to `"Starting playback"`
(`root-overlay-shell.tsx:1160`), closes the inbox, marks the notice read — and plays
nothing. A success message for a no-op.

### 4. What already works and must not be rebuilt

- `apps/cli/src/services/notifications/NotificationActionRouter.ts:60-129` already
  routes 17 action ids through the shared `MediaActionRouter`, with a confirm gate
  for context switches.
- `apps/cli/src/services/media-actions/create-container-media-action-router.ts:21`
  gives every surface one implementation of queue/watchlist/download/follow/mark-watched.
- `apps/cli/src/app-shell/notification-action-flow.ts:31` implements a
  success-sensitive mark-read policy.

The hard part is done. This plan is a payload change plus one subscription.

## Scope

**In scope**

- `apps/cli/src/services/notifications/NotificationService.ts` — make
  `defaultNotificationActionIds` kind- and payload-aware.
- `apps/cli/src/app-shell/root-overlay-shell.tsx` — subscribe the playback intent;
  delete the discard-on-open workaround at ~line 1015.
- Tests under `apps/cli/test/unit/services/notifications/` and
  `apps/cli/test/unit/app-shell/`.

**Out of scope — do not touch**

- `NotificationActionRouter.ts` and `MediaActionRouter` (already correct).
- The dedup-key shape — that is plan 020. If you change it here the two plans
  conflict.
- `OsNotificationSink` (a no-op stub; separate cleanup).
- Any toast/transient-row work.

## Steps

### Step 1 — Characterize current behavior first

Add `apps/cli/test/unit/services/notifications/notification-action-payload.test.ts`
asserting today's output of `defaultNotificationActionIds` for each kind. Follow the
style of the existing `NotificationService.test.ts`.

```sh
bun test test/unit/services/notifications/notification-action-payload.test.ts
```

Expected: green, documenting the six-id status quo. This is the safety net.

### Step 2 — Make the action payload kind- and payload-aware

`defaultNotificationActionIds` must consider the notification's `item` / payload,
not only its kind. Target matrix:

| kind                | actions                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `new-episode`       | `play-now`, `open-details`, `add-to-up-next`, `queue-end`, `mute`, `dismiss` |
| `download-complete` | `play-now` (offline), `open-details`, `dismiss`                              |
| `download-failed`   | `retry-download`, `open-details`, `dismiss`                                  |
| `queue-recoverable` | `restore-queue`, `dismiss`                                                   |
| `app-update`        | `update-app`, `dismiss`                                                      |

Rules:

- Only emit `play-now` when the notification actually carries something playable —
  a title/episode ref for `new-episode`, a completed local job for
  `download-complete`. `DownloadJobRecord` already has the job id; thread it onto
  the notification payload if it is not there rather than guessing in the UI.
- Only emit `open-details` when a title identity is present.
- Never emit an action id absent from `OVERLAY_NOTIFICATION_ACTIONS`.

**STOP and report** if `download-complete` notifications turn out not to carry a
local job reference at all — that is a payload-schema change with a storage
migration, which is bigger than this plan and needs a decision.

### Step 3 — Subscribe the playback intent in the root shell

In `root-overlay-shell.tsx`, mirror the details bridge at `browse-shell.tsx:817`:

```ts
const pendingPlayback = useSyncExternalStore(
  subscribeNotificationPlayback,
  getNotificationPlaybackPending,
);
```

On a pending intent, take it and drive the same `history-entry` handoff that
`dispatch-palette-command.ts:106` uses. Then **delete** the discard at ~line 1015 —
leaving it in will silently eat the intent you just wired.

### Step 4 — Verify both routes

Both must play:

1. `/notifications` from browse → Enter on a new-episode notice → `play-now`.
2. `/notifications` from **inside another overlay** (open Downloads first) → same.

Route 2 is the one that is broken today; a test that only covers route 1 proves
nothing.

## Done criteria

```sh
cd apps/cli
bun test test/unit/services/notifications/
bun test test/unit/app-shell/notification-overlay-model.test.ts
bun test test/unit/app-shell/root-overlay-bridge.test.ts
cd ../.. && bun run typecheck && bun run lint && bun run test
```

All green, plus:

- A test asserting a `new-episode` payload contains `play-now` and `open-details`.
- A test asserting a `download-complete` payload contains `play-now`.
- A test asserting a staged playback intent is consumed when the inbox is opened
  from **inside another overlay** (the route-2 regression).
- `rg -n 'subscribeNotificationPlayback' apps/cli/src` returns a production hit.

## Test plan

Pattern-match `apps/cli/test/unit/app-shell/notification-action-flow.test.ts` for
fake-container shape. Cover:

- Payload matrix per kind, including the negative cases (no `play-now` without
  something playable).
- Intent consumed on both open routes.
- `play-now` while playback is already active goes through the confirm gate rather
  than mutating the live session directly.

## Maintenance note

`play-now` while a session is live calls `applyMediaItemSessionRouting`, which
mutates the running session. The confirm gate in `NotificationActionRouter` is what
protects that; keep it in any refactor. Review anything that changes
`defaultNotificationActionIds` against `OVERLAY_NOTIFICATION_ACTIONS` — the two must
never drift, and nothing currently enforces that. Consider adding that pairing to
`apps/cli/test/unit/architecture/contract-conformance.test.ts` once this lands.
