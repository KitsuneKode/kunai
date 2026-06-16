# Notification Toast + Streak — design

Date: 2026-06-16
Status: Draft (spec)
Topic: A prominent transient toast in the shell when a new notification arrives (currently missing) and on a streak milestone (already works) — reusing the existing single transient-alert row, no new layout.

## Why

When a notification is written (new episode, download complete/failed, queue recovery,
app update) the only signal is the `🔔` bell count in the header crumb, and even that
refreshes lazily (60s tick). There is no transient "it just happened" toast. The shell
already has a single transient-alert row (`ink-shell.tsx` ~1083) that renders dim lines
for `rootStatusSummary.alert`, presence boot, streak milestone, and streak-at-risk. The
streak milestone toast already fires (6s, dim). This spec adds the missing
new-notification trigger and makes arrivals/streaks render bright in that same row.

## Goals

1. A toast in the existing transient row when a NEW active notification arrives, naming
   it (e.g. `● New episode — Bungo Stray Dogs`), auto-dismissing after ~4s.
2. All active notification kinds toast (new-episode, download-complete/failed,
   queue-recovery, app-update). Muted/archived never toast (uses `listActive`).
3. No startup spam: pre-existing notifications never toast on first mount.
4. Streak milestone keeps working; same bright presentation in the same row.
5. Zero layout risk — one reserved row, explicit single-winner priority.

## Non-goals

- Boxed/anchored toast component (rejected — costs rows, fights the viewport-contained TUI).
- A notification history/inbox change (already exists via `/notifications`).
- Sound or OS-level notifications.

## Locked decisions

| Decision     | Choice                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| Presentation | Bright single line in the EXISTING transient-alert row (not a boxed toast)     |
| Scope        | All active notification kinds toast on arrival                                 |
| Live signal  | `NotificationService` gains `subscribe(listener)`, emitted after recordSignals |
| Startup      | Seed seen-keys on mount → no toast for pre-existing notifications              |
| Dedup        | Track seen `dedupKey`s; only an unseen active key toasts                       |

## Architecture

### 1. NotificationService change signal

Add a minimal listener set to `apps/cli/src/services/notifications/NotificationService.ts`:

```ts
private readonly listeners = new Set<() => void>();
subscribe(listener: () => void): () => void {
  this.listeners.add(listener);
  return () => this.listeners.delete(listener);
}
private emitChange(): void {
  for (const l of this.listeners) l();
}
```

Call `emitChange()` at the end of `recordSignals` (after the upsert loop) and in
`delete`/`archive`/`markRead`/`markAllRead`/`clearArchived` so the shell stays live.
Existing callers are unaffected (no signature changes).

### 2. Pure toast selector

New `apps/cli/src/app-shell/notification-toast.ts`:

```ts
export type NotificationToastInput = {
  readonly active: readonly {
    readonly dedupKey: string;
    readonly kind: string;
    readonly title: string;
  }[];
  readonly seenKeys: ReadonlySet<string>;
};
export type NotificationToastResult = {
  readonly toast: string | null;
  readonly seenKeys: ReadonlySet<string>;
};
export function selectNotificationToast(input: NotificationToastInput): NotificationToastResult;
```

Logic: the new keys are `active` dedupKeys not in `seenKeys`. `seenKeys` (return) =
every current active key (so deletions don't resurrect a toast). `toast` = a glyph + the
newest new notification's title (newest = first of `active`, which `listActive` returns
`ORDER BY updated_at DESC`), e.g. `● New episode — Bungo Stray Dogs`; null when no new
keys. Glyph per kind mirrors the inbox (`⬇`/`⚠`/`↩`/`⬆`/`●`). Pure + fully unit-tested.

### 3. Shell wiring (`ink-shell.tsx`)

- `const seenKeysRef = useRef<ReadonlySet<string>>(new Set())`, seeded from
  `listActive()` dedupKeys on first mount (so startup never toasts).
- `subscribe` to `notificationService` in an effect; on change (and on the existing 60s
  refresh) read `listActive()`, run `selectNotificationToast({ active, seenKeys: ref })`,
  store the returned `seenKeys` back in the ref, and if `toast` is non-null set
  `notificationToast` state, clearing it after 4s (cancellable timer, cleared on unmount).
- Render `notificationToast` in the transient row, bright (full color, not `dimColor`).

### 4. One-row priority

The single transient row renders the first non-null of, in order:
`rootStatusSummary.alert` (error/warning) → `notificationToast` → `streakMilestoneAlert`
→ `visiblePresenceBootLine` → `streakAtRiskAlert`. Arrivals + streak render bright; calm
infos stay dim. No stacking — one line, one winner.

## Data flow

1. Background reconciliation / download / etc. → `notificationService.recordSignals(...)`
   upserts → `emitChange()`.
2. Shell listener fires → `selectNotificationToast` over `listActive()` vs `seenKeysRef`.
3. New key → bright toast for ~4s; ref updated so it shows once.
4. Streak milestone path unchanged; shares the row + bright styling.

## Testing

- `selectNotificationToast`: new key → toast (correct title + kind glyph); no new → null;
  seeded mount (all-seen) → null; archived/muted absent from `active` → no toast;
  multiple new → newest wins; a removed key drops out of returned `seenKeys`.
- `NotificationService.subscribe`: listener fires on `recordSignals`; unsubscribe stops it.
- `captureFrame`: transient row renders the bright toast; priority — an error alert
  out-prioritises a toast.
- Streak: existing ink-shell/streak tests stay green.

## Out of scope / follow-ups

- Per-kind toast opt-out in settings (defer).
- A toast "stack"/queue for rapid bursts (one-winner row is enough for now).
