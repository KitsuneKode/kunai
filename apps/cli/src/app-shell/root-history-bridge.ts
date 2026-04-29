import type { HistoryEntry } from "@/services/persistence/HistoryStore";

export type RootHistorySelection = {
  titleId: string;
  entry: HistoryEntry;
};

type HistoryResolver = (value: RootHistorySelection | null) => void;

let pendingResolver: HistoryResolver | null = null;

export function waitForRootHistorySelection(): Promise<RootHistorySelection | null> {
  return new Promise<RootHistorySelection | null>((resolve) => {
    pendingResolver = resolve;
  });
}

export function resolveRootHistorySelection(value: RootHistorySelection | null): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(value);
}

export function hasPendingRootHistorySelection(): boolean {
  return pendingResolver !== null;
}
