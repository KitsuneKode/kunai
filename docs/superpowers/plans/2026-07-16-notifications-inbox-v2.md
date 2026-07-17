# Notifications Inbox v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved sortable Active/Archive notifications inbox, selected-notice companion rail, stable identity-based selection, and success-sensitive read lifecycle.

**Architecture:** Keep ordering, pagination, evidence parsing, and selected-row projection in the pure notifications view model. Keep session-local tab/sort/selection transitions in the notification input module, with `RootOverlayShell` hosting that state only for the overlay lifetime. Continue routing executable actions through `NotificationActionRouter`, adding one small orchestration helper so only confirmed, handled, non-lifecycle actions mark a notice read.

**Tech Stack:** Bun, TypeScript, React 19, Ink 7, SQLite through `@kunai/storage`, and the local Ink render-capture harness.

## Global Constraints

- `docs/superpowers/specs/2026-07-16-notifications-inbox-v2-design.md` is the approved source of truth.
- Do not change Watch History, New Episodes, Up Next, Durable Playlists, startup behavior, startup timing, or first-paint behavior.
- Do not add storage fields, migrations, providers, availability checks, packages, or `ink-testing-library`.
- Active defaults to `attention`; Archive defaults to `newest`.
- Each tab retains its selected sort until the Notifications overlay unmounts.
- A successful non-lifecycle action marks the notice read but does not archive it.
- Stored `dismiss`, explicit archive, and delete remain lifecycle operations.
- Preserve the unrelated WIP in `package.json`, `apps/docs/package.json`, and `bun.lock` exactly. Stage explicit paths only; never use `git add .` or `git add -A`.
- Use Bun commands only: `bun`, `bunx`, and `bun run`.
- Reuse current shell primitives. Do not create a generic cross-domain attention model or modify `ActionList` for a 32-column rail.

---

## File and responsibility map

### Storage and service

- `packages/storage/src/repositories/notifications.ts` — complete Active/Archive retrieval in repository order.
- `apps/cli/src/services/notifications/NotificationService.ts` — app-facing complete-list pass-through.
- `apps/cli/src/services/notifications/NotificationActionRouter.ts` — explicit handled/unsupported action outcomes; no implicit dismissal for non-lifecycle actions.

### Pure app-shell models

- `apps/cli/src/app-shell/notification-overlay-model.ts` — one source for executable actions, labels, details, and tones.
- `apps/cli/src/app-shell/notifications-view.ts` — sorting, pagination, row/rail projection, and nearest-selection helpers.
- `apps/cli/src/app-shell/notification-action-flow.ts` — confirmation gating and mark-read-after-success policy.

### UI and orchestration

- `apps/cli/src/app-shell/use-notifications-overlay-input.ts` — session-local tab/sort/page/selection transitions and lifecycle key handling.
- `apps/cli/src/app-shell/notifications-shell.tsx` — dense list and responsive companion rail.
- `apps/cli/src/app-shell/primitives/MediaListShell.tsx` — optional custom rail slot while retaining the shared 124-column collapse policy.
- `apps/cli/src/app-shell/root-overlay-shell.tsx` — state host, record lookup by `dedupKey`, action orchestration, and render wiring.
- `apps/cli/src/app-shell/keybindings.ts` and `overlay-footer-actions.ts` — discoverable commands and compact footer grammar.

---

### Task 1: Retrieve complete Active and Archive datasets

**Files:**

- Modify: `packages/storage/src/repositories/notifications.ts:103-125`
- Modify: `packages/storage/test/notifications-repository.test.ts`
- Modify: `apps/cli/src/services/notifications/NotificationService.ts:72-78`
- Modify: `apps/cli/test/unit/services/notifications/NotificationService.test.ts`

**Interfaces:**

- Produces: `NotificationRepository.listAllActive()`, `NotificationRepository.listAllArchived()`
- Produces: `NotificationService.listAllActive()`, `NotificationService.listAllArchived()`
- Preserves: existing limited `listActive(limit, offset)` and `listArchived(limit, offset)` APIs

- [ ] **Step 1: Add failing repository tests for complete retrieval**

Add a test that inserts five records with deterministic timestamps, archives two with distinct archive timestamps, and proves the limited and complete APIs differ:

```ts
expect(repository.listActive(2, 0)).toHaveLength(2);
expect(repository.listAllActive().map((row) => row.dedupKey)).toEqual([
  "active-3",
  "active-2",
  "active-1",
]);
expect(repository.listAllArchived().map((row) => row.dedupKey)).toEqual([
  "archived-2",
  "archived-1",
]);
```

Use explicit ISO timestamps and account for `archive()` replacing `updatedAt` with the archive time.

- [ ] **Step 2: Run the storage test and verify failure**

Run:

```bash
bun run --cwd packages/storage test
```

Expected: failure because `listAllActive` and `listAllArchived` do not exist.

- [ ] **Step 3: Add unbounded repository methods**

Add these methods without changing the existing limited queries:

```ts
listAllActive(): NotificationRecord[] {
  return this.db
    .query<NotificationRow, []>(
      `SELECT * FROM notifications
       WHERE archived_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .all()
    .map(mapNotificationRow);
}

listAllArchived(): NotificationRecord[] {
  return this.db
    .query<NotificationRow, []>(
      `SELECT * FROM notifications
       WHERE archived_at IS NOT NULL
       ORDER BY updated_at DESC`,
    )
    .all()
    .map(mapNotificationRow);
}
```

- [ ] **Step 4: Add failing service pass-through tests**

Use a repository test double with complete-list methods and assert:

```ts
expect(service.listAllActive().map((row) => row.dedupKey)).toEqual([
  "active-3",
  "active-2",
  "active-1",
]);
expect(service.listAllArchived().map((row) => row.dedupKey)).toEqual(["archived-2", "archived-1"]);
```

Also retain an assertion that `service.listActive(2)` still requests a limit of two.

- [ ] **Step 5: Add service methods**

```ts
listAllActive(): NotificationRecord[] {
  return this.deps.repo.listAllActive();
}

