# Availability Spine + Notifications Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new-episode availability data correct (single-writer release-progress) and surface it through a real notifications center — new kinds, unread/read + archive lifecycle, and a rich paginated surface.

**Architecture:** A `ReleaseProgressWriter` makes optimistic (calendar) writes never clobber a fresh authoritative (reconciliation) row. Notification signals are derived for followed-title new episodes, download complete/failed, and app-update, persisted via a migration that adds `read_at`/`archived_at`. A pure `buildNotificationsView` + render-only `NotificationsShell` (modeled on `QueueShell`) replace the list-picker.

**Tech Stack:** Bun, Ink 7 (React 19), `bun run test:file <path>` (single-file) / `bun run test` (full), `captureFrame` harness, sqlite migrations (`packages/storage/src/migrations.ts`), `usePosterPreview` (text mini-posters).

**Spec:** `docs/superpowers/specs/2026-06-14-availability-spine-and-notifications-design.md`

**Working dir:** `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli` for tests/typecheck/lint; `git -C /home/kitsunekode/Projects/hacking/kitsunesnipe` for commits (avoids cwd drift). Single-file tests: `bun run test:file <path>`.

---

## File Structure

| File                                                                           | Responsibility                                                                           | Action                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------- |
| `apps/cli/src/services/release-reconciliation/ReleaseProgressWriter.ts`        | Single write path; optimistic-never-clobbers-fresh-authoritative merge                   | Create                  |
| `apps/cli/src/app/calendar-results.ts`                                         | Use writer for optimistic write                                                          | Modify (~102)           |
| `apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts` | Use writer for authoritative writes                                                      | Modify (3 upsert sites) |
| `apps/cli/src/container.ts`                                                    | Construct writer; inject; wire new-episode/download-failed/app-update signals            | Modify                  |
| `packages/storage/src/migrations.ts`                                           | `020_data_notifications_read_archive`                                                    | Modify                  |
| `packages/storage/src/repositories/notifications.ts`                           | `read_at`/`archived_at` fields; markRead/markAllRead/archive/countUnread/paginated lists | Modify                  |
| `apps/cli/src/services/notifications/NotificationService.ts`                   | Mirror new repo methods                                                                  | Modify                  |
| `apps/cli/src/services/notifications/NotificationEngine.ts`                    | `download-failed` + `app-update` signals/derivations                                     | Modify                  |
| `apps/cli/src/services/notifications/notification-update-signal.ts`            | Pure: UpdateCheckResult → app-update signal-or-null                                      | Create                  |
| `apps/cli/src/app-shell/notifications-view.ts`                                 | Pure view-model: tabs, unread, pagination, kind glyph/poster, relative time, empty       | Create                  |
| `apps/cli/src/app-shell/notifications-shell.tsx`                               | Render-only NotificationsShell + poster mini                                             | Create                  |
| `apps/cli/src/app-shell/root-overlay-shell.tsx`                                | Mount NotificationsShell; tabs/page/read/archive input; open marks read                  | Modify                  |
| `apps/cli/src/app-shell/root-status-summary.ts`                                | Bell uses unread count, hidden at zero                                                   | Modify                  |

---

## Task 1: ReleaseProgressWriter (foundation)

**Files:**

- Create: `apps/cli/src/services/release-reconciliation/ReleaseProgressWriter.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/release-progress-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import type { ReleaseProgressProjection } from "@kunai/storage";
import { ReleaseProgressWriter } from "@/services/release-reconciliation/ReleaseProgressWriter";

function projection(over: Partial<ReleaseProgressProjection> = {}): ReleaseProgressProjection {
  return {
    titleId: "t1",
    mediaKind: "series",
    source: "tmdb",
    title: "Show",
    anchorEpisode: 1,
    newEpisodeCount: 0,
    status: "up-to-date",
    checkedAt: "2026-06-14T00:00:00.000Z",
    nextCheckAt: "2026-06-14T02:00:00.000Z",
    staleAfterAt: "2026-06-15T00:00:00.000Z",
    sourceFingerprint: "fp",
    errorCount: 0,
    ...over,
  };
}

function fakeRepo() {
  const rows = new Map<string, ReleaseProgressProjection>();
  return {
    upsert: (p: ReleaseProgressProjection) => rows.set(p.titleId, p),
    getByTitleIds: (ids: readonly string[]) => {
      const m = new Map<string, ReleaseProgressProjection>();
      for (const id of ids) {
        const r = rows.get(id);
        if (r) m.set(id, r);
      }
      return m;
    },
    _rows: rows,
  };
}

describe("ReleaseProgressWriter", () => {
  it("authoritative always writes", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(projection({ newEpisodeCount: 3 }));
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(3);
  });

  it("optimistic writes when no existing row", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertOptimistic(projection({ newEpisodeCount: 2 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(2);
  });

  it("optimistic skips when a fresh row already exists", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(
      projection({ newEpisodeCount: 0, staleAfterAt: "2026-06-15T00:00:00.000Z" }),
    );
    writer.upsertOptimistic(projection({ newEpisodeCount: 5 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(0); // authoritative preserved
  });

  it("optimistic writes when the existing row is stale", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(
      projection({ newEpisodeCount: 0, staleAfterAt: "2026-06-14T00:30:00.000Z" }),
    );
    writer.upsertOptimistic(projection({ newEpisodeCount: 5 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/services/release-reconciliation/release-progress-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { ReleaseProgressCacheRepository, ReleaseProgressProjection } from "@kunai/storage";

type WriterRepo = Pick<ReleaseProgressCacheRepository, "upsert" | "getByTitleIds">;

/**
 * Single write path for release_progress_cache. Authoritative writes (from
 * ReleaseReconciliationService) always win. Optimistic writes (from the calendar)
 * apply only when there is no row, or the existing row is already stale — so an
 * optimistic "+N new" guess never clobbers a fresh authoritative projection. This
 * resolves the calendar/reconciliation writer race.
 */
export class ReleaseProgressWriter {
  constructor(private readonly repo: WriterRepo) {}

  upsertAuthoritative(projection: ReleaseProgressProjection): void {
    this.repo.upsert(projection);
  }

  upsertOptimistic(projection: ReleaseProgressProjection, now: string): void {
    const existing = this.repo.getByTitleIds([projection.titleId]).get(projection.titleId);
    if (existing && existing.staleAfterAt > now) return; // fresh row wins
    this.repo.upsert(projection);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file test/unit/services/release-reconciliation/release-progress-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/release-reconciliation/ReleaseProgressWriter.ts apps/cli/test/unit/services/release-reconciliation/release-progress-writer.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(release): single-writer guard for release-progress (resolve calendar/reconciliation race)"
```

