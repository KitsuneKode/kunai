import type { Container } from "@/container";
import type { TitleInfo } from "@/domain/types";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { isFinished } from "@/services/persistence/HistoryStore";

export type HistoryLaunchSelection = {
  readonly titleId: string;
  readonly entry: HistoryEntry;
};

export function selectContinueHistoryEntry(
  entries: Record<string, HistoryEntry>,
): HistoryLaunchSelection | null {
  const unfinished = Object.entries(entries)
    .filter(([, entry]) => !isFinished(entry))
    .sort(
      (a, b) =>
        (new Date(b[1].watchedAt).getTime() || 0) - (new Date(a[1].watchedAt).getTime() || 0),
    );
  const selected = unfinished[0];
  return selected ? { titleId: selected[0], entry: selected[1] } : null;
}

export function titleFromHistorySelection(selection: HistoryLaunchSelection): TitleInfo {
  return {
    id: selection.titleId,
    type: selection.entry.type,
    name: selection.entry.title,
  };
}

export function applyHistorySelectionProvider(
  container: Pick<Container, "providerRegistry" | "stateManager">,
  selection: HistoryLaunchSelection,
): void {
  const provider = container.providerRegistry.get(selection.entry.provider);
  if (provider) {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: provider.metadata.isAnimeProvider ? "anime" : "series",
      provider: provider.metadata.id,
    });
    return;
  }
  container.stateManager.dispatch({ type: "SET_PROVIDER", provider: selection.entry.provider });
}