listAllArchived(): NotificationRecord[] {
  return this.deps.repo.listAllArchived();
}
```

- [ ] **Step 6: Run focused tests**

```bash
bun run --cwd packages/storage test
bun run --cwd apps/cli test:file test/unit/services/notifications/NotificationService.test.ts
```

Expected: both commands pass.

- [ ] **Step 7: Commit explicit files**

```bash
git add -- \
  packages/storage/src/repositories/notifications.ts \
  packages/storage/test/notifications-repository.test.ts \
  apps/cli/src/services/notifications/NotificationService.ts \
  apps/cli/test/unit/services/notifications/NotificationService.test.ts
git commit -m "feat(notifications): load complete inbox datasets"
```

---

### Task 2: Centralize executable action presentation and router outcomes

**Files:**

- Modify: `apps/cli/src/app-shell/notification-overlay-model.ts`
- Modify: `apps/cli/test/unit/app-shell/notification-overlay-model.test.ts`
- Modify: `apps/cli/src/services/notifications/NotificationActionRouter.ts`
- Modify: `apps/cli/test/unit/services/notifications/NotificationActionRouter.test.ts`

**Interfaces:**

- Produces: `NotificationActionPresentation`
- Produces: `getExecutableNotificationActions(notification)`
- Produces: `getNotificationActionPresentation(action)`
- Produces: exported `getNotificationTone(kind)`
- Changes: `NotificationActionRouter.run()` from `Promise<void>` to `Promise<NotificationActionRunResult>`

- [ ] **Step 1: Add failing action-presentation tests**

Cover these exact cases:

```ts
expect(getNotificationPrimaryAction(downloadFailed)).toBe("retry-download");
expect(getNotificationPrimaryAction(appUpdate)).toBe("update-app");
expect(getNotificationActionPresentation("retry-download").label).toBe("Retry download");
expect(getNotificationActionPresentation("update-app").label).toBe("Open release page");
expect(getExecutableNotificationActions(malformedActions)).toEqual([]);
expect(getNotificationPrimaryAction(malformedActions)).toBe("dismiss");
```

Also assert that unknown notification kinds retain valid stored actions and receive neutral presentation.

- [ ] **Step 2: Run the model test and verify failure**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/notification-overlay-model.test.ts
```

Expected: missing exported helpers and filtered-out retry/update actions.

- [ ] **Step 3: Replace duplicate action switches with one presentation function**

Introduce:

```ts
export type NotificationActionPresentation = {
  readonly id: NotificationActionId;
  readonly label: string;
  readonly detail: string;
  readonly tone: ShellStatusTone;
};

export function getExecutableNotificationActions(
  notification: NotificationRecord,
): readonly NotificationActionId[] {
  return parseNotificationActionIds(notification).filter((action) =>
    OVERLAY_NOTIFICATION_ACTIONS.has(action),
  );
}

export function getNotificationActionPresentation(
  action: NotificationActionId,
): NotificationActionPresentation {
  return {
    id: action,
    label: getNotificationActionLabel(action),
    detail: getNotificationActionDetail(action),
    tone:
      action === "restore-queue" || action === "retry-download"
        ? "warning"
        : action === "download"
          ? "success"
          : "neutral",
  };
}
```

Add `"retry-download"` and `"update-app"` to `OVERLAY_NOTIFICATION_ACTIONS`. Keep `"add-to-playlist"` excluded. Make `buildNotificationActionOptions()` map through `getNotificationActionPresentation()`.

Add the missing action copy to the existing private label/detail helpers:

```ts
if (action === "retry-download") return "Retry download";
if (action === "update-app") return "Open release page";
```

```ts
if (action === "retry-download") return "Retry this item through the standard download action";
if (action === "update-app") return "Open the release page for the advertised Kunai version";
```

Export the kind tone function with this exact mapping:

```ts
export function getNotificationTone(kind: string): ShellStatusTone {
  if (kind === "queue-recovery") return "warning";
  if (kind === "download-failed") return "error";
  if (kind === "new-episode" || kind === "download-complete") return "success";
  if (kind === "app-update") return "info";
  return "neutral";
}
```

- [ ] **Step 4: Add failing router-result tests**

Define test expectations for:

```ts
expect(await router.run(restoreInput)).toEqual({
  status: "handled",
  actionId: "restore-queue",
});
expect(dismiss).not.toHaveBeenCalled();

expect(await router.run(updateInput)).toEqual({
  status: "handled",
  actionId: "update-app",
});
expect(dismiss).not.toHaveBeenCalled();

expect(await noExecutorRouter.run(updateInput)).toEqual({
  status: "unsupported",
  actionId: "update-app",
  reason: "No executor registered for update-app",
});
```

Also cover stored `dismiss`, missing queue executor, missing media executor, propagated media `unsupported`, retry-download mapping to media `download`, and thrown executor errors.

- [ ] **Step 5: Implement explicit router results**

Add:

```ts
export type NotificationActionRunResult =
  | { readonly status: "handled"; readonly actionId: NotificationActionId }
  | {
      readonly status: "unsupported";
      readonly actionId: NotificationActionId;
      readonly reason: string;
    };

function handled(actionId: NotificationActionId): NotificationActionRunResult {
  return { status: "handled", actionId };
}

function unsupported(actionId: NotificationActionId): NotificationActionRunResult {
  return {
    status: "unsupported",
    actionId,
    reason: `No executor registered for ${actionId}`,
  };
}
```

