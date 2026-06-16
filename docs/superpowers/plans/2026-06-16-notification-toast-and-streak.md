# Notification Toast + Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a bright, auto-dismissing toast in the shell's existing transient-alert row when a new active notification arrives (the trigger that's currently missing), reusing the streak-milestone row and styling.

**Architecture:** `NotificationService` gains a tiny `subscribe`/`emitChange` change-signal (emitted after every mutation). A pure `selectNotificationToast` selector diffs the current active dedupKeys against a seen-set to find new arrivals. `ink-shell.tsx` seeds the seen-set on mount (no startup spam), subscribes, and renders the winning line in the single transient row by an explicit priority order.

**Tech Stack:** TypeScript, Bun, Ink 7 / React 19, `bun:test`, `captureFrame` harness.

Spec: `docs/superpowers/specs/2026-06-16-notification-toast-and-streak-design.md`

---

### Task 1: NotificationService change signal

**Files:**

- Modify: `apps/cli/src/services/notifications/NotificationService.ts`
- Test: `apps/cli/test/unit/services/notifications/notification-service-subscribe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { NotificationService } from "@/services/notifications/NotificationService";

function makeService() {
  const rows: any[] = [];
  const repo = {
    upsertDerived: (n: any) => rows.push(n),
    listActive: () => rows,
    listArchived: () => [],
    markRead: () => {},
    markAllRead: () => {},
    archive: () => {},
    dismissByDedupKey: () => {},
    deleteByDedupKey: () => {},
    deleteByKind: () => 0,
    clearArchived: () => 0,
    listSuppressed: () => new Set<string>(),
  };
  return new NotificationService({ repo: repo as any });
}

describe("NotificationService.subscribe", () => {
  test("listener fires on recordSignals and stops after unsubscribe", () => {
    const service = makeService();
    let calls = 0;
    const unsub = service.subscribe(() => {
      calls += 1;
    });
    service.recordSignals([
      {
        dedupKey: "k1",
        kind: "new-episode",
        title: "Show",
        updatedAt: "2026-06-16T00:00:00Z",
      } as any,
    ]);
    expect(calls).toBe(1);
    unsub();
    service.recordSignals([
      {
        dedupKey: "k2",
        kind: "new-episode",
        title: "Show2",
        updatedAt: "2026-06-16T00:00:01Z",
      } as any,
    ]);
    expect(calls).toBe(1);
  });

  test("listener fires on delete", () => {
    const service = makeService();
    let calls = 0;
    service.subscribe(() => {
      calls += 1;
    });
    service.delete("k1");
    expect(calls).toBe(1);
  });
});
```

> NOTE: match the real `NotificationServiceDeps`/repo method names when wiring the stub — open `NotificationService.ts` and mirror its constructor shape. The two assertions (fires once on `recordSignals`, stops after `unsub`, fires on `delete`) are what matter.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test:file test/unit/services/notifications/notification-service-subscribe.test.ts`
Expected: FAIL — `service.subscribe is not a function`.

- [ ] **Step 3: Add subscribe/emitChange and emit on every mutation**

In `NotificationService` (class body), add:

```ts
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
```

Then call `this.emitChange();` at the END of each mutating method: `recordSignals`, `markRead`, `markAllRead`, `archive`, `dismiss`, `delete`, `deleteByKind`, `clearArchived`. (Read methods `listActive`/`listArchived` do NOT emit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun run test:file test/unit/services/notifications/notification-service-subscribe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/notifications/NotificationService.ts apps/cli/test/unit/services/notifications/notification-service-subscribe.test.ts
git commit -m "feat(notifications): add subscribe/emitChange change signal"
```

---

### Task 2: Pure toast selector

**Files:**

