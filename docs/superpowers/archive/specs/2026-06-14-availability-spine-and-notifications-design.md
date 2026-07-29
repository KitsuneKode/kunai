# Availability spine + Notifications redesign — Spec A

Date: 2026-06-14
Status: Draft (spec)
Topic: Make new-episode/availability data correct and surface it through a real notifications center. First of three connected specs.

## Why

New-episode availability is one data story with three faces. A shared spine —
`release_progress_cache` (written by `ReleaseReconciliationService` + the
calendar) — already exists. Two consumers read it; one is blind:

| Surface                          | Uses release-progress?                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Calendar (`calendar-results.ts`) | yes — writes/reads → optimistic `+N new` badge                               |
| History (continue-watching)      | yes — reads `releaseProgress.newEpisodeCount` → "N new"                      |
| **Notifications**                | **no** — only a _completed download_ ever creates a new-episode notification |

So the same `newEpisodeCount` that lights up calendar and history never becomes a
notification — that is the "shows but not in notifications" bug. And the spine has
a documented **writer race**: a comment in `calendar-results.ts` warns the calendar
must not force re-reconciliation because calendar and reconciliation both write the
projection with no single authority.

## Program decomposition

This is one program, three sequenced specs sharing the corrected spine:

- **Spec A (this doc): data-correctness foundation + Notifications**
- Spec B: Calendar enhancement (logical + visual) — later
- Spec C: History enhancement (logical + visual) — later (roadmap item 6)

## Goals (Spec A)

1. One authoritative write path for `release_progress_cache` — resolve the writer race.
2. Wire reconciliation-found new episodes (for **followed** titles) into the notification store.
3. Add notification kinds: new-episode (followed), download-complete, download-failed, queue-recovery (existing), **app-update**.
4. Lifecycle: unread/read + archive, via a schema migration. Bell shows unread count, **hidden at zero**.
5. A rich, paginated notifications surface with Active/Archive tabs (replaces the plain picker).

## Non-goals

- Calendar and history UI changes (Specs B/C).
- Push/OS-level notifications. This is the in-app center only.
- Changing reconciliation cadence/planner logic beyond the single-writer merge.

## Locked decisions

| Decision              | Choice                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------- |
| Program shape         | Foundation+Notifications → Calendar → History, sequenced, shared spine                  |
| Notify on             | new-episode (followed), download-complete, download-failed, queue-recovery, app-update  |
| Read model            | unread/read; opening marks all read; also explicit mark-selected (`r`) + mark-all (`A`) |
| Bell at zero unread   | hidden                                                                                  |
| Dismiss (`x`)         | archive (soft; visible in Archive tab)                                                  |
| New-episode row style | poster mini (reuse queue/post-play mini-poster); other kinds use a glyph                |

## Architecture

### 1. Release-progress single writer (foundation)

Introduce `ReleaseProgressWriter` (wraps the existing release-progress cache repo)
as the only write path. Merge rule on `upsert`:

- An **authoritative** write (from `ReleaseReconciliationService`) always wins and
  sets `checked_at`/`next_check_at`/`stale_after_at`.
- An **optimistic** write (from the calendar) is applied only when there is no
  fresher authoritative row for that `title_id` — it never downgrades
  `new_episode_count` below an authoritative value and never moves `next_check_at`
  earlier. Each write carries an `origin: "authoritative" | "optimistic"` tag.

Both `calendar-results.ts` and the reconciliation consumer call the writer instead
of touching the repo directly. This removes the race and is what makes "current
data correct."

### 2. Notification derivation

Extend `NotificationEngine` signal union and `deriveNotifications`:

- `new-playable-episode` (exists) — now emitted from the reconciliation consumer:
  for each projection with `newEpisodeCount > 0` whose title preference is
  `"following"` (not `"muted"`), emit one signal. Dedup key already keys on
  title/season/episode/provider.
- `download-complete` (formalize; today inline in `onCompletedArtifact`).
- `download-failed` (new) — emitted when a download job reaches terminal failure.
  Kind `download-failed`; actions: retry (maps to existing download retry), dismiss.
- `queue-recoverable` (exists) — unchanged.
- `app-update` (new) — a cached check (`update-check-cache` + `fetchLatestVersion`)
  compares `currentVersion` to latest; if behind, emit one signal deduped on the
  latest version string (`app-update:<latest>`). Action: open release page / how-to-update.