Change `run()` to return `Promise<NotificationActionRunResult>` and implement the branches as follows:

```ts
if (input.actionId === "dismiss") {
  await this.deps.notifications.dismiss(input.notification.dedupKey);
  return handled(input.actionId);
}

if (input.actionId === "restore-queue") {
  const queueSessionId = parseQueueSessionId(input.notification);
  if (!queueSessionId) throw new Error("restore-queue requires a queue session id");
  const restore = this.deps.playlist?.restoreRecoverableSession;
  if (!restore) return unsupported(input.actionId);
  await restore(queueSessionId);
  return handled(input.actionId);
}

if (input.actionId === "update-app") {
  const openReleasePage = this.deps.appUpdate?.openReleasePage;
  if (!openReleasePage) return unsupported(input.actionId);
  await openReleasePage(parseAppUpdateVersion(input.notification));
  return handled(input.actionId);
}
```

For media actions, preserve the original notification action ID:

```ts
const runMediaAction = this.deps.mediaActions?.run;
if (!runMediaAction) return unsupported(input.actionId);
const result = await runMediaAction({
  actionId: input.actionId === "retry-download" ? "download" : input.actionId,
  item,
  source: "notification",
  playbackActive: input.playbackActive,
  confirmedContextSwitch: input.confirmedContextSwitch,
});
return result.status === "handled"
  ? handled(input.actionId)
  : {
      status: "unsupported",
      actionId: input.actionId,
      reason: result.reason,
    };
```

Only stored `dismiss` calls the lifecycle callback.

- [ ] **Step 6: Run focused tests**

```bash
bun run --cwd apps/cli test:file \
  test/unit/app-shell/notification-overlay-model.test.ts \
  test/unit/services/notifications/NotificationActionRouter.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit explicit files**

```bash
git add -- \
  apps/cli/src/app-shell/notification-overlay-model.ts \
  apps/cli/test/unit/app-shell/notification-overlay-model.test.ts \
  apps/cli/src/services/notifications/NotificationActionRouter.ts \
  apps/cli/test/unit/services/notifications/NotificationActionRouter.test.ts
git commit -m "feat(notifications): expose executable action outcomes"
```

---

### Task 3: Build the complete sortable notifications view model

**Files:**

- Modify: `apps/cli/src/app-shell/notifications-view.ts`
- Modify: `apps/cli/test/unit/app-shell/notifications-view.test.ts`

**Consumes:** action helpers from Task 2 and `parseNotificationMediaItem()` from `NotificationActionRouter.ts`

**Produces:**

```ts
export type NotificationsSortMode = "attention" | "newest" | "type";
export const NOTIFICATION_SORT_MODES_BY_TAB: Readonly<
  Record<NotificationsTab, readonly NotificationsSortMode[]>
>;
export function getDefaultNotificationsSortMode(tab: NotificationsTab): NotificationsSortMode;
export function cycleNotificationsSortMode(
  tab: NotificationsTab,
  current: NotificationsSortMode,
): NotificationsSortMode;
export function nearestNotificationDedupKey(
  orderedDedupKeys: readonly string[],
  removedDedupKey: string,
): string | null;
```

- [ ] **Step 1: Replace the current tests with exact ordering fixtures**

Create records that prove Attention tiers and deterministic ordering:

```ts
expect(view.orderedDedupKeys).toEqual([
  "unread-action-new",
  "unread-action-old",
  "unread-dismiss-new",
  "read-new",
  "read-old",
]);
```

Add separate tests for:

```ts
expect(buildNewestView().orderedDedupKeys).toEqual(["newest", "middle", "oldest"]);
expect(buildTypeView().orderedDedupKeys).toEqual([
  "queue-recovery",
  "download-failed",
  "new-episode",
  "app-update",
  "download-complete",
  "future-kind",
]);
```

For equal timestamps, assert ascending `dedupKey` order.

- [ ] **Step 2: Add failing pagination, selection, and projection tests**

Cover:

```ts
expect(cycleNotificationsSortMode("active", "attention")).toBe("newest");
expect(cycleNotificationsSortMode("active", "type")).toBe("attention");
expect(cycleNotificationsSortMode("archive", "newest")).toBe("type");
expect(cycleNotificationsSortMode("archive", "type")).toBe("newest");
```

Also prove:

- sorting occurs before pagination;
- a selected `dedupKey` derives the page containing that row;
- a missing selected key falls back to the first row on the clamped requested page;
- `nearestNotificationDedupKey(["a", "b", "c"], "b")` returns `"c"`;
- removing the final row returns the previous row;
- malformed `itemJson` does not throw;
- unknown kinds use `Notification` and the generic glyph;
- Active empty title is `You're all caught up.`;
- Archive empty title is `No archived notifications.`;
- blank, malformed, and non-HTTP poster URLs are omitted.

- [ ] **Step 3: Run the view test and verify failure**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/notifications-view.test.ts
```

Expected: missing sort, selection, action-presentation, and rail fields.

- [ ] **Step 4: Introduce the view contracts**

Use these types:

```ts
export type NotificationRow = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly glyph: string;
  readonly tone: ShellStatusTone;
  readonly title: string;
  readonly body: string;
  readonly unread: boolean;
  readonly actionable: boolean;
  readonly primaryAction: NotificationActionPresentation;
  readonly posterUrl?: string;
  readonly relativeTime: string;
};