---

## Task 2: Route calendar + reconciliation through the writer

**Files:**

- Modify: `apps/cli/src/app/calendar-results.ts:102` (optimistic)
- Modify: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts` (3 authoritative upserts)
- Modify: `apps/cli/src/container.ts` (construct writer; inject into reconciliation + expose for calendar)

- [ ] **Step 1: Construct the writer in container.ts**

Find where `releaseProgressCache` repo is constructed (search `new ReleaseProgressCacheRepository` or `releaseProgressCache`). Immediately after, add:

```ts
const releaseProgressWriter = new ReleaseProgressWriter(releaseProgressCache);
```

Add the import at the top:

```ts
import { ReleaseProgressWriter } from "./services/release-reconciliation/ReleaseProgressWriter";
```

Pass `writer: releaseProgressWriter` into the `ReleaseReconciliationService` options (Task 2 Step 3 adds the option), and ensure the calendar-results consumer can reach it (it reads `container.releaseProgressCache`; add `releaseProgressWriter` to the container object so calendar uses it).

- [ ] **Step 2: calendar optimistic write**

In `calendar-results.ts`, change the guard + write (~59 and ~102). Replace `container.releaseProgressCache.upsert(projection)` with:

```ts
container.releaseProgressWriter.upsertOptimistic(projection, now);
```

Update the `container` parameter type used in this file to include
`releaseProgressWriter?: Pick<ReleaseProgressWriter, "upsertOptimistic">` and keep the
existing `releaseProgressCache` guard check, or switch the guard to
`if (container.releaseProgressWriter && container.historyStore)`.

- [ ] **Step 3: reconciliation authoritative writes**

In `ReleaseReconciliationService.ts`, add `writer: ReleaseProgressWriter` to
`ReleaseReconciliationServiceOptions`. Replace each of the 3
`this.options.repository.upsert(X)` calls with
`this.options.writer.upsertAuthoritative(X)`. Keep `repository` for reads.

- [ ] **Step 4: Typecheck + reconciliation tests**

Run: `bun run typecheck`
Then: `bun run test:file test/unit/services/release-reconciliation/`
Expected: PASS (existing reconciliation tests still green; if they construct the service, add `writer: new ReleaseProgressWriter(repo)` to their options).

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app/calendar-results.ts apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts apps/cli/src/container.ts apps/cli/test/unit/services/release-reconciliation/
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(release): route calendar + reconciliation writes through the single writer"
```

---

## Task 3: Notification storage — read/archive migration + repo methods

**Files:**

- Modify: `packages/storage/src/migrations.ts` (append migration `020`)
- Modify: `packages/storage/src/repositories/notifications.ts`
- Test: `apps/cli/test/unit/storage/notifications-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { NotificationRepository } from "@kunai/storage";
import { dataMigrations, runMigrations } from "@kunai/storage";

function repo() {
  const db = new Database(":memory:");
  runMigrations(db as never, "data", dataMigrations);
  return new NotificationRepository(db as never);
}

const base = (dedupKey: string, updatedAt: string) => ({
  dedupKey,
  kind: "new-episode",
  title: `T ${dedupKey}`,
  body: "b",
  createdAt: updatedAt,
  updatedAt,
});

describe("NotificationRepository read/archive", () => {
  it("counts unread, marks read, and clears the unread count", () => {
    const r = repo();
    r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
    r.upsert(base("b", "2026-06-14T02:00:00.000Z"));
    expect(r.countUnread()).toBe(2);
    r.markRead("a", "2026-06-14T03:00:00.000Z");
    expect(r.countUnread()).toBe(1);
    r.markAllRead("2026-06-14T04:00:00.000Z");
    expect(r.countUnread()).toBe(0);
  });

  it("archive removes from active and appears in archived", () => {
    const r = repo();
    r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
    r.archive("a", "2026-06-14T05:00:00.000Z");
    expect(r.listActive(50, 0).map((n) => n.dedupKey)).not.toContain("a");
    expect(r.listArchived(50, 0).map((n) => n.dedupKey)).toContain("a");
  });

  it("paginates active notifications", () => {
    const r = repo();
    for (let i = 0; i < 5; i++) r.upsert(base(`k${i}`, `2026-06-14T0${i}:00:00.000Z`));
    expect(r.listActive(2, 0)).toHaveLength(2);
    expect(r.listActive(2, 4)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/storage/notifications-repository.test.ts`
Expected: FAIL — `countUnread`/`markRead`/`archive`/`listArchived` undefined; `listActive` arity.

- [ ] **Step 3: Append the migration**

In `packages/storage/src/migrations.ts`, after migration `019_data_history_poster_url` (the last entry in `dataMigrations`), add:

