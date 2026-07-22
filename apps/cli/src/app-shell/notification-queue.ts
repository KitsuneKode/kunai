import { notificationKindGlyph, notificationKindLabel } from "./notification-kinds";

export type NotificationPriority = "immediate" | "high" | "medium" | "low";

export const NOTIFICATION_TOAST_TTL_MS = 8_000;

export type NotificationQueueItem = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly priority: NotificationPriority;
  readonly arrivedAt: number;
};

export type NotificationQueueState = {
  readonly current: NotificationQueueItem | null;
  readonly currentStartedAt: number | null;
  readonly queue: readonly NotificationQueueItem[];
};

export type EnqueueInput = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly priority?: NotificationPriority;
  readonly invalidates?: readonly string[];
  readonly fold?: (
    existing: NotificationQueueItem,
    incoming: EnqueueInput,
  ) => Pick<NotificationQueueItem, "title" | "kind" | "priority">;
};

export type ActiveNotification = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
};

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function defaultPriorityForKind(kind: string): NotificationPriority {
  if (kind === "download-failed" || kind === "queue-recovery") return "high";
  if (kind === "app-update") return "low";
  // Louder than "available": the work is already done and the user is one
  // restart away from running it.
  if (kind === "app-restart-required") return "medium";
  return "medium";
}

export function formatNotificationToast(
  item: Pick<NotificationQueueItem, "kind" | "title">,
): string {
  return `${notificationKindGlyph(item.kind)} ${notificationKindLabel(item.kind)} — ${item.title}`;
}

export function createNotificationQueueState(): NotificationQueueState {
  return { current: null, currentStartedAt: null, queue: [] };
}

function compareQueueItems(a: NotificationQueueItem, b: NotificationQueueItem): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  return a.arrivedAt - b.arrivedAt;
}

function sortQueue(queue: readonly NotificationQueueItem[]): NotificationQueueItem[] {
  return [...queue].sort(compareQueueItems);
}

function foldItem(
  existing: NotificationQueueItem,
  incoming: EnqueueInput,
  arrivedAt: number,
): NotificationQueueItem {
  const folded = incoming.fold?.(existing, incoming);
  return {
    dedupKey: existing.dedupKey,
    kind: folded?.kind ?? incoming.kind,
    title: folded?.title ?? incoming.title,
    priority: folded?.priority ?? incoming.priority ?? defaultPriorityForKind(incoming.kind),
    arrivedAt,
  };
}

function removeInvalidated(
  state: NotificationQueueState,
  invalidates: readonly string[] | undefined,
): NotificationQueueState {
  if (!invalidates?.length) return state;
  const drop = new Set(invalidates);
  const current = state.current && drop.has(state.current.dedupKey) ? null : state.current;
  const currentStartedAt = current ? state.currentStartedAt : null;
  return {
    current,
    currentStartedAt,
    queue: state.queue.filter((item) => !drop.has(item.dedupKey)),
  };
}

export function enqueueNotificationItems(
  state: NotificationQueueState,
  inputs: readonly EnqueueInput[],
  now: number,
): NotificationQueueState {
  let next = state;

  for (const input of inputs) {
    next = removeInvalidated(next, input.invalidates);

    const item: NotificationQueueItem = {
      dedupKey: input.dedupKey,
      kind: input.kind,
      title: input.title,
      priority: input.priority ?? defaultPriorityForKind(input.kind),
      arrivedAt: now,
    };

    if (next.current?.dedupKey === item.dedupKey) {
      next = {
        ...next,
        current: foldItem(next.current, input, next.current.arrivedAt),
      };
      continue;
    }

    const queueIndex = next.queue.findIndex((queued) => queued.dedupKey === item.dedupKey);
    if (queueIndex >= 0) {
      const queue = [...next.queue];
      const existing = queue[queueIndex];
      if (!existing) continue;
      queue[queueIndex] = foldItem(existing, input, existing.arrivedAt);
      next = { ...next, queue: sortQueue(queue) };
      continue;
    }

    next = { ...next, queue: sortQueue([...next.queue, item]) };
  }

  if (!next.current && next.queue.length > 0) {
    const [current, ...queue] = next.queue;
    if (!current) return next;
    return { current, currentStartedAt: now, queue };
  }

  const preempt = inputs.find(
    (input) => (input.priority ?? defaultPriorityForKind(input.kind)) === "immediate",
  );
  if (preempt && next.current && next.current.priority !== "immediate") {
    const incoming: NotificationQueueItem = {
      dedupKey: preempt.dedupKey,
      kind: preempt.kind,
      title: preempt.title,
      priority: "immediate",
      arrivedAt: now,
    };
    const queue = sortQueue([
      next.current,
      ...next.queue.filter((q) => q.dedupKey !== incoming.dedupKey),
    ]);
    return { current: incoming, currentStartedAt: now, queue };
  }

  return next;
}

export function tickNotificationQueue(
  state: NotificationQueueState,
  now: number,
): { readonly state: NotificationQueueState; readonly toast: string | null } {
  if (!state.current || state.currentStartedAt === null) {
    return { state, toast: null };
  }

  if (now - state.currentStartedAt < NOTIFICATION_TOAST_TTL_MS) {
    return { state, toast: formatNotificationToast(state.current) };
  }

  const [nextCurrent, ...rest] = state.queue;
  if (!nextCurrent) {
    return { state: createNotificationQueueState(), toast: null };
  }

  const advanced: NotificationQueueState = {
    current: nextCurrent,
    currentStartedAt: now,
    queue: rest,
  };
  return { state: advanced, toast: formatNotificationToast(nextCurrent) };
}

export function toastForQueueState(state: NotificationQueueState): string | null {
  return state.current ? formatNotificationToast(state.current) : null;
}

export type SyncNotificationQueueInput = {
  readonly state: NotificationQueueState;
  readonly active: readonly ActiveNotification[];
  readonly seenKeys: ReadonlySet<string>;
  readonly now: number;
};

export type SyncNotificationQueueResult = {
  readonly state: NotificationQueueState;
  readonly seenKeys: ReadonlySet<string>;
  readonly toast: string | null;
  readonly currentPriority: NotificationPriority | null;
};

export function syncNotificationQueueFromActive(
  input: SyncNotificationQueueInput,
): SyncNotificationQueueResult {
  const seenKeys = new Set(input.active.map((item) => item.dedupKey));
  const arrivals = input.active.filter((item) => !input.seenKeys.has(item.dedupKey));
  const enqueueInputs: EnqueueInput[] = arrivals.map((item) => ({
    dedupKey: item.dedupKey,
    kind: item.kind,
    title: item.title,
    invalidates:
      item.kind === "download-complete"
        ? input.active
            .filter((other) => other.kind === "download-failed" && other.title === item.title)
            .map((other) => other.dedupKey)
        : undefined,
    fold: (existing, incoming) => ({
      title: incoming.title,
      kind: incoming.kind,
      priority: existing.priority,
    }),
  }));

  let state = enqueueNotificationItems(input.state, enqueueInputs, input.now);
  const ticked = tickNotificationQueue(state, input.now);
  state = ticked.state;

  return {
    state,
    seenKeys,
    toast: ticked.toast,
    currentPriority: state.current?.priority ?? null,
  };
}