export type NotificationRailView = {
  readonly dedupKey: string;
  readonly kindLabel: string;
  readonly glyph: string;
  readonly tone: ShellStatusTone;
  readonly unread: boolean;
  readonly relativeTime: string;
  readonly preview: PreviewRailModel;
  readonly primaryAction: NotificationActionPresentation & { readonly key: "enter" };
  readonly secondaryActions: readonly NotificationActionPresentation[];
  readonly lifecycleHints: readonly { readonly key: string; readonly label: string }[];
};

export type NotificationsView = {
  readonly tab: NotificationsTab;
  readonly tabLabel: "Active" | "Archive";
  readonly sortMode: NotificationsSortMode;
  readonly sortLabel: "Needs attention" | "Newest" | "Type";
  readonly rows: readonly NotificationRow[];
  readonly orderedDedupKeys: readonly string[];
  readonly selectedIndex: number;
  readonly selectedRow: NotificationRow | null;
  readonly rail: NotificationRailView | null;
  readonly page: number;
  readonly totalPages: number;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
};
```

Update `BuildNotificationsViewInput`:

```ts
export type BuildNotificationsViewInput = {
  readonly records: readonly NotificationRecord[];
  readonly tab: NotificationsTab;
  readonly sortMode: NotificationsSortMode;
  readonly page: number;
  readonly pageSize: number;
  readonly selectedDedupKey: string | null;
  readonly now: string;
};
```

- [ ] **Step 5: Implement deterministic sorting and pagination**

Define the allowed modes and cycle behavior exactly:

```ts
export const NOTIFICATION_SORT_MODES_BY_TAB = {
  active: ["attention", "newest", "type"],
  archive: ["newest", "type"],
} as const satisfies Readonly<Record<NotificationsTab, readonly NotificationsSortMode[]>>;

export function getDefaultNotificationsSortMode(tab: NotificationsTab): NotificationsSortMode {
  return tab === "active" ? "attention" : "newest";
}

export function cycleNotificationsSortMode(
  tab: NotificationsTab,
  current: NotificationsSortMode,
): NotificationsSortMode {
  const modes: readonly NotificationsSortMode[] = NOTIFICATION_SORT_MODES_BY_TAB[tab];
  const currentIndex = modes.indexOf(current);
  return modes[(currentIndex + 1 + modes.length) % modes.length] ?? modes[0] ?? "newest";
}
```

Use non-mutating helpers:

```ts
const TYPE_GROUP: Readonly<Record<string, number>> = {
  "queue-recovery": 0,
  "download-failed": 0,
  "new-episode": 1,
  "app-update": 2,
  "download-complete": 3,
};

function compareNewest(a: NotificationRecord, b: NotificationRecord): number {
  const byTime = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  return byTime !== 0 ? byTime : a.dedupKey.localeCompare(b.dedupKey);
}

function attentionTier(record: NotificationRecord): number {
  if (record.readAt) return 2;
  return getNotificationPrimaryAction(record) === "dismiss" ? 1 : 0;
}

function sortRecords(
  records: readonly NotificationRecord[],
  mode: NotificationsSortMode,
): NotificationRecord[] {
  return [...records].sort((a, b) => {
    if (mode === "attention") {
      const byTier = attentionTier(a) - attentionTier(b);
      return byTier !== 0 ? byTier : compareNewest(a, b);
    }
    if (mode === "type") {
      const byGroup = (TYPE_GROUP[a.kind] ?? 4) - (TYPE_GROUP[b.kind] ?? 4);
      return byGroup !== 0 ? byGroup : compareNewest(a, b);
    }
    return compareNewest(a, b);
  });
}
```

Derive the effective page from the selected key when it exists:

```ts
const selectedGlobalIndex = input.selectedDedupKey
  ? orderedRecords.findIndex((record) => record.dedupKey === input.selectedDedupKey)
  : -1;