- Create: `apps/cli/src/app-shell/notification-toast.ts`
- Test: `apps/cli/test/unit/app-shell/notification-toast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { selectNotificationToast } from "@/app-shell/notification-toast";

const item = (dedupKey: string, kind: string, title: string) => ({ dedupKey, kind, title });

describe("selectNotificationToast", () => {
  test("a new active key produces a toast with kind glyph + label + title", () => {
    const r = selectNotificationToast({
      active: [item("k1", "new-episode", "Bungo Stray Dogs")],
      seenKeys: new Set<string>(),
    });
    expect(r.toast).toBe("● New episode — Bungo Stray Dogs");
    expect(r.seenKeys.has("k1")).toBe(true);
  });

  test("no new keys → null toast", () => {
    const r = selectNotificationToast({
      active: [item("k1", "new-episode", "Show")],
      seenKeys: new Set(["k1"]),
    });
    expect(r.toast).toBeNull();
  });

  test("seeded-on-mount (all seen) never toasts", () => {
    const active = [item("k1", "new-episode", "A"), item("k2", "download-complete", "B")];
    const seenKeys = new Set(active.map((a) => a.dedupKey));
    expect(selectNotificationToast({ active, seenKeys }).toast).toBeNull();
  });

  test("multiple new → newest (first of DESC-ordered active) wins", () => {
    const r = selectNotificationToast({
      active: [item("new2", "download-failed", "Newest"), item("new1", "new-episode", "Older")],
      seenKeys: new Set<string>(),
    });
    expect(r.toast).toBe("⚠ Download failed — Newest");
  });

  test("a removed key drops out of the returned seenKeys", () => {
    const r = selectNotificationToast({
      active: [item("k2", "new-episode", "B")],
      seenKeys: new Set(["k1", "k2"]),
    });
    expect(r.seenKeys.has("k1")).toBe(false);
    expect(r.seenKeys.has("k2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test:file test/unit/app-shell/notification-toast.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the selector**

```ts
// Pure toast selector. Given the active notifications (newest first, as
// listActive returns ORDER BY updated_at DESC) and the set of dedupKeys already
// seen, pick the newest unseen one as a transient toast string. The returned
// seenKeys = every current active key, so deletions can't resurrect a toast.

export type NotificationToastItem = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
};

export type NotificationToastInput = {
  readonly active: readonly NotificationToastItem[];
  readonly seenKeys: ReadonlySet<string>;
};

export type NotificationToastResult = {
  readonly toast: string | null;
  readonly seenKeys: ReadonlySet<string>;
};

const KIND_GLYPH: Record<string, string> = {
  "new-episode": "●",
  "download-complete": "⬇",
  "download-failed": "⚠",
  "queue-recovery": "↩",
  "app-update": "⬆",
};

const KIND_LABEL: Record<string, string> = {
  "new-episode": "New episode",
  "download-complete": "Download complete",
  "download-failed": "Download failed",
  "queue-recovery": "Queue recovered",
  "app-update": "Update available",
};

