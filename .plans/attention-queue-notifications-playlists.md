# Attention, Queue, Notifications, And Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified attention layer where notifications, Continue Watching, new episodes, queue, playlists, downloads, history, recommendations, and post-playback actions all use one reliable item/action model without hijacking playback context.

**Architecture:** Shared domain engines define media identity, action availability, queue policy, notification policy, and playlist export/import rules. CLI surfaces consume those engines through root-owned overlays so playback/search context stays intact. Provider availability checks are late, budgeted, feature-flagged, and separate from release/catalog facts.

**Tech Stack:** Bun, TypeScript, Ink, `bun:sqlite`, `@kunai/storage`, existing `SessionStateManager`, existing `PlaylistRepository`, existing `DownloadService`, existing diagnostics/correlation services.

---

## Product Principles

- Every surface can suggest or queue; nothing auto-hijacks playback.
- Queue is recoverable runtime state; playlist is durable user taste/state.
- Notifications are user-facing attention items; diagnostics are technical evidence.
- Release detection and provider availability are separate facts.
- Store media identity and provider hints, not raw stream URLs, in notifications, queues, and playlist exports.
- Resolve streams late: when playing, downloading, or prefetching the next imminent item.
- Background sync starts experimental and only touches followed/recent/visible items within a strict budget.
- UI polish can be refined by a UI-oriented agent later, but the action contracts and state ownership must be correct first.

## Data Ownership

Durable user-owned data:

- follow/mute preferences
- durable playlists
- playlist items
- history progress
- download jobs
- explicit notification dismissals

Recoverable runtime data:

- active queue session checkpoint
- queue items
- queue item played/skipped/failed state
- previous queue recovery prompt state

Disposable cache:

- catalog release cache
- provider availability cache
- stream cache
- source inventory
- diagnostics/resolve trace caps

Never store raw provider headers, cookies, auth tokens, or temporary stream URLs in notification, queue, playlist, or public export payloads.

## Rollout Flags

Add feature gates before provider-backed background sync is enabled:

- `attentionInbox`: stable once local-only notification inbox passes tests
- `queueRecovery`: stable once crash recovery tests pass
- `playlistSharing`: beta until import/export confidence UX is complete
- `newEpisodeTracking`: beta with catalog/cache-only projections
- `providerAvailabilitySync`: experimental; disabled by default until manual smoke is boring

Feature gates should be readable by the command router, services, and diagnostics, but UI surfaces should degrade gracefully if a gate is off.

## Existing Code To Build On

- `packages/storage/src/repositories/playlist.ts` already has a session-scoped `playlist_queue`.
- `apps/cli/src/domain/lists/PlaylistService.ts` already wraps queue-like operations for the current session.
- `apps/cli/src/domain/session/command-registry.ts` already exposes `playlist`, `playlist-add`, `downloads`, `library`, `history`, and playback commands.
- `apps/cli/src/services/continuation/continuation-policy.ts` already projects unfinished/upcoming/up-to-date continuation state.
- `apps/cli/src/services/persistence/StorageMaintenanceService.ts` already keeps cache cleanup conservative and non-blocking.

The first implementation pass should extend these seams rather than adding a second queue or a second action router.

---

## Task 1: Shared Media Item And Action Contracts

**Files:**

- Create: `apps/cli/src/domain/media/media-item-identity.ts`
- Create: `apps/cli/src/domain/media/media-action-policy.ts`
- Test: `apps/cli/test/unit/domain/media/media-action-policy.test.ts`
- Modify: `.docs/ux-architecture.md`

- [ ] **Step 1: Add failing tests for action availability**

Create `apps/cli/test/unit/domain/media/media-action-policy.test.ts`:

```ts
import { expect, test } from "bun:test";

import { getMediaActions } from "@/domain/media/media-action-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

const episode: MediaItemIdentity = {
  kind: "episode",
  titleId: "tmdb:1",
  title: "Example Show",
  mediaKind: "series",
  season: 1,
  episode: 6,
  source: "notification",
};

test("media actions preserve playback context by default", () => {
  const actions = getMediaActions({
    item: episode,
    context: {
      surface: "notification",
      playbackActive: true,
      hasQueue: true,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followingState: "not-following",
    },
  });

  expect(actions.map((action) => action.id)).toEqual([
    "queue-next",
    "queue-after-current-chain",
    "queue-end",
    "add-to-playlist",
    "download",
    "open-details",
    "follow-title",
    "dismiss",
  ]);
  expect(actions.find((action) => action.id === "play-now")?.requiresConfirmation).toBe(true);
});

test("media actions hide download when downloads are disabled", () => {
  const actions = getMediaActions({
    item: episode,
    context: {
      surface: "history",
      playbackActive: false,
      hasQueue: false,
      downloadsEnabled: false,
      playlistsEnabled: true,
      followingState: "following",
    },
  });

  expect(actions.some((action) => action.id === "download")).toBe(false);
  expect(actions.some((action) => action.id === "mute-title")).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/domain/media/media-action-policy.test.ts
```

Expected: fail because the new modules do not exist.

- [ ] **Step 3: Add media item identity types**

Create `apps/cli/src/domain/media/media-item-identity.ts`:

```ts
export type MediaItemSource =
  | "search"
  | "history"
  | "notification"
  | "recommendation"
  | "continue"
  | "new-episode"
  | "playlist"
  | "queue"
  | "download"
  | "post-playback";

export type MediaItemIdentity = {
  readonly kind: "movie" | "episode";
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly year?: string;
  readonly posterUrl?: string;
  readonly providerHint?: string;
  readonly externalIds?: Readonly<Record<string, string>>;
  readonly source: MediaItemSource;
};
```

- [ ] **Step 4: Add media action policy**

Create `apps/cli/src/domain/media/media-action-policy.ts`:

