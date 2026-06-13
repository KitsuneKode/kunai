/**
 * Bridge between the `{ type: "queue" }` overlay (rendered by root-overlay-shell)
 * and the workflow that opened it. Reorder / remove / clear / restore happen
 * inside the overlay against `QueueService` directly; only `play` (start the
 * selected entry) leaves the overlay and resolves this bridge. Mirrors
 * root-history-bridge.ts.
 */

export type RootQueueSelection = {
  readonly kind: "play";
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: string;
  readonly season?: number;
  readonly episode?: number;
};

type QueueResolver = (value: RootQueueSelection | null) => void;

let pendingResolver: QueueResolver | null = null;

export function waitForRootQueueSelection(): Promise<RootQueueSelection | null> {
  return new Promise<RootQueueSelection | null>((resolve) => {
    pendingResolver = resolve;
  });
}

export function resolveRootQueueSelection(value: RootQueueSelection | null): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(value);
}

export function hasPendingRootQueueSelection(): boolean {
  return pendingResolver !== null;
}