export function selectNotificationToast(input: NotificationToastInput): NotificationToastResult {
  const seenKeys = new Set(input.active.map((a) => a.dedupKey));
  const firstNew = input.active.find((a) => !input.seenKeys.has(a.dedupKey));
  if (!firstNew) return { toast: null, seenKeys };
  const glyph = KIND_GLYPH[firstNew.kind] ?? "●";
  const label = KIND_LABEL[firstNew.kind] ?? "Notification";
  return { toast: `${glyph} ${label} — ${firstNew.title}`, seenKeys };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun run test:file test/unit/app-shell/notification-toast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/notification-toast.ts apps/cli/test/unit/app-shell/notification-toast.test.ts
git commit -m "feat(notifications): pure selectNotificationToast selector"
```

---

### Task 3: Shell wiring + bright transient row

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/ink-shell-toast.test.tsx` (captureFrame)

- [ ] **Step 1: Write the failing test**

Mirror the existing ink-shell captureFrame tests (copy the harness/mount setup from the nearest `ink-shell-*.test.tsx`). Assert two things:

1. When the notification service emits a new active item after mount, the transient row renders the bright toast text (`New episode — …`).
2. An error-level `rootStatusSummary.alert` out-prioritises the toast in that single row.

```ts
// Skeleton — adapt the mount/harness to the existing ink-shell test setup.
import { describe, expect, test } from "bun:test";
import { captureFrame } from "<existing-harness-path>";

describe("ink-shell notification toast", () => {
  test("renders a bright toast when a new notification arrives", async () => {
    // mount shell with a fake container whose notificationService.listActive()
    // starts empty, then push a new active item + emitChange; capture frame.
    // expect(frame).toContain("New episode — ");
  });

  test("an error alert wins the transient row over a toast", async () => {
    // with both a rootStatusSummary.alert (error) and a pending toast,
    // expect the alert text, not the toast.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test:file test/unit/app-shell/ink-shell-toast.test.tsx`
Expected: FAIL (no toast rendered yet).

- [ ] **Step 3: Wire the shell**

In `ink-shell.tsx`:

a. Add state + seen-ref near the other notification state:

```ts
const [notificationToast, setNotificationToast] = useState<string | null>(null);
const seenKeysRef = useRef<ReadonlySet<string>>(new Set());
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

b. Seed the seen-set on mount and subscribe (new effect):

```ts
useEffect(() => {
  // Seed so pre-existing notifications never toast on first mount.
  seenKeysRef.current = new Set(
    container.notificationService.listActive(200, 0).map((n) => n.dedupKey),
  );
  const handle = () => {
    const active = container.notificationService.listActive(200, 0);
    const result = selectNotificationToast({ active, seenKeys: seenKeysRef.current });
    seenKeysRef.current = result.seenKeys;
    if (result.toast) {
      setNotificationToast(result.toast);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
    }
  };
  const unsub = container.notificationService.subscribe(handle);
  return () => {
    unsub();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };
}, [container.notificationService]);
```

Import: `import { selectNotificationToast } from "./notification-toast";`

c. In the single transient-alert row render (~line 1083), make it render the first non-null of this priority and render arrivals/streak BRIGHT (no `dimColor`); keep calm infos dim:

```
rootStatusSummary.alert (error/warning, dim)
  → notificationToast (bright)
  → streakMilestoneAlert (bright)
  → visiblePresenceBootLine (dim)
  → streakAtRiskAlert (bright)
```

Concretely, extend the existing conditional chain in that row: insert `notificationToast` immediately after the `rootStatusSummary.alert` branch, rendered as `<Text color={palette.accent} bold>{notificationToast}</Text>` (match the streak milestone styling already used below it).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun run test:file test/unit/app-shell/ink-shell-toast.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the existing ink-shell/streak tests to confirm no regression**

Run: `cd apps/cli && bun run test:file test/unit/app-shell/ink-shell.test.tsx` (and any `*streak*` test)
Expected: PASS (streak row still renders).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx apps/cli/test/unit/app-shell/ink-shell-toast.test.tsx
git commit -m "feat(notifications): bright arrival toast in the shell transient row"
```

---

### Task 4: Full gates

- [ ] **Step 1: typecheck / lint / build / targeted tests**

Run, from repo root:

```bash
bun run typecheck
bun run lint
bun run build
```

Expected: all pass. Fix any issue before finishing.

- [ ] **Step 2: Final commit if fmt changed anything**

```bash
git add -A && git commit -m "chore(notifications): fmt/lint after toast wiring" || true
```

---

## Self-Review

- **Spec coverage:** Goal 1 (arrival toast) → Tasks 2+3. Goal 2 (all kinds) → KIND_GLYPH/KIND_LABEL cover new-episode/download-complete/download-failed/queue-recovery/app-update; muted/archived excluded because the selector reads `listActive` only. Goal 3 (no startup spam) → seed `seenKeysRef` on mount (Task 3b). Goal 4 (streak unchanged, same bright row) → priority chain keeps streak; Task 3 Step 5 guards it. Goal 5 (one reserved row, single winner) → priority chain in Task 3c.
- **Type consistency:** `selectNotificationToast(input: NotificationToastInput): NotificationToastResult`, `NotificationToastItem {dedupKey,kind,title}` — used identically in Tasks 2 and 3. `subscribe(): () => void` matches the Task 3 `unsub` usage.
- **Placeholder scan:** the only intentionally-adapted bits are the test harness mount in Tasks 1 and 3 (mirror the nearest existing test) — every production code block is complete.