```ts
import type { MediaItemIdentity } from "./media-item-identity";

export type MediaActionId =
  | "play-now"
  | "queue-next"
  | "queue-after-current-chain"
  | "queue-end"
  | "add-to-playlist"
  | "download"
  | "open-details"
  | "follow-title"
  | "mute-title"
  | "dismiss";

export type FollowingState = "following" | "muted" | "not-following";

export type MediaAction = {
  readonly id: MediaActionId;
  readonly label: string;
  readonly destructive?: boolean;
  readonly requiresConfirmation?: boolean;
};

export type MediaActionContext = {
  readonly surface:
    | "notification"
    | "history"
    | "recommendation"
    | "search"
    | "playlist"
    | "queue"
    | "post-playback";
  readonly playbackActive: boolean;
  readonly hasQueue: boolean;
  readonly downloadsEnabled: boolean;
  readonly playlistsEnabled: boolean;
  readonly followingState: FollowingState;
};

export function getMediaActions(input: {
  readonly item: MediaItemIdentity;
  readonly context: MediaActionContext;
}): readonly MediaAction[] {
  const actions: MediaAction[] = [];

  actions.push({
    id: "play-now",
    label: "Play now",
    requiresConfirmation: input.context.playbackActive,
  });
  actions.push({ id: "queue-next", label: "Queue next" });
  actions.push({ id: "queue-after-current-chain", label: "Queue after current series" });
  actions.push({ id: "queue-end", label: "Queue at end" });

  if (input.context.playlistsEnabled) {
    actions.push({ id: "add-to-playlist", label: "Add to playlist" });
  }

  if (input.context.downloadsEnabled) {
    actions.push({ id: "download", label: "Download" });
  }

  actions.push({ id: "open-details", label: "Open details" });

  if (input.context.followingState === "following") {
    actions.push({ id: "mute-title", label: "Mute title" });
  } else if (input.context.followingState === "muted") {
    actions.push({ id: "follow-title", label: "Follow title" });
  } else {
    actions.push({ id: "follow-title", label: "Follow title" });
  }

  if (input.context.surface === "notification") {
    actions.push({ id: "dismiss", label: "Dismiss" });
  }

  return actions.filter(
    (action) => action.id !== "play-now" || input.context.surface !== "notification",
  );
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run:

```sh
bun test apps/cli/test/unit/domain/media/media-action-policy.test.ts
```

Expected: pass.

- [ ] **Step 6: Document the action contract**

Add to `.docs/ux-architecture.md` under command or panel behavior:

```md
Actionable media items should use the shared media action policy. Playback-active surfaces may offer `Queue next`, `Queue after current series`, `Queue at end`, `Add to playlist`, `Download`, and `Open details` without closing or replacing the current playback context. `Play now` is a context switch and requires explicit confirmation while playback is active.
```

- [ ] **Step 7: Commit**

```sh
git add apps/cli/src/domain/media/media-item-identity.ts apps/cli/src/domain/media/media-action-policy.ts apps/cli/test/unit/domain/media/media-action-policy.test.ts .docs/ux-architecture.md
git commit -m "feat: add shared media action policy"
```

---

## Task 2: Feature Flags For Attention And Sync Rollout

**Files:**

- Create: `apps/cli/src/domain/features/feature-flags.ts`
- Test: `apps/cli/test/unit/domain/features/feature-flags.test.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`

- [ ] **Step 1: Add failing tests**

Create `apps/cli/test/unit/domain/features/feature-flags.test.ts`:

```ts
import { expect, test } from "bun:test";

import { resolveFeatureFlags } from "@/domain/features/feature-flags";

test("attention inbox and queue recovery are stable by default", () => {
  const flags = resolveFeatureFlags({});
  expect(flags.attentionInbox).toBe(true);
  expect(flags.queueRecovery).toBe(true);
  expect(flags.providerAvailabilitySync).toBe(false);
});