```ts
  {
    id: "020_data_notifications_read_archive",
    database: "data",
    sql: `
      ALTER TABLE notifications ADD COLUMN read_at TEXT;
      ALTER TABLE notifications ADD COLUMN archived_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_notifications_active
        ON notifications(archived_at, updated_at DESC);
    `,
  },
```

- [ ] **Step 4: Extend the repository**

In `notifications.ts`: add `readAt?` / `archivedAt?` to `NotificationRecord`, the row
type (`read_at`/`archived_at`), and `mapNotificationRow`. Then replace `listActive` and
add methods:

```ts
  listActive(limit = 50, offset = 0): NotificationRecord[] {
    return this.db
      .query<NotificationRow, [number, number]>(
        `SELECT * FROM notifications
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map(mapNotificationRow);
  }

  listArchived(limit = 50, offset = 0): NotificationRecord[] {
    return this.db
      .query<NotificationRow, [number, number]>(
        `SELECT * FROM notifications
         WHERE archived_at IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map(mapNotificationRow);
  }

  countActive(): number {
    return (
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM notifications WHERE archived_at IS NULL",
        )
        .get()?.n ?? 0
    );
  }

  countUnread(): number {
    return (
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM notifications WHERE archived_at IS NULL AND read_at IS NULL",
        )
        .get()?.n ?? 0
    );
  }

  markRead(dedupKey: string, now: string): void {
    this.db
      .query("UPDATE notifications SET read_at = ? WHERE dedup_key = ? AND read_at IS NULL")
      .run(now, dedupKey);
  }

  markAllRead(now: string): void {
    this.db
      .query("UPDATE notifications SET read_at = ? WHERE archived_at IS NULL AND read_at IS NULL")
      .run(now);
  }

  archive(dedupKey: string, now: string): void {
    this.db
      .query("UPDATE notifications SET archived_at = ?, updated_at = ? WHERE dedup_key = ?")
      .run(now, now, dedupKey);
  }
```

Keep `dismissByDedupKey` for backward compat but it is no longer the primary path.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file test/unit/storage/notifications-repository.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add packages/storage/src/migrations.ts packages/storage/src/repositories/notifications.ts apps/cli/test/unit/storage/notifications-repository.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(storage): notifications read/archive state + pagination"
```

---

## Task 4: NotificationService mirrors new methods

**Files:**

- Modify: `apps/cli/src/services/notifications/NotificationService.ts`
- Test: `apps/cli/test/unit/services/notifications/notification-service.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { NotificationRepository, dataMigrations, runMigrations } from "@kunai/storage";
import { NotificationService } from "@/services/notifications/NotificationService";

function service() {
  const db = new Database(":memory:");
  runMigrations(db as never, "data", dataMigrations);
  const repo = new NotificationRepository(db as never);
  return new NotificationService({ repo, getMutedTitleIds: () => new Set() });
}

describe("NotificationService lifecycle", () => {
  it("records, counts unread, archives", () => {
    const svc = service();
    svc.recordSignals(
      [
        {
          type: "queue-recoverable",
          queueSessionId: "q1",
          itemCount: 3,
          updatedAt: "2026-06-14T01:00:00.000Z",
        },
      ],
      "2026-06-14T01:00:00.000Z",
    );
    expect(svc.countUnread()).toBe(1);
    svc.markAllRead("2026-06-14T02:00:00.000Z");
    expect(svc.countUnread()).toBe(0);
    const [n] = svc.listActive(50, 0);
    svc.archive(n!.dedupKey, "2026-06-14T03:00:00.000Z");
    expect(svc.listActive(50, 0)).toHaveLength(0);
    expect(svc.listArchived(50, 0)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/services/notifications/notification-service.test.ts`
Expected: FAIL — `countUnread`/`markAllRead`/`archive`/`listArchived` undefined; `listActive` arity.

- [ ] **Step 3: Implement**

In `NotificationService.ts`, change `listActive` and add methods delegating to the repo:

```ts
  listActive(limit = 50, offset = 0): NotificationRecord[] {
    return this.deps.repo.listActive(limit, offset);
  }

  listArchived(limit = 50, offset = 0): NotificationRecord[] {
    return this.deps.repo.listArchived(limit, offset);
  }

  countUnread(): number {
    return this.deps.repo.countUnread();
  }

  countActive(): number {
    return this.deps.repo.countActive();
  }

  markRead(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.markRead(dedupKey, now);
  }

  markAllRead(now = new Date().toISOString()): void {
    this.deps.repo.markAllRead(now);
  }

  archive(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.archive(dedupKey, now);
  }
```

Keep `dismiss` delegating to `dismissByDedupKey` for compatibility.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file test/unit/services/notifications/notification-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/notifications/NotificationService.ts apps/cli/test/unit/services/notifications/notification-service.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): service read/archive/pagination methods"
```

---

## Task 5: NotificationEngine — download-failed + app-update signals

**Files:**

- Modify: `apps/cli/src/services/notifications/NotificationEngine.ts`
- Modify: `apps/cli/src/services/notifications/NotificationService.ts` (`defaultNotificationActionIds`)
- Modify: `apps/cli/src/services/notifications/NotificationActionRouter.ts` (`NotificationActionId` union: add `update-app`, `retry-download`)
- Test: `apps/cli/test/unit/services/notifications/notification-engine.test.ts` (extend/create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { deriveNotifications } from "@/services/notifications/NotificationEngine";

const now = "2026-06-14T01:00:00.000Z";

describe("deriveNotifications new kinds", () => {
  it("derives a download-complete notification", () => {
    const [n] = deriveNotifications({
      signals: [
        {
          type: "download-complete",
          titleId: "t1",
          mediaKind: "series",
          title: "Show",
          season: 1,
          episode: 5,
        },
      ],
      mutedTitleIds: new Set(),
      now,
    });
    expect(n?.kind).toBe("download-complete");
    expect(n?.dedupKey).toBe("download-complete:t1:1:5");
  });

  it("derives a download-failed notification", () => {
    const [n] = deriveNotifications({
      signals: [
        {
          type: "download-failed",
          titleId: "t1",
          mediaKind: "series",
          title: "Show",
          season: 1,
          episode: 5,
          error: "network",
        },
      ],
      mutedTitleIds: new Set(),
      now,
    });
    expect(n?.kind).toBe("download-failed");
    expect(n?.dedupKey).toContain("download-failed:t1");
  });

  it("derives an app-update notification", () => {
    const [n] = deriveNotifications({
      signals: [{ type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" }],
      mutedTitleIds: new Set(),
      now,
    });
    expect(n?.kind).toBe("app-update");
    expect(n?.dedupKey).toBe("app-update:1.3.0");
    expect(n?.title).toContain("1.3.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/services/notifications/notification-engine.test.ts`
Expected: FAIL — signal types unknown / no derivation.

- [ ] **Step 3: Implement engine**

In `NotificationEngine.ts`, extend the `NotificationSignal` union:

```ts
  | {
      readonly type: "download-complete";
      readonly titleId: string;
      readonly mediaKind: string;
      readonly title: string;
      readonly season?: number;
      readonly episode?: number;
    }
  | {
      readonly type: "download-failed";
      readonly titleId: string;
      readonly mediaKind: string;
      readonly title: string;
      readonly season?: number;
      readonly episode?: number;
      readonly error: string;
    }
  | {
      readonly type: "app-update";
      readonly currentVersion: string;
      readonly latestVersion: string;
    }
```

Extend `DerivedNotification["kind"]` to include
`"download-complete" | "download-failed" | "app-update"`. In `deriveNotifications`,
before the final `queue-recoverable` push, add branches:

```ts
if (signal.type === "download-complete") {
  const episodePart =
    signal.season !== undefined && signal.episode !== undefined
      ? `S${signal.season}E${signal.episode}`
      : "download";
  derived.push({
    dedupKey: [
      "download-complete",
      signal.titleId,
      signal.season ?? "-",
      signal.episode ?? "-",
    ].join(":"),
    kind: "download-complete",
    title: `Downloaded · ${signal.title} ${episodePart}`,
    body: "Available offline",
    item: {
      mediaKind: signal.mediaKind,
      titleId: signal.titleId,
      title: signal.title,
      season: signal.season,
      episode: signal.episode,
      providerHints: sanitizeProviderHints([]),
    },
    createdAt: input.now,
    updatedAt: input.now,
  });
  continue;
}

if (signal.type === "download-failed") {
  const episodePart =
    signal.season !== undefined && signal.episode !== undefined
      ? `S${signal.season}E${signal.episode}`
      : "episode";
  derived.push({
    dedupKey: ["download-failed", signal.titleId, signal.season ?? "-", signal.episode ?? "-"].join(
      ":",
    ),
    kind: "download-failed",
    title: `Download failed · ${signal.title} ${episodePart}`,
    body: signal.error,
    item: {
      mediaKind: signal.mediaKind,
      titleId: signal.titleId,
      title: signal.title,
      season: signal.season,
      episode: signal.episode,
      providerHints: sanitizeProviderHints([]),
    },
    createdAt: input.now,
    updatedAt: input.now,
  });
  continue;
}

if (signal.type === "app-update") {
  derived.push({
    dedupKey: `app-update:${signal.latestVersion}`,
    kind: "app-update",
    title: `Update available · ${signal.latestVersion}`,
    body: `You are on ${signal.currentVersion}. Update to ${signal.latestVersion}.`,
    createdAt: input.now,
    updatedAt: input.now,
  });
  continue;
}
```

(The existing `new-playable-episode` branch already filters muted titles; keep it.)

- [ ] **Step 4: Action ids**

In `NotificationActionRouter.ts`, add `"update-app"` and `"retry-download"` to the
`NotificationActionId` union and to `parseNotificationActionIds`' accepted set (mirror the
existing `value === "restore-queue" ||` guard). In `NotificationService.ts`
`defaultNotificationActionIds`:

```ts
function defaultNotificationActionIds(kind: string): readonly string[] {
  if (kind === "queue-recovery") return ["restore-queue", "dismiss"];
  if (kind === "download-failed") return ["retry-download", "dismiss"];
  if (kind === "app-update") return ["update-app", "dismiss"];
  return ["queue-next", "queue-end", "dismiss"];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file test/unit/services/notifications/notification-engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/notifications/
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): download-failed and app-update signal kinds"
```

---

## Task 6: app-update signal builder (pure) + wiring

**Files:**

- Create: `apps/cli/src/services/notifications/notification-update-signal.ts`
- Modify: `apps/cli/src/container.ts` (wire update-available → recordSignals)
- Test: `apps/cli/test/unit/services/notifications/notification-update-signal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { updateSignalFromCheck } from "@/services/notifications/notification-update-signal";

describe("updateSignalFromCheck", () => {
  it("returns an app-update signal when an update is available", () => {
    expect(
      updateSignalFromCheck({
        status: "update-available",
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
      }),
    ).toEqual({ type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" });
  });

  it("returns null when up to date", () => {
    expect(
      updateSignalFromCheck({
        status: "up-to-date",
        currentVersion: "1.3.0",
        latestVersion: "1.3.0",
      }),
    ).toBeNull();
  });

  it("returns null without a latest version", () => {
    expect(
      updateSignalFromCheck({ status: "error", currentVersion: "1.2.0", latestVersion: null }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/services/notifications/notification-update-signal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { NotificationSignal } from "./NotificationEngine";

type UpdateCheckLike = {
  readonly status: string;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
};

/** Pure: map an UpdateService check result to an app-update signal, or null. */
export function updateSignalFromCheck(result: UpdateCheckLike): NotificationSignal | null {
  if (result.status !== "update-available" || !result.latestVersion) return null;
  return {
    type: "app-update",
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
  };
}
```

- [ ] **Step 4: Wire in container.ts**

Find where `UpdateService` is constructed / `checkInBackground` is called. After a
successful `checkForUpdate()` (or add an `onResult` hook), funnel the result:

```ts
const updateResult = await updateService.checkForUpdate();
const updateSignal = updateSignalFromCheck(updateResult);
if (updateSignal) notificationService.recordSignals([updateSignal]);
```

If only `checkInBackground()` is used, change that call site to:

```ts
void updateService
  .checkForUpdate()
  .then((result) => {
    const signal = updateSignalFromCheck(result);
    if (signal) notificationService.recordSignals([signal]);
  })
  .catch(() => {});
```

Add the import: `import { updateSignalFromCheck } from "./services/notifications/notification-update-signal";`

- [ ] **Step 5: Run test + typecheck**

Run: `bun run test:file test/unit/services/notifications/notification-update-signal.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/notifications/notification-update-signal.ts apps/cli/src/container.ts apps/cli/test/unit/services/notifications/notification-update-signal.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): emit app-update notification when behind latest"
```

---

## Task 7: Wire new-episode (followed) + download-failed signals

**Files:**

- Modify: `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts` (after reconcile → new-episode signals for followed)
- Modify: `apps/cli/src/services/download/DownloadService.ts:511` (add `onTerminalFailure` callback)
- Modify: `apps/cli/src/container.ts` (wire both)

- [ ] **Step 1: DownloadService terminal-failure callback**

In `DownloadService.ts`, add to the deps interface (near `onCompletedArtifact?` ~line 192):

```ts
      readonly onTerminalFailure?: (job: DownloadJobRecord, error: string) => Promise<void> | void;
```

At the terminal-failure site (~line 511, after `this.emit({ type: "failed", ... })`):

```ts
const failedJob = this.deps.repo.get(next.id);
if (failedJob) await this.deps.onTerminalFailure?.(failedJob, message);
```

- [ ] **Step 2: Wire download-failed in container.ts**

In the `new DownloadService({ ... })` options (near `onCompletedArtifact`), add:

```ts
    onTerminalFailure: (job, error) => {
      if (job.mediaKind === "movie" || job.episode === undefined) {
        notificationService.recordSignals([
          { type: "download-failed", titleId: job.titleId, mediaKind: job.mediaKind, title: job.titleName, error },
        ]);
        return;
      }
      notificationService.recordSignals([
        {
          type: "download-failed",
          titleId: job.titleId,
          mediaKind: job.mediaKind,
          title: job.titleName,
          season: job.season,
          episode: job.episode,
          error,
        },
      ]);
    },
```

- [ ] **Step 2b: Switch download-complete to its own kind**

The existing `onCompletedArtifact` (container.ts ~471) emits a `new-playable-episode`
signal via `projectReleaseAvailability`. Now that reconciliation owns new-episode
notifications (Step 3), change `onCompletedArtifact` to emit a `download-complete`
signal instead:

```ts
    onCompletedArtifact: (job) => {
      const asset = offlineAssetService.adoptCompletedJob(job);
      if (asset?.state !== "ready") return;
      notificationService.recordSignals([
        {
          type: "download-complete",
          titleId: asset.titleId,
          mediaKind: asset.mediaKind,
          title: asset.titleName,
          season: asset.season,
          episode: asset.episode,
        },
      ], asset.updatedAt);
    },
```

(Drop the `projectReleaseAvailability` import here if it becomes unused. Movies are fine —
season/episode are simply omitted.)

- [ ] **Step 3: Wire new-episode signals after reconciliation**

In `enqueue-release-reconciliation.ts`, after `const result = await container.releaseReconciliationService.reconcile({...})` (~line 63), derive signals for followed, non-muted titles whose projection shows new episodes:

```ts
const followed = new Set(
  container.followedTitleRepository.listByPreference("following").map((t) => t.titleId),
);
const signals = result.projections
  .filter((p) => p.newEpisodeCount > 0 && followed.has(p.titleId))
  .map((p) => ({
    type: "new-playable-episode" as const,
    titleId: p.titleId,
    mediaKind: p.mediaKind,
    title: p.title,
    season: p.latestAiredSeason,
    episode: p.latestAiredEpisode,
    providerId: p.source,
    availableAt: p.checkedAt,
  }));
if (signals.length > 0) container.notificationService.recordSignals(signals);
```

Confirm the result field name by reading `ReleaseReconciliationResult` (search in
`ReleaseReconciliationService.ts`); it exposes the upserted projections — use that
collection. If the result does not carry projections, read them back via
`container.releaseProgressCache.getByTitleIds(plannedTitleIds)` instead.

- [ ] **Step 4: Typecheck + existing tests**

Run: `bun run typecheck && bun run test:file test/unit/services/release-reconciliation/ test/unit/services/download/`
Expected: PASS. If reconciliation/download tests construct services, add the new optional callback as needed (it is optional, so most will compile unchanged).

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts apps/cli/src/services/download/DownloadService.ts apps/cli/src/container.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): persist new-episode (followed) + download-failed notifications"
```

---

## Task 8: Notifications view-model (pure)

**Files:**

- Create: `apps/cli/src/app-shell/notifications-view.ts`
- Test: `apps/cli/test/unit/app-shell/notifications-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import type { NotificationRecord } from "@kunai/storage";
import { buildNotificationsView } from "@/app-shell/notifications-view";

const rec = (over: Partial<NotificationRecord>): NotificationRecord => ({
  id: over.dedupKey ?? "id",
  dedupKey: "k",
  kind: "new-episode",
  title: "Frieren S1E13 available",
  body: "available on allanime",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  ...over,
});

describe("buildNotificationsView", () => {
  it("marks unread rows and picks a glyph or poster per kind", () => {
    const view = buildNotificationsView({
      records: [rec({ dedupKey: "a", kind: "new-episode", readAt: undefined })],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows[0]?.unread).toBe(true);
    expect(view.rows[0]?.usePoster).toBe(true); // new-episode
    expect(view.rows[0]?.relativeTime).toBe("2h");
  });

  it("uses a glyph for non-episode kinds and marks read rows", () => {
    const view = buildNotificationsView({
      records: [rec({ dedupKey: "b", kind: "app-update", readAt: "2026-06-14T01:00:00.000Z" })],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows[0]?.unread).toBe(false);
    expect(view.rows[0]?.usePoster).toBe(false);
    expect(view.rows[0]?.glyph).toBe("⬆");
  });

  it("paginates and reports total pages", () => {
    const records = Array.from({ length: 5 }, (_, i) => rec({ dedupKey: `k${i}` }));
    const view = buildNotificationsView({
      records,
      tab: "active",
      page: 1,
      pageSize: 2,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows).toHaveLength(2);
    expect(view.totalPages).toBe(3);
    expect(view.page).toBe(1);
  });

  it("reports empty", () => {
    const view = buildNotificationsView({
      records: [],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.isEmpty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/app-shell/notifications-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { NotificationRecord } from "@kunai/storage";

export type NotificationsTab = "active" | "archive";

export type NotificationRow = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly unread: boolean;
  readonly usePoster: boolean;
  readonly glyph: string;
  readonly posterUrl?: string;
  readonly relativeTime: string;
};

export type NotificationsView = {
  readonly tab: NotificationsTab;
  readonly rows: readonly NotificationRow[];
  readonly page: number;
  readonly totalPages: number;
  readonly isEmpty: boolean;
};

export type BuildNotificationsViewInput = {
  readonly records: readonly NotificationRecord[];
  readonly tab: NotificationsTab;
  readonly page: number;
  readonly pageSize: number;
  readonly now: string;
};

function glyphForKind(kind: string): string {
  if (kind === "download-complete") return "⬇";
  if (kind === "download-failed") return "⚠";
  if (kind === "queue-recovery") return "↩";
  if (kind === "app-update") return "⬆";
  return "🆕";
}

function posterUrlOf(record: NotificationRecord): string | undefined {
  if (!record.itemJson) return undefined;
  try {
    const item = JSON.parse(record.itemJson) as { posterUrl?: string; posterPath?: string };
    return item.posterUrl ?? undefined;
  } catch {
    return undefined;
  }
}

function relativeTime(updatedAt: string, now: string): string {
  const deltaMs = Date.parse(now) - Date.parse(updatedAt);
  const mins = Math.max(0, Math.floor(deltaMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function buildNotificationsView(input: BuildNotificationsViewInput): NotificationsView {
  const pageSize = Math.max(1, input.pageSize);
  const totalPages = Math.max(1, Math.ceil(input.records.length / pageSize));
  const page = Math.min(Math.max(0, input.page), totalPages - 1);
  const start = page * pageSize;
  const rows = input.records.slice(start, start + pageSize).map((record) => ({
    dedupKey: record.dedupKey,
    kind: record.kind,
    title: record.title,
    body: record.body,
    unread: !record.readAt,
    usePoster: record.kind === "new-episode",
    glyph: glyphForKind(record.kind),
    posterUrl: posterUrlOf(record),
    relativeTime: relativeTime(record.updatedAt, input.now),
  }));
  return { tab: input.tab, rows, page, totalPages, isEmpty: input.records.length === 0 };
}
```

(Requires `NotificationRecord.readAt` — added in Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file test/unit/app-shell/notifications-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/notifications-view.ts apps/cli/test/unit/app-shell/notifications-view.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): pure notifications view-model"
```

---

## Task 9: NotificationsShell (render)

**Files:**

- Create: `apps/cli/src/app-shell/notifications-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/notifications-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "bun:test";
import React from "react";
import { NotificationsShell } from "@/app-shell/notifications-shell";
import { buildNotificationsView } from "@/app-shell/notifications-view";
import { captureFrame } from "../../harness/render-capture";

const records = [
  {
    id: "1",
    dedupKey: "a",
    kind: "new-episode",
    title: "Frieren S1E13 available",
    body: "on allanime",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  },
  {
    id: "2",
    dedupKey: "b",
    kind: "app-update",
    title: "Update available 1.3.0",
    body: "you are on 1.2.0",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    readAt: "2026-06-14T01:00:00.000Z",
  },
];

describe("NotificationsShell", () => {
  it("renders titles, the active tab and unread dot", () => {
    const view = buildNotificationsView({
      records,
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    const frame = captureFrame(
      <NotificationsShell view={view} columns={120} selectedIndex={0} unreadCount={1} />,
      { columns: 120 },
    );
    expect(frame).toContain("Frieren S1E13 available");
    expect(frame).toContain("Update available 1.3.0");
    expect(frame).toContain("Active");
  });

  it("renders an empty state", () => {
    const view = buildNotificationsView({
      records: [],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    const frame = captureFrame(
      <NotificationsShell view={view} columns={120} selectedIndex={0} unreadCount={0} />,
      { columns: 120 },
    );
    expect(frame).toContain("No notifications");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file test/unit/app-shell/notifications-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { Box, Text } from "ink";
import React from "react";

import type { NotificationRow, NotificationsView } from "./notifications-view";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

function NotifMini({ url, title }: { readonly url?: string; readonly title: string }) {
  const { poster } = usePosterPreview(url, {
    rows: 2,
    cols: 4,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  const initials = title.slice(0, 2).toUpperCase();
  return <Text color={palette.dim}>{initials}</Text>;
}

function Row({
  row,
  selected,
  width,
}: {
  readonly row: NotificationRow;
  readonly selected: boolean;
  readonly width: number;
}) {
  const dot = row.unread ? "●" : " ";
  const lead = row.usePoster ? null : <Text color={palette.muted}>{row.glyph} </Text>;
  const titleWidth = Math.max(8, width - 12);
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={selected ? palette.accent : palette.ok}>{selected ? "▌" : " "}</Text>
      <Text color={palette.accent}>{dot} </Text>
      {row.usePoster ? (
        <Box width={5}>
          <NotifMini url={row.posterUrl} title={row.title} />
        </Box>
      ) : (
        lead
      )}
      <Box flexDirection="column" flexGrow={1}>
        <Text color={row.unread ? palette.text : palette.textDim} bold={row.unread}>
          {truncateLine(row.title, titleWidth)}
        </Text>
        <Text color={palette.muted}>{truncateLine(row.body, titleWidth)}</Text>
      </Box>
      <Text color={palette.dim}>{row.relativeTime}</Text>
    </Box>
  );
}

export function NotificationsShell({
  view,
  columns,
  selectedIndex,
  unreadCount,
}: {
  readonly view: NotificationsView;
  readonly columns: number;
  readonly selectedIndex: number;
  readonly unreadCount: number;
}) {
  const rowWidth = Math.max(30, Math.min(columns - 4, 110));
  const tabs = `${view.tab === "active" ? "[Active]" : "Active"}  ${view.tab === "archive" ? "[Archive]" : "Archive"}`;
  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <SectionGroup
        label="Notifications"
        tag={unreadCount > 0 ? `${unreadCount} unread · ${tabs}` : tabs}
        marginTop={0}
      />
      {view.isEmpty ? (
        <StateBlock
          model={{ kind: "empty", title: "No notifications", detail: "You're all caught up." }}
          width={rowWidth}
        />
      ) : (
        <Box flexDirection="column">
          {view.rows.map((row, index) => (
            <Row key={row.dedupKey} row={row} selected={index === selectedIndex} width={rowWidth} />
          ))}
        </Box>
      )}
      {view.totalPages > 1 ? (
        <Box marginTop={1}>
          <Text color={palette.dim}>{`page ${view.page + 1}/${view.totalPages} · [ ]`}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={palette.dim}>
          ↑↓ move · ↵ action · a all · r read · A all-read · x archive · tab switch · esc close
        </Text>
      </Box>
    </Box>
  );
}
```

(Confirm `StateBlock` empty-model shape against `apps/cli/src/app-shell/primitives/StateBlock.tsx` — match the existing prop contract used by `QueueShell`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file test/unit/app-shell/notifications-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/notifications-shell.tsx apps/cli/test/unit/app-shell/notifications-shell.test.tsx
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): rich NotificationsShell surface"
```

---

## Task 10: Mount the shell in the overlay + tabs/page/read/archive input

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (notifications branch render + input + open-marks-read)

- [ ] **Step 1: Read the current notifications branch**

Read `root-overlay-shell.tsx` around the `notifications` render (search `overlay.type === "notifications"`, ~line 691) and its `useInput` handling for notifications (the picker + `notificationActionDedupKey` + dismiss at ~940/952). Identify: where options are built, where Enter/`x`/`a` are handled, and where the overlay opens.

- [ ] **Step 2: Add notifications UI state**

Add component state near the other overlay state hooks:

```tsx
const [notifTab, setNotifTab] = React.useState<"active" | "archive">("active");
const [notifPage, setNotifPage] = React.useState(0);
const [notifSelected, setNotifSelected] = React.useState(0);
const [notifTick, setNotifTick] = React.useState(0);
```

- [ ] **Step 3: Open marks all read**

In the effect that runs when the notifications overlay opens (or add one keyed on
`overlay.type === "notifications"`), call once:

```tsx
React.useEffect(() => {
  if (overlay.type !== "notifications") return;
  container.notificationService.markAllRead();
  setNotifTick((t) => t + 1);
}, [overlay.type, container.notificationService]);
```

- [ ] **Step 4: Build the view + render the shell**

Replace the `buildNotificationPickerOptions` render path for notifications with:

```tsx
const NOTIF_PAGE_SIZE = 8;
const notifRecords =
  overlay.type === "notifications"
    ? notifTab === "active"
      ? container.notificationService.listActive(200, 0)
      : container.notificationService.listArchived(200, 0)
    : [];
const notificationsView = buildNotificationsView({
  records: notifRecords,
  tab: notifTab,
  page: notifPage,
  pageSize: NOTIF_PAGE_SIZE,
  now: new Date().toISOString(),
});
const notifUnread = container.notificationService.countUnread();
```

Render `<NotificationsShell view={notificationsView} columns={columns} selectedIndex={notifSelected} unreadCount={notifUnread} />` in the notifications branch. (`notifTick` is referenced in the deps of these reads so they refresh after mutations — add an `eslint-disable-next-line` for exhaustive-deps if needed, mirroring the queue pattern at line ~688.)

- [ ] **Step 5: Input handling**

In the notifications `useInput` branch, implement (let `rows = notificationsView.rows`):

```tsx
if (key.tab) {
  setNotifTab((t) => (t === "active" ? "archive" : "active"));
  setNotifPage(0);
  setNotifSelected(0);
  return;
}
if (input === "[") {
  setNotifPage((p) => Math.max(0, p - 1));
  setNotifSelected(0);
  return;
}
if (input === "]") {
  setNotifPage((p) => Math.min(notificationsView.totalPages - 1, p + 1));
  setNotifSelected(0);
  return;
}
if (key.downArrow || input === "j") {
  setNotifSelected((i) => Math.min(rows.length - 1, i + 1));
  return;
}
if (key.upArrow || input === "k") {
  setNotifSelected((i) => Math.max(0, i - 1));
  return;
}
if (input === "A") {
  container.notificationService.markAllRead();
  setNotifTick((t) => t + 1);
  return;
}
const selected = rows[notifSelected];
if (selected) {
  if (input === "r") {
    container.notificationService.markRead(selected.dedupKey);
    setNotifTick((t) => t + 1);
    return;
  }
  if (input === "x") {
    container.notificationService.archive(selected.dedupKey);
    setNotifTick((t) => t + 1);
    return;
  }
  // Enter / a: reuse the existing notification action router path keyed by selected.dedupKey
}
```

Wire Enter (primary action) and `a` (all actions) to the **existing** notification action
router/sub-action picker, keyed by `selected.dedupKey` (reuse `notificationActionDedupKey`
and the existing action-execution code — do not duplicate it). Replace the old `dismiss`
call (`container.notificationService.dismiss(...)`) with `archive(...)`.

- [ ] **Step 6: Typecheck + the overlay tests**

Run: `bun run typecheck && bun run test:file test/unit/app-shell/`
Expected: PASS. Update any test that asserted the old picker option shape for notifications.

- [ ] **Step 7: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/test/unit/app-shell/
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): mount NotificationsShell with tabs, pagination, read/archive"
```

---

## Task 11: Bell uses unread count, hidden at zero

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (~759-769 — feed unread count)
- Modify: `apps/cli/src/app-shell/root-status-summary.ts` (already hides at 0; confirm it uses unread)
- Test: extend `apps/cli/test/unit/app-shell/root-status-summary.test.ts`

- [ ] **Step 1: Write the failing test**

In `root-status-summary.test.ts`, add:

```ts
it("hides the bell when unread is zero", () => {
  const summary = buildRootStatusSummary({
    state: baseIdleState(), // reuse the file's existing helper/fixture
    currentViewLabel: "home",
    rootStatus: "idle",
    notificationCount: 0,
  });
  expect(summary.crumb).not.toContain("🔔");
});

it("shows the unread bell count", () => {
  const summary = buildRootStatusSummary({
    state: baseIdleState(),
    currentViewLabel: "home",
    rootStatus: "idle",
    notificationCount: 3,
  });
  expect(summary.crumb).toContain("🔔 3");
});
```

(Use the fixture/helper the existing tests in that file already use to build `state`.)

- [ ] **Step 2: Run test to verify it fails (or passes)**

Run: `bun run test:file test/unit/app-shell/root-status-summary.test.ts`
Expected: the zero-case already passes (the crumb only adds the bell when `notificationCount > 0`). The count source changes in Step 3; this test locks behavior.

- [ ] **Step 3: Feed unread count in ink-shell.tsx**

At ~759-769, change the bell to use unread, not active length:

```tsx
const notificationUnread = container.notificationService.countUnread();
```

and pass `notificationCount: notificationUnread` into `buildRootStatusSummary`. Keep
`newEpisodeNotificationCount` derived from active records filtered by `kind === "new-episode"`
that are unread (filter `activeNotifications` by `!n.readAt`). Since `root-status-summary.ts`
already renders the bell only when `notificationCount > 0`, the bell hides at zero unread.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file test/unit/app-shell/root-status-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/ink-shell.tsx apps/cli/test/unit/app-shell/root-status-summary.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(notifications): bell shows unread count, hidden at zero"
```

---

## Task 12: Full gate

- [ ] **Step 1: Typecheck + lint**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli
bun run typecheck
bun run lint
```

Expected: clean. Watch for `no-shadow` on new locals (`rows`, `selected`) — rename if flagged.

- [ ] **Step 2: Full test suite**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli
bun run test
```

Expected: all pass. The `runtime boundary imports` test is a likely tripwire — `notifications-view.ts`/`notifications-shell.tsx` live in `app-shell` (fine); `notification-update-signal.ts` and engine changes live in `services` (fine); the pure view-model imports only types from `@kunai/storage` (fine). If any app-layer file imports app-shell, relocate the shared piece to `domain`/`services` (as was done for watch-time).

- [ ] **Step 3: Build**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
bun run build
```

Expected: success.

- [ ] **Step 4: Commit (if lint/format touched anything)**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add -A
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "chore(notifications): gate green (typecheck/lint/test/build)" || echo "nothing to commit"
```

---

## Self-Review notes (for the executor)

- **Single-writer scope:** Task 2 routes both writers through `ReleaseProgressWriter`. If routing reconciliation's 3 internal upserts proves invasive, the minimal correctness fix is to guard only the calendar's optimistic write (Task 2 Step 2); authoritative direct writes already win. Prefer the full routing for one source of truth.
- **`result.projections`:** Task 7 Step 3 assumes the reconcile result exposes the upserted projections. Verify the field by reading `ReleaseReconciliationResult`; if absent, read back via `releaseProgressCache.getByTitleIds(...)`.
- **Action reuse:** Task 10 must reuse the existing notification action router/sub-action picker — do not duplicate action execution. Enter/`a` keep their current behavior, keyed by the selected row's `dedupKey`.
- **Dismiss → archive:** replace the old `dismiss` call in the overlay with `archive`. `dismissByDedupKey` stays in the repo for compatibility but is no longer wired to a key.
- **Boundary test:** keep pure/shared logic out of `app-shell` if an app-layer file needs it (watch-time precedent).
- **Poster mini:** new-episode notifications only carry a poster if the signal's `item` includes one; `posterUrlOf` returns undefined otherwise and the row falls back to initials. (A later enhancement can enrich new-episode signals with `posterPath`.)