const requestedPage = Math.min(Math.max(0, input.page), totalPages - 1);
const page = selectedGlobalIndex >= 0 ? Math.floor(selectedGlobalIndex / pageSize) : requestedPage;
```

- [ ] **Step 6: Implement safe row and rail projection**

Use `notificationKindLabel()`, `notificationKindGlyph()`, `getNotificationTone()`, `getExecutableNotificationActions()`, and `getNotificationActionPresentation()` once per record. `actionable` is `primaryAction.id !== "dismiss"`.

Only accept poster URLs matching `http:` or `https:`:

```ts
function posterUrlOf(record: NotificationRecord): string | undefined {
  if (!record.itemJson) return undefined;
  try {
    const parsed = JSON.parse(record.itemJson) as { posterUrl?: unknown };
    if (typeof parsed.posterUrl !== "string") return undefined;
    const url = new URL(parsed.posterUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
```

Build `PreviewRailModel` with full title/body, poster state `"none"`, and facts for kind, read state, recency, and media evidence when `parseNotificationMediaItem()` succeeds. Format media facts without introducing another helper module:

```ts
const media = parseNotificationMediaItem(record);
const episode = media
  ? media.episode !== undefined
    ? media.season !== undefined
      ? `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
      : `E${String(media.episode).padStart(2, "0")}`
    : media.absoluteEpisode !== undefined
      ? `E${String(media.absoluteEpisode).padStart(2, "0")}`
      : media.mediaKind === "movie"
        ? "Movie"
        : undefined
  : undefined;
const provider = media?.providerHints?.[0]?.providerId;
```

The rail’s `secondaryActions` must exclude the primary action and stored `dismiss`:

```ts
const secondaryActions = executableActions
  .filter((action) => action !== primaryAction.id && action !== "dismiss")
  .map(getNotificationActionPresentation);
```

Use lifecycle hints by tab:

```ts
const lifecycleHints =
  input.tab === "active"
    ? [
        { key: "r", label: "mark read" },
        { key: "x", label: "archive" },
        { key: "d", label: "delete" },
      ]
    : [
        { key: "d", label: "delete" },
        { key: "C", label: "clear archive" },
      ];
```

Unknown or malformed metadata yields text-only facts.

- [ ] **Step 7: Implement nearest-selection helper**

```ts
export function nearestNotificationDedupKey(
  orderedDedupKeys: readonly string[],
  removedDedupKey: string,
): string | null {
  const index = orderedDedupKeys.indexOf(removedDedupKey);
  if (index < 0) return null;
  return orderedDedupKeys[index + 1] ?? orderedDedupKeys[index - 1] ?? null;
}
```

- [ ] **Step 8: Run the focused test**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/notifications-view.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit explicit files**

```bash
git add -- \
  apps/cli/src/app-shell/notifications-view.ts \
  apps/cli/test/unit/app-shell/notifications-view.test.ts
git commit -m "feat(notifications): build sortable inbox view model"
```

---

### Task 4: Add session-local navigation, sort retention, and stable targeting

**Files:**

- Modify: `apps/cli/src/app-shell/use-notifications-overlay-input.ts`
- Modify: `apps/cli/test/unit/app-shell/use-notifications-overlay-input.test.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx:527-535,821-862,1317-1425,1676-1707`
- Modify: `apps/cli/src/app-shell/keybindings.ts`
- Modify: `apps/cli/src/app-shell/overlay-footer-actions.ts`
- Modify: `apps/cli/test/unit/app-shell/overlay-footer-actions.test.ts`

**Consumes:** view model from Task 3

**Produces:**

```ts
export type NotificationsSortByTab = Readonly<{
  active: NotificationsSortMode;
  archive: Exclude<NotificationsSortMode, "attention">;
}>;
export type NotificationsOverlayState = {
  readonly tab: NotificationsTab;
  readonly page: number;
  readonly sortByTab: NotificationsSortByTab;
  readonly selectedDedupKey: string | null;
};
export function createNotificationsOverlayState(): NotificationsOverlayState;
```

- [ ] **Step 1: Add failing state-transition input tests**

Test the handler with a real `NotificationsView` fixture and assert complete state objects:

```ts
expect(afterActiveSort).toEqual({
  tab: "active",
  page: 0,
  sortByTab: { active: "newest", archive: "newest" },
  selectedDedupKey: null,
});
expect(afterArchiveSort).toEqual({
  tab: "archive",
  page: 0,
  sortByTab: { active: "type", archive: "type" },
  selectedDedupKey: null,
});
```

Cover:

- Active cycles `attention → newest → type → attention`;
- Archive cycles `newest ↔ type`;
- Tab switching resets page/selection and retains the destination tab’s prior sort;
- page changes reset selection and clamp through `view.totalPages`;
- up/down stores the visible row’s `dedupKey`;
- `r` and `A` preserve the selected key before mutation;
- `x` and `d` select `nearestNotificationDedupKey()` before refreshing;
- `C` resets page and selected identity;
- `a` opens actions for the selected `dedupKey`.

- [ ] **Step 2: Run the input test and verify failure**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/use-notifications-overlay-input.test.ts
```

Expected: the existing handler lacks overlay state and sort transitions.

- [ ] **Step 3: Define overlay state and transition the handler**

Add:

```ts
export function createNotificationsOverlayState(): NotificationsOverlayState {
  return {
    tab: "active",
    page: 0,
    sortByTab: { active: "attention", archive: "newest" },
    selectedDedupKey: null,
  };
}
```

Replace separate tab/page setters in the context with:

```ts
readonly state: NotificationsOverlayState;
readonly view: NotificationsView;
readonly setState: (
  update: (state: NotificationsOverlayState) => NotificationsOverlayState,
) => void;
```

On `s`:

```ts
ctx.setState((state) => {
  const current = state.sortByTab[state.tab];
  const next = cycleNotificationsSortMode(state.tab, current);
  return {
    ...state,
    page: 0,
    selectedDedupKey: null,
    sortByTab: { ...state.sortByTab, [state.tab]: next },
  } as NotificationsOverlayState;
});
return "handled";
```

On Tab, retain `sortByTab`, switch the tab, and reset page/selection. On lifecycle removals, calculate the nearest key from `ctx.view.orderedDedupKeys` before mutating storage.

- [ ] **Step 4: Replace root notification state and raw targeting**

Replace `notifTab` and `notifPage` with:

```ts
const [notificationsState, setNotificationsState] = useState<NotificationsOverlayState>(
  createNotificationsOverlayState,
);
```

Read complete records:

```ts
const notificationRecordsAll =
  overlay.type === "notifications"
    ? notificationsState.tab === "active"
      ? container.notificationService.listAllActive()
      : container.notificationService.listAllArchived()
    : [];
```

Build the view with:

```ts
const notificationsView = buildNotificationsView({
  records: notificationRecordsAll,
  tab: notificationsState.tab,
  sortMode: notificationsState.sortByTab[notificationsState.tab],
  page: notificationsState.page,
  pageSize: notifPageSize,
  selectedDedupKey: notificationsState.selectedDedupKey,
  now: new Date().toISOString(),
});
```

Delete the raw `slice()` at the current lines 838-841. Map visible keys back to records:

```ts
const notificationRecordsByKey = new Map(
  notificationRecordsAll.map((record) => [record.dedupKey, record] as const),
);
const notificationRecords = notificationsView.rows.flatMap((row) => {
  const record = notificationRecordsByKey.get(row.dedupKey);
  return record ? [record] : [];
});
```

Resolve `notificationActionDedupKey` against `notificationRecordsAll`, and resolve top-level Enter from `notificationsView.selectedRow?.dedupKey`.

Use `notificationsView.selectedIndex` for the top-level shell and arrow movement. Keep generic `selectedIndex` only for the nested action and confirmation pickers.

- [ ] **Step 5: Add notification keybinding entries and footer contract**

Retain the existing Enter, `A`, `x`, `C`, page, and Tab entries. Add these exact registry entries; do not assign `d` to Details:

```ts
{
  id: "notifications-all-actions",
  chord: { input: "a" },
  label: "Open all notification actions",
  hintLabel: "actions",
  scope: "notifications",
  group: "Notifications",
  footerPriority: 12,
},
{
  id: "notifications-sort",
  chord: { input: "s" },
  label: "Cycle notification sort",
  hintLabel: "sort",
  scope: "notifications",
  group: "Notifications",
  footerPriority: 14,
},
{
  id: "notifications-mark-read",
  chord: { input: "r" },
  label: "Mark selected notification as read",
  hintLabel: "read",
  scope: "notifications",
  group: "Notifications",
  helpOnly: true,
},
{
  id: "notifications-delete",
  chord: { input: "d" },
  label: "Delete selected notification",
  hintLabel: "delete",
  scope: "notifications",
  group: "Notifications",
  helpOnly: true,
},
```

Change the footer API to:

```ts
export function notificationsFooterActions(input: {
  readonly tab: NotificationsTab;
  readonly paginated: boolean;
}): readonly FooterAction[];
```

Build the persistent order from registry bindings:

```ts
const ids = [
  "notifications-action",
  "notifications-all-actions",
  "notifications-sort",
  "notifications-tab",
  ...(input.paginated ? ["notifications-page"] : []),
];
return buildFooterActionsFromBindings("notifications", {
  ids,
  overrides: {
    "notifications-action": { label: "act", primary: true },
    "notifications-tab": { label: input.tab === "active" ? "archive" : "active" },
  },
});
```

The visible labels must read `enter act`, `a actions`, `s sort`, `tab archive|active`, optional `[ / ] page`, `/ commands`, and `esc close`. Keep `r`, `x`, `d`, `A`, and `C` in command help but out of the persistent footer.

- [ ] **Step 6: Add failing footer tests, then implement**

Assert Active with pagination:

```ts
expect(actionPairs).toEqual([
  "enter:act",
  "a:actions",
  "s:sort",
  "tab:archive",
  "[ / ]:page",
  "/:commands",
  "esc:close",
]);
```

Assert Archive without pagination contains `tab:active` and omits the page action.

- [ ] **Step 7: Run focused input/help tests**

```bash
bun run --cwd apps/cli test:file \
  test/unit/app-shell/use-notifications-overlay-input.test.ts \
  test/unit/app-shell/overlay-footer-actions.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts \
  test/unit/app-shell/help-overlay.test.tsx
```

Expected: pass.

- [ ] **Step 8: Commit explicit files**

```bash
git add -- \
  apps/cli/src/app-shell/use-notifications-overlay-input.ts \
  apps/cli/test/unit/app-shell/use-notifications-overlay-input.test.ts \
  apps/cli/src/app-shell/root-overlay-shell.tsx \
  apps/cli/src/app-shell/keybindings.ts \
  apps/cli/src/app-shell/overlay-footer-actions.ts \
  apps/cli/test/unit/app-shell/overlay-footer-actions.test.ts
git commit -m "feat(notifications): add session-local inbox controls"
```

---

### Task 5: Render the dense list and selected-notice companion rail

**Files:**

- Modify: `apps/cli/src/app-shell/primitives/MediaListShell.tsx`
- Modify: `apps/cli/src/app-shell/notifications-shell.tsx`
- Modify: `apps/cli/test/unit/app-shell/notifications-shell.test.tsx`

**Consumes:** `NotificationsView` from Task 3 and selection wiring from Task 4

**Produces:** optional custom `rail` support in `MediaListShell`; approved 140-column split rail and collapsed 100/72-column layouts

- [ ] **Step 1: Add failing render captures at 72, 100, and 140 columns**

Use the local `captureAllWidths()` or explicit `captureFrame()` calls. Fixtures must cover:

- actionable unread selected row;
- read selected row;
- Archive selected row;
- exact Active and Archive empty copy;
- multiple pages;
- long title truncation;
- unknown kind;
- malformed item metadata;
- dismiss-only notice;
- media evidence in the selected rail.

Assert at 140 columns that the rail includes full title/body, unread/read state, recency, primary action, secondary labels, and lifecycle hints. Assert at 100 and 72 columns that rail-only evidence is absent while rows, action label, sort label, and pagination remain.

- [ ] **Step 2: Run the shell test and verify failure**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/notifications-shell.test.tsx
```

Expected: current two-line rows and no responsive rail.

- [ ] **Step 3: Extend `MediaListShell` with an optional custom rail slot**

Change the props to:

```ts
export type MediaListShellProps = {
  readonly columns: number;
  readonly listWidth: number;
  readonly railWidth?: number;
  readonly list: React.ReactNode;
  readonly rail?: React.ReactNode;
  readonly railModel?: PreviewRailModel | null;
  readonly poster?: PosterResult;
};
```

Render with the existing shared threshold:

```tsx
const hasRail = rail !== undefined || railModel != null;
const showRail = shouldRenderPreviewRail({ columns, hasModel: hasRail });

return (
  <Box flexDirection={showRail ? "row" : "column"} justifyContent="space-between" flexGrow={1}>
    <Box flexDirection="column" width={showRail ? listWidth : undefined}>
      {list}
    </Box>
    {showRail ? (
      <Box marginLeft={2} flexDirection="column">
        {rail ??
          (railModel ? <PreviewRail model={railModel} width={railWidth} poster={poster} /> : null)}
      </Box>
    ) : null}
  </Box>
);
```

Existing callers may continue passing `railModel`; do not modify their behavior.

- [ ] **Step 4: Replace notification-specific two-line rows with `ListRow`**

Map semantic row tones to existing palette tokens:

```ts
function toneColor(tone: ShellStatusTone): string {
  if (tone === "error") return palette.danger;
  if (tone === "warning") return palette.warn;
  if (tone === "success") return palette.ok;
  if (tone === "info") return palette.info;
  return palette.muted;
}
```

Use four columns:

```ts
const columns: readonly ListRowColumn[] = [
  {
    text: row.unread ? `● ${row.glyph}` : `  ${row.glyph}`,
    width: 4,
    color: row.unread ? toneColor(row.tone) : palette.dim,
    dim: !row.unread,
  },
  listRowTitleColumn(row.title, 12),
  listRowStatusColumn(row.primaryAction.label, 16, row.actionable ? palette.accent : palette.muted),
  listRowTimeColumn(row.relativeTime, 5),
];
```

Pass `flexColumnIndex={1}` so title absorbs remaining width. Keep body text in the rail, not in a second list line.

- [ ] **Step 5: Compose the notification rail locally**

Use `useRailPoster()` from `apps/cli/src/app-shell/hooks/use-rail-poster.ts`, enabled only when `shouldRenderPreviewRail({ columns, hasModel: view.rail !== null })` is true:

```ts
const showRail = shouldRenderPreviewRail({ columns, hasModel: view.rail !== null });
const { poster, posterState } = useRailPoster(view.rail?.preview.posterUrl, {
  rows: 10,
  cols: 28,
  enabled: showRail,
  variant: "detail",
});
```

Compose the custom rail with the live poster state:

```tsx
<Box flexDirection="column" width={32}>
  <PreviewRail model={{ ...view.rail.preview, posterState }} width={32} poster={poster} />
  <Box marginTop={1} flexDirection="column">
    <Text color={palette.accent} bold>{`↵ ${view.rail.primaryAction.label}`}</Text>
    {view.rail.secondaryActions.slice(0, 3).map((action) => (
      <Text key={action.id} color={palette.muted}>{`· ${action.label}`}</Text>
    ))}
  </Box>
  <Box marginTop={1} flexDirection="column">
    {view.rail.lifecycleHints.map((hint) => (
      <Text key={hint.key} color={palette.dim}>{`${hint.key} ${hint.label}`}</Text>
    ))}
  </Box>
</Box>
```

Do not render `ActionList` and do not repeat Enter/`a`/`s`/Tab/page footer instructions inside the rail.

- [ ] **Step 6: Render one context strip**

Use the `SectionGroup` tag exactly as:

```ts
const context = [
  view.tabLabel,
  view.sortLabel,
  unreadCount > 0 && view.tab === "active" ? `${unreadCount} unread` : null,
]
  .filter(Boolean)
  .join(" · ");
```

Pagination renders only `page N/M`. Empty state uses `view.emptyTitle` and no duplicated generic title.

- [ ] **Step 7: Run render and primitive regressions**

```bash
bun run --cwd apps/cli test:file \
  test/unit/app-shell/notifications-shell.test.tsx \
  test/unit/app-shell/preview-rail.test.ts \
  test/unit/app-shell/list-row-width.test.ts \
  test/unit/app-shell/action-list.test.ts
```

Expected: pass; `ActionList` tests remain unchanged.

- [ ] **Step 8: Commit explicit files**

```bash
git add -- \
  apps/cli/src/app-shell/primitives/MediaListShell.tsx \
  apps/cli/src/app-shell/notifications-shell.tsx \
  apps/cli/test/unit/app-shell/notifications-shell.test.tsx
git commit -m "feat(notifications): render selected notice companion rail"
```

---

### Task 6: Mark notices read only after confirmed handled actions

**Files:**

- Create: `apps/cli/src/app-shell/notification-action-flow.ts`
- Create: `apps/cli/test/unit/app-shell/notification-action-flow.test.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx:928-1028,1341-1377`

**Consumes:** `NotificationActionRunResult` from Task 2 and identity selection from Task 4

**Produces:** `executeNotificationOverlayAction()`

- [ ] **Step 1: Write failing action-flow tests**

Cover these cases:

```ts
expect(await executeNotificationOverlayAction(queueNextInput)).toEqual({
  status: "handled",
  actionId: "queue-next",
});
expect(markRead).toHaveBeenCalledWith("notice-1");
```

Also assert:

1. handled `restore-queue` marks read and does not archive;
2. handled `update-app` marks read and does not archive;
3. handled `dismiss` does not call `markRead`;
4. unsupported action does not call `markRead`;
5. thrown router error does not call `markRead`;
6. active-playback `play-now` without confirmation returns `confirmation-required` without invoking router or `markRead`;
7. confirmed `play-now` records call order `router:start`, `router:done`, `mark-read`.

- [ ] **Step 2: Run the new test and verify failure**

```bash
bun run --cwd apps/cli test:file test/unit/app-shell/notification-action-flow.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement the orchestration helper**

Create:

```ts
import type {
  NotificationActionId,
  NotificationActionRouter,
  NotificationActionRunResult,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export type NotificationOverlayActionResult =
  | { readonly status: "confirmation-required"; readonly actionId: "play-now" }
  | NotificationActionRunResult;

export type ExecuteNotificationOverlayActionInput = {
  readonly router: Pick<NotificationActionRouter, "run">;
  readonly notification: NotificationRecord;
  readonly actionId: NotificationActionId;
  readonly playbackActive: boolean;
  readonly confirmedContextSwitch?: boolean;
  readonly markRead: (dedupKey: string) => Promise<void> | void;
};

export async function executeNotificationOverlayAction(
  input: ExecuteNotificationOverlayActionInput,
): Promise<NotificationOverlayActionResult> {
  if (
    input.actionId === "play-now" &&
    input.playbackActive &&
    input.confirmedContextSwitch !== true
  ) {
    return { status: "confirmation-required", actionId: "play-now" };
  }

  const result = await input.router.run({
    notification: input.notification,
    actionId: input.actionId,
    playbackActive: input.playbackActive,
    confirmedContextSwitch: input.confirmedContextSwitch,
  });

  if (result.status === "handled" && input.actionId !== "dismiss") {
    await input.markRead(input.notification.dedupKey);
  }

  return result;
}
```

- [ ] **Step 4: Replace inline root action lifecycle behavior**

In `runNotificationAction()`:

- resolve from `notificationRecordsAll`, not the visible page;
- preserve `dedupKey` in `notificationsState.selectedDedupKey` before execution;
- call `executeNotificationOverlayAction()`;
- on `confirmation-required`, open the existing confirmation picker;
- on `unsupported`, set `Action unavailable: ${result.reason}` and leave lifecycle state unchanged;
- on handled non-dismiss, refresh while preserving the selected key;
- on handled dismiss in Active, select `nearestNotificationDedupKey()`;
- on thrown error, preserve the selected key and report failure.

Remove the existing implicit archive from playback:

```ts
await container.notificationService.archive(notification.dedupKey);
```

The playback callback becomes:

```ts
playNow: async (item) => {
  applyMediaItemSessionRouting(container, item);
  stageNotificationPlaybackIntent(playbackIntentFromMediaItem(item));
  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
},
```

Pass mark-read through the helper:

```ts
markRead: (key) => container.notificationService.markRead(key),
```

- [ ] **Step 5: Preserve identity across nested pickers**

Opening `a` may reset generic `selectedIndex` for the child action picker, but it must not clear `notificationsState.selectedDedupKey`. Escaping the child picker restores the top-level selection through `notificationsView.selectedIndex`.

Top-level Enter uses:

```ts
runNotificationAction(notificationsView.selectedRow?.dedupKey ?? null);
```

- [ ] **Step 6: Run the complete focused Notifications slice**

```bash
bun run --cwd apps/cli test:file \
  test/unit/services/notifications/NotificationService.test.ts \
  test/unit/services/notifications/NotificationActionRouter.test.ts \
  test/unit/app-shell/notification-overlay-model.test.ts \
  test/unit/app-shell/notifications-view.test.ts \
  test/unit/app-shell/use-notifications-overlay-input.test.ts \
  test/unit/app-shell/notifications-shell.test.tsx \
  test/unit/app-shell/notification-action-flow.test.ts \
  test/unit/app-shell/overlay-footer-actions.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts \
  test/unit/app-shell/help-overlay.test.tsx
bun run --cwd packages/storage test
```

Expected: all commands pass.

- [ ] **Step 7: Commit explicit files**

```bash
git add -- \
  apps/cli/src/app-shell/notification-action-flow.ts \
  apps/cli/test/unit/app-shell/notification-action-flow.test.ts \
  apps/cli/src/app-shell/root-overlay-shell.tsx
git commit -m "feat(notifications): mark successful actions read"
```

---

## Final verification

- [ ] **Step 1: Snapshot unrelated dependency WIP before repository gates**

```bash
git diff --binary -- \
  package.json \
  apps/docs/package.json \
  bun.lock > /tmp/kunai-unrelated-dependency-wip.patch
git status --short
```

Expected: the three unrelated files remain unstaged; only intended Notifications work may be staged or committed.

- [ ] **Step 2: Run required repository gates**

```bash
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Expected: all pass. If `bun run fmt` changes any of the three unrelated WIP files, stop and compare against `/tmp/kunai-unrelated-dependency-wip.patch` before staging anything; do not silently absorb formatter edits into Notifications commits.

- [ ] **Step 3: Verify unrelated WIP remains unchanged and unstaged**

```bash
git status --short
git diff --binary -- \
  package.json \
  apps/docs/package.json \
  bun.lock > /tmp/kunai-unrelated-dependency-wip-after.patch
cmp /tmp/kunai-unrelated-dependency-wip.patch /tmp/kunai-unrelated-dependency-wip-after.patch
```

Expected: `cmp` exits 0.

- [ ] **Step 4: Run real-terminal smoke with active playback**

Verify all of the following:

1. Opening Notifications does not interrupt mpv.
2. Active opens with Needs attention.
3. Active cycles Attention, Newest, and Type.
4. Archive cycles Newest and Type.
5. Switching tabs preserves each tab’s selected sort until close.
6. Paging and sorting keep Enter targeted to the visible selected `dedupKey`.
7. Marking a row read under Attention keeps that identity selected even if it moves.
8. A safe media action marks read and leaves the notice Active.
9. Cancelling play-now confirmation leaves read/archive state unchanged.
10. Confirmed play-now marks read only after handled execution.
11. Archive and delete select the nearest surviving row at start, middle, end, and sole-row positions.
12. The rail renders at 140 columns and collapses at 100 and 72 columns.
13. Terminal input, redraw, and mpv remain healthy.

- [ ] **Step 5: Request final review**

Use `superpowers:requesting-code-review` against the full Notifications implementation range. Fix all Critical and Important findings, rerun the focused tests that cover each fix, then rerun the required repository gates.