`defaultNotificationActionIds` extended per kind.

### 3. Lifecycle + storage

Migration `020_data_notifications_read_archive` (data DB):

```sql
ALTER TABLE notifications ADD COLUMN read_at TEXT;
ALTER TABLE notifications ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_active
  ON notifications(archived_at, updated_at DESC);
```

`dismissed_at` stays for backward compat but the app stops writing it; `archive`
is the new soft-remove.

`NotificationRepository` gains:

- `listActive(limit, offset)` — `WHERE archived_at IS NULL` (paginated)
- `listArchived(limit, offset)` — `WHERE archived_at IS NOT NULL`
- `countActive()` / `countUnread()` — unread = `archived_at IS NULL AND read_at IS NULL`
- `markRead(dedupKey, now)`, `markAllRead(now)` (active rows)
- `archive(dedupKey, now)`

`NotificationService` mirrors these and keeps `recordSignals`.

State semantics: **active** = not archived; **unread** = active and `read_at` null.
Bell badge = `countUnread()`, rendered only when > 0.

### 4. Surface (NotificationsShell)

A dedicated render component modeled on `QueueShell`, replacing the
`buildNotificationPickerOptions` picker in `root-overlay-shell.tsx`'s
`notifications` branch. Pure view-model `buildNotificationsView` + render-only shell.

- Header: `🔔 Notifications` + unread count + **Active / Archive** tabs.
- Row: unread dot (`●`, hidden when read) + **poster mini for `new-episode`**
  (else a per-kind glyph: `⬇` download · `⚠` failed · `↩` queue · `⬆` update),
  bold title when unread, dim body, right-aligned relative time ("2h", "3d").
- Pagination: page through active/archived (limit/offset); footer shows
  "page X · `[` `]`" when more than one page.
- Empty state when the active tab has no rows.
- Keys: `↑↓`/`jk` nav · `↵` primary action · `a` all-actions · `r` mark read ·
  `A` mark all read · `x` archive · `tab` switch Active/Archive · `[`/`]` page · `esc` close.
- Opening the overlay calls `markAllRead` (clears the bell) — rows stay; `r`/`A`
  remain available for explicit control.
- Poster mini reuses the `inkEmbedded` text-poster mechanism (coexists with any
  single Kitty image); poster URL resolved from the notification `item` via
  `resolveCatalogPosterUrl`.

### Data flow

1. Reconciliation completes → `ReleaseProgressWriter.upsert(authoritative)` →
   consumer derives `new-playable-episode` signals for followed titles →
   `NotificationService.recordSignals`.
2. Calendar load → `ReleaseProgressWriter.upsert(optimistic)` (no notification).
3. Download terminal states → `recordSignals([{download-complete | download-failed}])`.
4. Startup/periodic update check → `recordSignals([{app-update}])` when behind.
5. Bell count (`countUnread`) feeds the header crumb (`root-status-summary.ts`);
   hidden at zero.
6. Open `/notifications` → `markAllRead` → render `buildNotificationsView`.

## Testing

- `ReleaseProgressWriter`: optimistic never downgrades authoritative; authoritative
  always wins; pure merge unit tests.
- `NotificationEngine`: new `download-failed` and `app-update` derivations; followed
  vs muted filtering for new-episode; dedup keys stable.
- `NotificationRepository` (storage): migration applies; `markRead`/`markAllRead`/
  `archive`/`countUnread`/paginated `listActive`/`listArchived` behave (in-memory sqlite).
- `buildNotificationsView`: unread/read styling, tab filtering, pagination windowing,
  per-kind glyph vs poster-mini selection, empty state.
- `NotificationsShell`: `captureFrame` snapshots — active tab, archive tab, paged,
  empty, unread dots; no layout jump.
- App-update check: pure compare (current vs latest) → signal-or-null; no live network in tests.

## Out of scope / follow-ups

- Spec B (calendar) and Spec C (history) consume the corrected spine.
- Surfacing app-update notifications as an actionable in-app upgrade flow beyond
  linking the release page.
- A notifications config (per-kind mute, e.g. "no update notices") — can extend the
  existing followed-title mute; defer unless trivial.