test("experimental provider availability sync is opt-in", () => {
  const flags = resolveFeatureFlags({ providerAvailabilitySync: true });
  expect(flags.providerAvailabilitySync).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```sh
bun test apps/cli/test/unit/domain/features/feature-flags.test.ts
```

Expected: fail because the feature module does not exist.

- [ ] **Step 3: Add feature flag resolver**

Create `apps/cli/src/domain/features/feature-flags.ts`:

```ts
export type FeatureFlags = {
  readonly attentionInbox: boolean;
  readonly queueRecovery: boolean;
  readonly playlistSharing: boolean;
  readonly newEpisodeTracking: boolean;
  readonly providerAvailabilitySync: boolean;
};

export type FeatureFlagOverrides = Partial<FeatureFlags>;

export function resolveFeatureFlags(overrides: FeatureFlagOverrides): FeatureFlags {
  return {
    attentionInbox: overrides.attentionInbox ?? true,
    queueRecovery: overrides.queueRecovery ?? true,
    playlistSharing: overrides.playlistSharing ?? false,
    newEpisodeTracking: overrides.newEpisodeTracking ?? true,
    providerAvailabilitySync: overrides.providerAvailabilitySync ?? false,
  };
}
```

- [ ] **Step 4: Wire config without changing defaults**

Add a `features?: Partial<FeatureFlags>` field to persisted config types. Normalize missing features to `{}` in `ConfigServiceImpl.load` and expose `config.features = resolveFeatureFlags(raw.features ?? {})`.

The default behavior must remain:

- attention inbox on
- queue recovery on
- new episode projection on
- provider availability sync off
- playlist sharing off until import/export UI is ready

- [ ] **Step 5: Run config and feature tests**

```sh
bun test apps/cli/test/unit/domain/features/feature-flags.test.ts apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/domain/features/feature-flags.ts apps/cli/test/unit/domain/features/feature-flags.test.ts apps/cli/src/services/persistence/ConfigService.ts apps/cli/src/services/persistence/ConfigServiceImpl.ts apps/cli/src/container.ts
git commit -m "feat: add attention feature flags"
```

---

## Task 3: Queue Sessions With Crash Recovery

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/repositories/playlist.ts`
- Modify: `apps/cli/src/domain/lists/PlaylistService.ts`
- Test: `packages/storage/test/storage.test.ts`
- Test: `apps/cli/test/unit/domain/lists/PlaylistService.test.ts`

- [ ] **Step 1: Add failing storage tests for queue session state**

Extend `packages/storage/test/storage.test.ts` with:

```ts
test("PlaylistRepository: queue sessions can be marked recoverable and restored", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);
  const session = repo.createQueueSession({
    id: "session-crash",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
  });

  repo.enqueue({
    title: "Example",
    mediaKind: "series",
    titleId: "tmdb:1",
    season: 1,
    episode: 6,
    priority: 0,
    source: "notification",
    sessionId: session.id,
  });
  repo.markQueueSessionRecoverable(session.id, "crash");

  const recoverable = repo.getRecoverableQueueSessions();
  expect(recoverable).toHaveLength(1);
  expect(recoverable[0]?.id).toBe("session-crash");
  expect(repo.getUnplayed("session-crash")).toHaveLength(1);

  db.close();
});
```

- [ ] **Step 2: Run storage test and verify it fails**

```sh
bun test packages/storage/test/storage.test.ts
```

Expected: fail because queue session APIs do not exist.

- [ ] **Step 3: Add migration fields**

Add a new data migration after `009_data_lists`:

```ts
{
  id: "010_data_queue_sessions",
  database: "data",
  sql: `
    CREATE TABLE IF NOT EXISTS playback_queue_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      close_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    ALTER TABLE playlist_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE playlist_queue ADD COLUMN queue_position INTEGER;
    ALTER TABLE playlist_queue ADD COLUMN completed_at TEXT;

    CREATE INDEX IF NOT EXISTS idx_playback_queue_sessions_status
      ON playback_queue_sessions(status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_playlist_queue_status_position
      ON playlist_queue(session_id, status, queue_position ASC, priority DESC, added_at ASC);
  `,
}
```

If `ALTER TABLE ... ADD COLUMN` fails on already-migrated local DBs because the column exists, replace the raw migration with the repo's existing migration pattern for idempotent alter statements.

- [ ] **Step 4: Add queue session repository APIs**

Extend `packages/storage/src/repositories/playlist.ts`:

```ts
export type QueueSessionStatus = "active" | "recoverable" | "closed" | "expired";
export type QueueSessionCloseReason =
  | "clean-exit"
  | "explicit-clear"
  | "crash"
  | "restored"
  | "expired";

