import { cycleHistoryTab, cycleHistoryTypeFilter, type HistoryTab } from "@/app-shell/history-view";
import type { HistoryTypeFilter } from "@/app-shell/history-view";
import type { LineEditorKey } from "@/app-shell/line-editor";
import type { HistoryPickerOptionsContext } from "@/app-shell/panel-data";
import {
  buildRootHistorySelection,
  type RootHistorySelection,
} from "@/app-shell/root-history-bridge";
import type { Container } from "@/container";
import { mediaItemFromHistoryEntry } from "@/domain/media/media-item-adapters";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";

export type HistoryOverlayInputContext = {
  readonly container: Container;
  readonly historyView: { readonly flatRows: readonly { readonly titleId: string }[] };
  readonly historySelections: readonly RootHistorySelection[];
  readonly historyPickerContext: HistoryPickerOptionsContext;
  readonly selectedIndex: number;
  readonly setHistoryTypeFilter: (update: (prev: HistoryTypeFilter) => HistoryTypeFilter) => void;
  readonly setHistoryTab: (update: (prev: HistoryTab) => HistoryTab) => void;
  readonly setSelectedIndex: (update: (current: number) => number) => void;
  readonly setOverlayStatus: (status: string) => void;
  readonly onRedraw: () => void;
};

export type HistoryOverlayInputResult = "handled" | "not-handled";

/** History overlay key map extracted from root-overlay-shell (Phase 9). */
export function handleHistoryOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: HistoryOverlayInputContext,
): HistoryOverlayInputResult {
  if (key.tab && key.shift) {
    ctx.setHistoryTypeFilter((prev) => cycleHistoryTypeFilter(prev));
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }
  if (key.tab) {
    ctx.setHistoryTab((prev) => cycleHistoryTab(prev));
    return "handled";
  }
  if (input.toLowerCase() === "q") {
    const picked = ctx.historyView.flatRows[ctx.selectedIndex]?.titleId ?? null;
    const selected = ctx.historySelections.find((entry) => entry.titleId === picked) ?? null;
    if (selected) {
      const historySelection = buildRootHistorySelection(
        selected,
        ctx.historyPickerContext.nextReleases,
        ctx.historyPickerContext.projections,
      );
      const queueEntry = historySelection.targetEpisode
        ? {
            ...historySelection.entry,
            season: historySelection.targetEpisode.season,
            episode: historySelection.targetEpisode.episode,
            positionSeconds:
              historySelection.targetEpisode.reason === "resume"
                ? historySelection.entry.positionSeconds
                : 0,
            completed:
              historySelection.targetEpisode.reason === "resume"
                ? historySelection.entry.completed
                : false,
          }
        : historySelection.entry;
      void createContainerMediaActionRouter(ctx.container)
        .run({
          actionId: "queue-end",
          item: mediaItemFromHistoryEntry(historySelection.titleId, queueEntry),
          source: "history",
        })
        .then(() => {
          ctx.setOverlayStatus("Queued from history");
          ctx.onRedraw();
          return undefined;
        })
        .catch((error: unknown) => {
          ctx.setOverlayStatus(
            error instanceof Error ? error.message : "Unable to queue from history",
          );
          ctx.onRedraw();
          return undefined;
        });
    }
    return "handled";
  }
  return "not-handled";
}