export interface QueueSession {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly closeReason?: QueueSessionCloseReason;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

export interface QueueSessionInput {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly createdAt?: string;
}
```

Add methods:

```ts
createQueueSession(input: QueueSessionInput): QueueSession
markQueueSessionRecoverable(id: string, reason: QueueSessionCloseReason): void
closeQueueSession(id: string, reason: QueueSessionCloseReason): void
getRecoverableQueueSessions(limit?: number): QueueSession[]
```

Sort recoverable sessions by `updated_at DESC`.

- [ ] **Step 5: Update PlaylistService semantics**

Rename the service concept in docs/comments to queue service without renaming public files yet:

- `PlaylistService.enqueue` remains available for compatibility
- add `recoverPreviousQueues()`
- add `markRecoverable(reason)`
- add `closeCurrentQueue(reason)`
- add `saveQueueCheckpoint()` if the implementation needs explicit updates

The service must not auto-restore a previous queue. It only exposes recoverable sessions to the notification layer.

- [ ] **Step 6: Run tests**

```sh
bun test packages/storage/test/storage.test.ts apps/cli/test/unit/domain/lists/PlaylistService.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```sh
git add packages/storage/src/migrations.ts packages/storage/src/repositories/playlist.ts packages/storage/test/storage.test.ts apps/cli/src/domain/lists/PlaylistService.ts apps/cli/test/unit/domain/lists/PlaylistService.test.ts
git commit -m "feat: add recoverable queue sessions"
```

---

## Task 4: Notification Repository And Engine

**Files:**

- Create: `packages/storage/src/repositories/notifications.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `apps/cli/src/services/notifications/NotificationEngine.ts`
- Create: `apps/cli/src/services/notifications/NotificationService.ts`
- Test: `packages/storage/test/notifications.test.ts`
- Test: `apps/cli/test/unit/services/notifications/NotificationEngine.test.ts`

- [ ] **Step 1: Add failing notification engine tests**

Create `apps/cli/test/unit/services/notifications/NotificationEngine.test.ts`:

```ts
import { expect, test } from "bun:test";

import { deriveNotifications } from "@/services/notifications/NotificationEngine";

test("new playable episode creates one dedupable notification", () => {
  const notifications = deriveNotifications({
    signals: [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        title: "Example Show",
        mediaKind: "series",
        season: 1,
        episode: 6,
        providerId: "vidking",
        detectedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    mutedTitleIds: new Set(),
    dismissedDedupKeys: new Set(),
  });

  expect(notifications).toHaveLength(1);
  expect(notifications[0]?.dedupKey).toBe("new-playable-episode:tmdb:1:1:6:vidking");
  expect(JSON.stringify(notifications[0])).not.toContain("http");
});

test("muted titles suppress new episode notifications", () => {
  const notifications = deriveNotifications({
    signals: [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        title: "Example Show",
        mediaKind: "series",
        season: 1,
        episode: 6,
        providerId: "vidking",
        detectedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    mutedTitleIds: new Set(["tmdb:1"]),
    dismissedDedupKeys: new Set(),
  });

  expect(notifications).toEqual([]);
});
```

- [ ] **Step 2: Add storage test for dismiss/dedupe**

Create `packages/storage/test/notifications.test.ts`:

```ts
test("NotificationRepository upserts by dedupe key and preserves dismissal", () => {
  const db = migratedDataDb();
  const repo = new NotificationRepository(db);

  repo.upsert({
    dedupKey: "new-playable-episode:tmdb:1:1:6:vidking",
    type: "new-playable-episode",
    titleId: "tmdb:1",
    title: "Example Show",
    mediaKind: "series",
    payloadJson: { season: 1, episode: 6, providerId: "vidking" },
    createdAt: "2026-05-17T00:00:00.000Z",
  });
  repo.dismiss("new-playable-episode:tmdb:1:1:6:vidking", "2026-05-17T00:01:00.000Z");
  repo.upsert({
    dedupKey: "new-playable-episode:tmdb:1:1:6:vidking",
    type: "new-playable-episode",
    titleId: "tmdb:1",
    title: "Example Show",
    mediaKind: "series",
    payloadJson: { season: 1, episode: 6, providerId: "vidking" },
    createdAt: "2026-05-17T00:02:00.000Z",
  });

  const items = repo.listRecent(10);
  expect(items).toHaveLength(1);
  expect(items[0]?.dismissedAt).toBe("2026-05-17T00:01:00.000Z");

  db.close();
});
```

- [ ] **Step 3: Add notification storage migration**

Add data migration:

```ts
{
  id: "011_data_notifications",
  database: "data",
  sql: `
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      dedup_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title_id TEXT,
      title TEXT NOT NULL,
      media_kind TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      dismissed_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_recent
      ON notifications(dismissed_at, updated_at DESC);
  `,
}
```

- [ ] **Step 4: Implement repository**

Create `packages/storage/src/repositories/notifications.ts` with:

- `NotificationRecord`
- `NotificationInput`
- `NotificationRepository.upsert`
- `NotificationRepository.dismiss`
- `NotificationRepository.listRecent`
- `NotificationRepository.deleteExpired`

`upsert` must use `ON CONFLICT(dedup_key) DO UPDATE` and must not clear an existing `dismissed_at`.

- [ ] **Step 5: Implement pure notification engine**

Create `apps/cli/src/services/notifications/NotificationEngine.ts` with signal types:

```ts
export type NotificationSignal =
  | {
      readonly type: "new-playable-episode";
      readonly titleId: string;
      readonly title: string;
      readonly mediaKind: "series" | "anime";
      readonly season: number;
      readonly episode: number;
      readonly providerId: string;
      readonly detectedAt: string;
    }
  | {
      readonly type: "queue-recoverable";
      readonly queueSessionId: string;
      readonly itemCount: number;
      readonly detectedAt: string;
    }
  | {
      readonly type:
        | "download-completed"
        | "download-failed"
        | "presence-issue"
        | "update-available";
      readonly dedupKey: string;
      readonly title: string;
      readonly detectedAt: string;
      readonly payload?: Record<string, unknown>;
    };
```

`deriveNotifications` must:

- suppress muted title IDs
- suppress dismissed dedupe keys
- never include raw URLs
- return stable dedupe keys

- [ ] **Step 6: Implement NotificationService**

Create `apps/cli/src/services/notifications/NotificationService.ts` to:

- accept repository + diagnostics dependencies
- accept signals from queue recovery, releases, downloads, presence, updates
- store derived notifications
- list active/dismissed notifications
- dismiss notifications
- record redacted diagnostics for notification creation/suppression

- [ ] **Step 7: Run tests**

```sh
bun test packages/storage/test/notifications.test.ts apps/cli/test/unit/services/notifications/NotificationEngine.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```sh
git add packages/storage/src/migrations.ts packages/storage/src/repositories/notifications.ts packages/storage/src/index.ts packages/storage/test/notifications.test.ts apps/cli/src/services/notifications/NotificationEngine.ts apps/cli/src/services/notifications/NotificationService.ts apps/cli/test/unit/services/notifications/NotificationEngine.test.ts
git commit -m "feat: add notification repository and engine"
```

---

## Task 5: Follow And Mute Preferences

**Files:**

- Create: `packages/storage/src/repositories/followed-titles.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `apps/cli/src/services/attention/FollowedTitleService.ts`
- Test: `packages/storage/test/followed-titles.test.ts`
- Test: `apps/cli/test/unit/services/attention/FollowedTitleService.test.ts`

- [ ] **Step 1: Add failing follow/mute tests**

Create `apps/cli/test/unit/services/attention/FollowedTitleService.test.ts`:

```ts
import { expect, test } from "bun:test";

import { shouldTrackTitleForNewEpisodes } from "@/services/attention/FollowedTitleService";

test("recent multi-episode watches are eligible for shelf projection but not noisy notifications by default", () => {
  expect(
    shouldTrackTitleForNewEpisodes({
      explicitState: "none",
      recentEpisodeWatchCount: 2,
      lastWatchedAt: "2026-05-17T00:00:00.000Z",
      now: new Date("2026-05-18T00:00:00.000Z"),
    }),
  ).toEqual({ shelf: true, notification: true });
});

test("muted title suppresses shelf and notification tracking", () => {
  expect(
    shouldTrackTitleForNewEpisodes({
      explicitState: "muted",
      recentEpisodeWatchCount: 10,
      lastWatchedAt: "2026-05-17T00:00:00.000Z",
      now: new Date("2026-05-18T00:00:00.000Z"),
    }),
  ).toEqual({ shelf: false, notification: false });
});
```

- [ ] **Step 2: Add storage migration**

Add:

```ts
{
  id: "012_data_followed_titles",
  database: "data",
  sql: `
    CREATE TABLE IF NOT EXISTS followed_titles (
      title_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      state TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_followed_titles_state_updated
      ON followed_titles(state, updated_at DESC);
  `,
}
```

- [ ] **Step 3: Implement repository and service**

States:

- `following`
- `muted`
- `none`

Service rules:

- explicit `following` enables shelf and notifications
- explicit `muted` disables shelf and notifications
- recent watched titles are eligible for shelves
- notifications require either explicit follow or strong interest signal: two or more recent episodes, or watched within the configured recent window

- [ ] **Step 4: Run tests**

```sh
bun test packages/storage/test/followed-titles.test.ts apps/cli/test/unit/services/attention/FollowedTitleService.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/storage/src/migrations.ts packages/storage/src/repositories/followed-titles.ts packages/storage/src/index.ts packages/storage/test/followed-titles.test.ts apps/cli/src/services/attention/FollowedTitleService.ts apps/cli/test/unit/services/attention/FollowedTitleService.test.ts
git commit -m "feat: add follow and mute preferences"
```

---

## Task 6: Release And Provider Availability Projection

**Files:**

- Create: `apps/cli/src/services/attention/ReleaseAvailabilityService.ts`
- Create: `apps/cli/src/services/attention/RefreshBudgetPolicy.ts`
- Modify: `apps/cli/src/services/continuation/ContinuationProjectionService.ts`
- Test: `apps/cli/test/unit/services/attention/ReleaseAvailabilityService.test.ts`
- Test: `apps/cli/test/unit/services/attention/RefreshBudgetPolicy.test.ts`

- [ ] **Step 1: Add failing tests for catalog vs playable separation**

Create `apps/cli/test/unit/services/attention/ReleaseAvailabilityService.test.ts`:

```ts
import { expect, test } from "bun:test";

import { projectReleaseAvailability } from "@/services/attention/ReleaseAvailabilityService";

test("aired but not provider-confirmed does not create playable notification", () => {
  const projection = projectReleaseAvailability({
    titleId: "tmdb:1",
    title: "Example Show",
    mediaKind: "series",
    nextRelease: {
      season: 1,
      episode: 6,
      released: true,
      availableAt: "2026-05-17T00:00:00.000Z",
    },
    providerAvailability: null,
  });

  expect(projection.kind).toBe("aired-unconfirmed");
  expect(projection.notifyPlayable).toBe(false);
});

test("provider-confirmed episode creates playable projection", () => {
  const projection = projectReleaseAvailability({
    titleId: "tmdb:1",
    title: "Example Show",
    mediaKind: "series",
    nextRelease: {
      season: 1,
      episode: 6,
      released: true,
      availableAt: "2026-05-17T00:00:00.000Z",
    },
    providerAvailability: {
      providerId: "vidking",
      playable: true,
      checkedAt: "2026-05-17T00:05:00.000Z",
    },
  });

  expect(projection.kind).toBe("playable");
  expect(projection.notifyPlayable).toBe(true);
});
```

- [ ] **Step 2: Add refresh budget tests**

Create `apps/cli/test/unit/services/attention/RefreshBudgetPolicy.test.ts`:

```ts
import { expect, test } from "bun:test";

import { shouldRefreshAttentionItem } from "@/services/attention/RefreshBudgetPolicy";

test("visible rows can refresh when TTL has elapsed and budget remains", () => {
  expect(
    shouldRefreshAttentionItem({
      reason: "visible-row",
      lastCheckedAt: "2026-05-17T00:00:00.000Z",
      now: new Date("2026-05-17T00:20:00.000Z"),
      ttlMs: 10 * 60 * 1000,
      remainingBudget: 2,
      providerBackoffUntil: null,
    }),
  ).toEqual({ refresh: true, reason: "ttl-elapsed" });
});

test("provider backoff prevents refresh even when TTL elapsed", () => {
  expect(
    shouldRefreshAttentionItem({
      reason: "startup-followed",
      lastCheckedAt: "2026-05-17T00:00:00.000Z",
      now: new Date("2026-05-17T00:20:00.000Z"),
      ttlMs: 10 * 60 * 1000,
      remainingBudget: 2,
      providerBackoffUntil: "2026-05-17T00:30:00.000Z",
    }),
  ).toEqual({ refresh: false, reason: "provider-backoff" });
});
```

- [ ] **Step 3: Implement pure projection and budget policy**

`projectReleaseAvailability` returns:

- `upcoming`
- `aired-unconfirmed`
- `playable`
- `unavailable`
- `unknown`

`shouldRefreshAttentionItem` returns:

- `{ refresh: true, reason: "ttl-elapsed" | "manual" | "visible-row" }`
- `{ refresh: false, reason: "fresh" | "budget-exhausted" | "provider-backoff" | "feature-disabled" }`

- [ ] **Step 4: Keep provider checks out of the default path**

Do not call providers from this task. Wire only cached schedule/provider availability inputs. Provider-backed sync is Task 11.

- [ ] **Step 5: Run tests**

```sh
bun test apps/cli/test/unit/services/attention/ReleaseAvailabilityService.test.ts apps/cli/test/unit/services/attention/RefreshBudgetPolicy.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/services/attention/ReleaseAvailabilityService.ts apps/cli/src/services/attention/RefreshBudgetPolicy.ts apps/cli/src/services/continuation/ContinuationProjectionService.ts apps/cli/test/unit/services/attention/ReleaseAvailabilityService.test.ts apps/cli/test/unit/services/attention/RefreshBudgetPolicy.test.ts
git commit -m "feat: add release availability projection"
```

---

## Task 7: Media Action Router

**Files:**

- Create: `apps/cli/src/services/media-actions/MediaActionRouter.ts`
- Test: `apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts`
- Modify: `apps/cli/src/container.ts`

- [ ] **Step 1: Add failing router tests**

Create `apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts`:

```ts
import { expect, test } from "bun:test";

import { MediaActionRouter } from "@/services/media-actions/MediaActionRouter";

test("queue action delegates to queue service without playing immediately", async () => {
  const calls: string[] = [];
  const router = new MediaActionRouter({
    queue: {
      enqueue: () => {
        calls.push("queue");
      },
    },
    downloads: {
      enqueueMediaItem: async () => {
        calls.push("download");
      },
    },
    notifications: {
      dismiss: () => {
        calls.push("dismiss");
      },
    },
    diagnostics: {
      record: () => undefined,
    },
  });

  await router.handle({
    actionId: "queue-next",
    item: {
      kind: "episode",
      titleId: "tmdb:1",
      title: "Example",
      mediaKind: "series",
      season: 1,
      episode: 6,
      source: "history",
    },
  });

  expect(calls).toEqual(["queue"]);
});
```

- [ ] **Step 2: Implement router**

Create a router that maps:

- `queue-next` -> queue priority/position for next item
- `queue-after-current-chain` -> queue group position after current title chain
- `queue-end` -> queue end
- `add-to-playlist` -> playlist flow request
- `download` -> download service
- `follow-title` / `mute-title` -> follow service
- `dismiss` -> notification service
- `play-now` -> returns a context-switch request and requires confirmation when playback is active

The router must not import Ink components. It may return a result object that UI overlays can render.

- [ ] **Step 3: Wire router into container**

Add `mediaActionRouter` to `Container` with minimal dependencies.

- [ ] **Step 4: Run tests**

```sh
bun test apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/services/media-actions/MediaActionRouter.ts apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts apps/cli/src/container.ts
git commit -m "feat: add media action router"
```

---

## Task 8: Notification Inbox Overlay

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-model.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Test: `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [ ] **Step 1: Add command tests**

Add assertions that `notifications` is available in:

- root overlay context
- active playback context
- post-playback context

The command should not replace current playback state.

- [ ] **Step 2: Add command**

Add `notifications` to `AppCommandId`, `COMMANDS`, and relevant `COMMAND_CONTEXTS`.

Label: `Notifications`

Aliases: `["notifications", "inbox", "alerts"]`

Description: `Review new episodes, queue recovery, downloads, and app notices`

- [ ] **Step 3: Add overlay model**

Add `{ type: "notifications" }` to root overlay types. The subtitle should read:

`Actionable updates without leaving your current context`

- [ ] **Step 4: Render notification picker**

In `root-overlay-shell.tsx`, load active notifications through `container.notificationService.listActive()`. Each row should show:

- title
- reason
- age
- action hint

Return actions should open a local action picker using `getMediaActions` + `MediaActionRouter`.

- [ ] **Step 5: Keep context preservation explicit**

Opening notifications from playback must:

- not call `player.stopCurrentPlayback`
- not clear `currentEpisode`
- not clear `mountedRoot`
- close only the overlay on `Esc`

Add or update tests around root overlay state if needed.

- [ ] **Step 6: Run tests**

```sh
bun test apps/cli/test/unit/domain/session/command-registry-contexts.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```sh
git add apps/cli/src/domain/session/command-registry.ts apps/cli/src/app-shell/root-overlay-model.ts apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/app-shell/panel-data.ts apps/cli/test/unit/domain/session/command-registry-contexts.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
git commit -m "feat: add notification inbox overlay"
```

---

## Task 9: History, Recommendations, Search, And Post-Playback Action Integration

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts` only if item identity needs provider hints
- Test: `apps/cli/test/unit/app-shell/root-overlay-shell.test.ts`
- Test: `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`

- [ ] **Step 1: Add tests for actions from non-notification surfaces**

Cover:

- history item can queue
- recommendation item can queue
- post-playback current item can save queue as playlist later
- download action from an item delegates to shared router

- [ ] **Step 2: Convert panel rows to media identities**

Where surfaces already hold enough data, create `MediaItemIdentity`:

- history rows use history title/season/episode/provider
- recommendation rows use recommendation title identity
- search result rows use search result title identity
- post-playback current item uses active title/current episode

- [ ] **Step 3: Route actions through MediaActionRouter**

Replace surface-specific queue/download/follow/dismiss logic with router calls.

- [ ] **Step 4: Show compact feedback**

Use shell feedback:

- `Queued next: <title>`
- `Queued at end: <title>`
- `Download queued: <title>`
- `Added to playlist: <playlist>`
- `Muted: <title>`

Feedback should disappear through existing shell feedback mechanisms and must not block playback.

- [ ] **Step 5: Run tests**

```sh
bun test apps/cli/test/unit/app-shell/root-overlay-shell.test.ts apps/cli/test/unit/domain/session/command-registry-contexts.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/app-shell/workflows.ts apps/cli/src/app/PlaybackPhase.ts apps/cli/src/services/recommendations/RecommendationServiceImpl.ts apps/cli/test/unit/app-shell/root-overlay-shell.test.ts apps/cli/test/unit/domain/session/command-registry-contexts.test.ts
git commit -m "feat: route media actions across shell surfaces"
```

---

## Task 10: Durable Playlists And Progress Projection

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Create: `packages/storage/src/repositories/playlists.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `apps/cli/src/services/playlists/PlaylistProjectionService.ts`
- Test: `packages/storage/test/playlists.test.ts`
- Test: `apps/cli/test/unit/services/playlists/PlaylistProjectionService.test.ts`

- [ ] **Step 1: Add failing playlist projection tests**

Create `apps/cli/test/unit/services/playlists/PlaylistProjectionService.test.ts`:

```ts
import { expect, test } from "bun:test";

import { projectPlaylistItems } from "@/services/playlists/PlaylistProjectionService";

test("playlist projection joins progress from history without copying it into storage", () => {
  const rows = projectPlaylistItems({
    items: [
      {
        id: "item-1",
        playlistId: "playlist-1",
        titleId: "tmdb:1",
        title: "Example Show",
        mediaKind: "series",
        season: 1,
        episode: 6,
        sortOrder: 0,
        addedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    history: new Map([
      [
        "series:tmdb:1:1:6:none",
        {
          title: "Example Show",
          type: "series",
          season: 1,
          episode: 6,
          timestamp: 600,
          duration: 1200,
          completed: false,
          provider: "vidking",
          watchedAt: "2026-05-17T00:10:00.000Z",
        },
      ],
    ]),
  });

  expect(rows[0]?.progress?.watchedPercent).toBe(50);
});
```

- [ ] **Step 2: Add durable playlist migration**

Add:

```ts
{
  id: "013_data_durable_playlists",
  database: "data",
  sql: `
    CREATE TABLE IF NOT EXISTS user_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
      title_id TEXT NOT NULL,
      title TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      season INTEGER,
      episode INTEGER,
      absolute_episode INTEGER,
      provider_hint TEXT,
      poster_url TEXT,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_playlist_items_playlist_order
      ON user_playlist_items(playlist_id, sort_order ASC, added_at ASC);
  `,
}
```

- [ ] **Step 3: Implement repository**

Repository methods:

- `createPlaylist`
- `renamePlaylist`
- `deletePlaylist`
- `addItem`
- `removeItem`
- `reorderItem`
- `listPlaylists`
- `listItems`
- `snapshotQueueAsPlaylist`

- [ ] **Step 4: Implement progress projection**

Progress is derived from `HistoryStore`/`history_progress`, not stored on internal playlist items.

Projection should expose:

- `watchedPercent`
- `timestampSeconds`
- `durationSeconds`
- `completed`
- `status: "not-started" | "watching" | "completed" | "rewatch"`

- [ ] **Step 5: Run tests**

```sh
bun test packages/storage/test/playlists.test.ts apps/cli/test/unit/services/playlists/PlaylistProjectionService.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add packages/storage/src/migrations.ts packages/storage/src/repositories/playlists.ts packages/storage/src/index.ts packages/storage/test/playlists.test.ts apps/cli/src/services/playlists/PlaylistProjectionService.ts apps/cli/test/unit/services/playlists/PlaylistProjectionService.test.ts
git commit -m "feat: add durable playlists with progress projection"
```

---

## Task 11: Playlist Export And Import

**Files:**

- Create: `apps/cli/src/services/playlists/KunaiPlaylistFormat.ts`
- Create: `apps/cli/src/services/playlists/PlaylistImportService.ts`
- Create: `apps/cli/src/services/playlists/PlaylistExportService.ts`
- Test: `apps/cli/test/unit/services/playlists/PlaylistImportExport.test.ts`
- Docs: `.docs/playlist-sharing.md`

- [ ] **Step 1: Add failing import/export tests**

Create `apps/cli/test/unit/services/playlists/PlaylistImportExport.test.ts`:

```ts
import { expect, test } from "bun:test";

import { exportKunaiPlaylist, importKunaiPlaylist } from "@/services/playlists/KunaiPlaylistFormat";

test("kunai playlist export snapshots progress but never stream URLs", () => {
  const exported = exportKunaiPlaylist({
    title: "Weekend Taste",
    createdAt: "2026-05-17T00:00:00.000Z",
    items: [
      {
        title: "Example Show",
        titleId: "tmdb:1",
        mediaKind: "series",
        season: 1,
        episode: 6,
        externalIds: { tmdb: "1" },
        progress: {
          watchedPercent: 50,
          completed: false,
        },
      },
    ],
  });

  expect(exported.format).toBe("kunai-playlist");
  expect(exported.version).toBe(1);
  expect(JSON.stringify(exported)).not.toContain("http");
});

test("kunai playlist import preserves unresolved items instead of guessing", () => {
  const imported = importKunaiPlaylist({
    format: "kunai-playlist",
    version: 1,
    title: "Imported Taste",
    createdAt: "2026-05-17T00:00:00.000Z",
    items: [
      {
        title: "Unknown Show",
        mediaKind: "anime",
        progress: { watchedPercent: 0, completed: false },
      },
    ],
  });

  expect(imported.items[0]?.matchStatus).toBe("unresolved");
});
```

- [ ] **Step 2: Implement format**

Format:

```ts
export type KunaiPlaylistExport = {
  readonly format: "kunai-playlist";
  readonly version: 1;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly items: readonly KunaiPlaylistExportItem[];
};
```

Rules:

- external IDs are allowed
- progress snapshots are allowed
- user notes are allowed
- stream URLs are forbidden
- local file paths are forbidden unless user explicitly exports an offline-library manifest in a future separate feature

- [ ] **Step 3: Implement import service**

Import matching order:

1. external IDs
2. exact title + media kind + year
3. unresolved item

Unresolved items remain visible and actionable as `Resolve match`, but they do not auto-play, auto-download, or auto-follow.

- [ ] **Step 4: Add docs**

Create `.docs/playlist-sharing.md`:

- what Kunai playlist export includes
- what it does not include
- privacy/security notes
- import confidence behavior
- future AniList/MAL/TMDB sync distinction

- [ ] **Step 5: Run tests**

```sh
bun test apps/cli/test/unit/services/playlists/PlaylistImportExport.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/services/playlists/KunaiPlaylistFormat.ts apps/cli/src/services/playlists/PlaylistImportService.ts apps/cli/src/services/playlists/PlaylistExportService.ts apps/cli/test/unit/services/playlists/PlaylistImportExport.test.ts .docs/playlist-sharing.md
git commit -m "feat: add kunai playlist import export"
```

---

## Task 12: Experimental Provider Availability Sync

**Files:**

- Create: `apps/cli/src/services/attention/AttentionRefreshScheduler.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/container.ts`
- Test: `apps/cli/test/unit/services/attention/AttentionRefreshScheduler.test.ts`
- Docs: `.docs/diagnostics-guide.md`

- [ ] **Step 1: Add failing scheduler tests**

Create `apps/cli/test/unit/services/attention/AttentionRefreshScheduler.test.ts`:

```ts
import { expect, test } from "bun:test";

import { planAttentionRefresh } from "@/services/attention/AttentionRefreshScheduler";

test("scheduler refreshes visible rows before followed background items", () => {
  const plan = planAttentionRefresh({
    featureEnabled: true,
    maxChecks: 3,
    candidates: [
      { titleId: "tmdb:1", reason: "followed", priority: 10 },
      { titleId: "tmdb:2", reason: "visible-row", priority: 1 },
      { titleId: "tmdb:3", reason: "visible-row", priority: 1 },
      { titleId: "tmdb:4", reason: "followed", priority: 10 },
    ],
  });

  expect(plan.map((item) => item.titleId)).toEqual(["tmdb:2", "tmdb:3", "tmdb:1"]);
});

test("scheduler is empty when experimental sync is disabled", () => {
  expect(
    planAttentionRefresh({
      featureEnabled: false,
      maxChecks: 3,
      candidates: [{ titleId: "tmdb:1", reason: "visible-row", priority: 1 }],
    }),
  ).toEqual([]);
});
```

- [ ] **Step 2: Implement planning only**

The first scheduler implementation should plan work and record diagnostics. Provider-backed availability checks should call existing provider/search/catalog services only through narrow ports and only when `providerAvailabilitySync` is enabled.

- [ ] **Step 3: Add runtime guardrails**

Scheduler rules:

- no work during active stream resolve
- no provider checks during active playback unless user explicitly opens refresh
- startup budget default: 3 titles
- visible row budget default: 5 titles
- backoff per provider after failures
- dedupe in-flight checks by title/provider
- abort on app shutdown

- [ ] **Step 4: Wire startup as background task**

Use `runBackgroundTask` like storage maintenance. Failure records diagnostics but never crashes startup.

- [ ] **Step 5: Run tests**

```sh
bun test apps/cli/test/unit/services/attention/AttentionRefreshScheduler.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/services/attention/AttentionRefreshScheduler.ts apps/cli/test/unit/services/attention/AttentionRefreshScheduler.test.ts apps/cli/src/main.ts apps/cli/src/container.ts .docs/diagnostics-guide.md
git commit -m "feat: add experimental attention refresh scheduler"
```

---

## Task 13: MDX / Website Feature Documentation

**Files:**

- Create: `.docs/features/notifications.md`
- Create: `.docs/features/queue.md`
- Create: `.docs/features/playlists.md`
- Create: `.docs/features/continue-watching.md`
- Create: `.docs/features/new-episode-tracking.md`
- Create: `.docs/features/privacy-and-storage.md`
- Modify: `.docs/quickstart.md`
- Modify: `.docs/experience-overview.md`

- [ ] **Step 1: Document user workflows**

Each feature doc must include:

- what the feature does
- how to enable/use it
- what data is stored
- what is never stored
- failure behavior
- troubleshooting
- future demo/video slot

- [ ] **Step 2: Document privacy and export boundaries**

`privacy-and-storage.md` must clearly say:

- notifications/queues/playlists do not include raw stream URLs
- playlist exports are taste/identity/progress snapshots
- provider availability checks are budgeted and opt-in while experimental
- user-owned playlist/history data is durable
- cache maintenance does not delete user-owned facts

- [ ] **Step 3: Run docs formatting**

```sh
bun run fmt:check
```

Expected: pass.

- [ ] **Step 4: Commit**

```sh
git add .docs/features/notifications.md .docs/features/queue.md .docs/features/playlists.md .docs/features/continue-watching.md .docs/features/new-episode-tracking.md .docs/features/privacy-and-storage.md .docs/quickstart.md .docs/experience-overview.md
git commit -m "docs: add attention queue and playlist feature docs"
```

---

## Task 14: Reliability Gate And Manual Smoke Checklist

**Files:**

- Modify: `.docs/testing-strategy.md`
- Modify: `.plans/roadmap.md`
- Modify: `.plans/plan-implementation-truth.md`

- [ ] **Step 1: Add deterministic gate**

Before final merge, run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run fmt:check
bun run test
bun run build
```

Expected:

- typecheck passes
- lint has 0 errors and 0 warnings
- formatting passes
- all unit/integration tests pass
- build emits `dist/kunai.js`

- [ ] **Step 2: Add manual smoke checklist**

Manual smoke before release:

- queue item from history during playback, confirm playback continues
- queue item from notification during playback, confirm playback continues
- queue item from recommendation after playback
- crash/kill app with queue items, restart, confirm restore prompt appears
- dismiss restore prompt, confirm queue is not auto-restored
- save queue as playlist, restart, confirm playlist persists
- export Kunai playlist, inspect JSON for no stream URLs or headers
- import Kunai playlist with unresolved item, confirm it does not autoplay
- enable experimental provider availability sync, confirm max startup checks are respected
- disable experimental provider availability sync, confirm no provider checks run

- [ ] **Step 3: Update roadmap and truth index**

Update `.plans/roadmap.md` and `.plans/plan-implementation-truth.md` to show:

- attention/queue/notification plan status
- stable vs beta vs experimental rollout state
- manual smoke requirements before release

- [ ] **Step 4: Commit**

```sh
git add .docs/testing-strategy.md .plans/roadmap.md .plans/plan-implementation-truth.md
git commit -m "docs: add attention reliability release gate"
```

---

## Completion Criteria

- Media actions are available from notifications, history, recommendations, search, playlists, queue, and post-playback through one policy/router.
- Opening notifications, history, recommendations, queue, or playlist overlays during playback does not stop or replace playback.
- Queue is checkpointed and recoverable after crashes, but never auto-restored into playback without user consent.
- Playlists are durable, named, progress-aware projections over history, and can be exported/imported without stream URLs or sensitive provider data.
- New episode notifications are opt-in/strong-intent only, deduped, dismissible, and never created from provider availability checks that exceeded budget/backoff rules.
- Provider availability sync is experimental and disabled by default until manual smoke proves it does not spam providers or regress playback.
- Storage cleanup continues to respect durable-vs-cache ownership.
- Docs explain user workflows, privacy/storage boundaries, and release smoke checks.
- Final deterministic verification passes.
