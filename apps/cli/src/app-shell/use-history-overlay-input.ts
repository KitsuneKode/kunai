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
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import {
  hasDualContinueSources,
  resolveContinueSourceAction,
  type ContinueSourcePreference,
} from "@/services/continuation/continuation-source";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";

export type HistoryOverlayInputContext = {
  readonly container: Container;
  readonly historyView: {
    readonly flatRows: readonly {
      readonly titleId: string;
      readonly dualSourceAvailable: boolean;
    }[];
  };
  readonly historySelections: readonly RootHistorySelection[];
  readonly historyPickerContext: HistoryPickerOptionsContext;
  readonly selectedIndex: number;
  readonly sourceChoiceTitleId: string | null;
  readonly sourcePreference: ContinueSourcePreference;
  readonly setSourceChoiceTitleId: (titleId: string | null) => void;
  readonly setHistoryTypeFilter: (update: (prev: HistoryTypeFilter) => HistoryTypeFilter) => void;
  readonly setHistoryTab: (update: (prev: HistoryTab) => HistoryTab) => void;
  readonly setSelectedIndex: (update: (current: number) => number) => void;
  readonly setOverlayStatus: (status: string | null) => void;
  readonly onRedraw: () => void;
  readonly onConfirmSelection: (
    selection: RootHistorySelection | null,
    options?: { readonly sourceOverride?: "local" | "stream" },
  ) => void;
};

export type HistoryOverlayInputResult = "handled" | "not-handled";

/** History overlay key map extracted from root-overlay-shell (Phase 9). */
export function handleHistoryOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: HistoryOverlayInputContext,
): HistoryOverlayInputResult {
  const picked = ctx.historyView.flatRows[ctx.selectedIndex]?.titleId ?? null;
  const selected = ctx.historySelections.find((entry) => entry.titleId === picked) ?? null;
  const projection = picked
    ? (ctx.historyPickerContext.projections?.get(picked) as ContinuationProjection | undefined)
    : undefined;

  if (ctx.sourceChoiceTitleId && picked === ctx.sourceChoiceTitleId && selected) {
    if (input.toLowerCase() === "l") {
      ctx.setSourceChoiceTitleId(null);
      ctx.setOverlayStatus(null);
      ctx.onConfirmSelection(
        buildRootHistorySelection(
          selected,
          ctx.historyPickerContext.nextReleases,
          ctx.historyPickerContext.projections,
          { sourcePreference: ctx.sourcePreference, sourceOverride: "local" },
        ),
        { sourceOverride: "local" },
      );
      return "handled";
    }
    if (input.toLowerCase() === "s") {
      ctx.setSourceChoiceTitleId(null);
      ctx.setOverlayStatus(null);
      ctx.onConfirmSelection(
        buildRootHistorySelection(
          selected,
          ctx.historyPickerContext.nextReleases,
          ctx.historyPickerContext.projections,
          { sourcePreference: ctx.sourcePreference, sourceOverride: "stream" },
        ),
        { sourceOverride: "stream" },
      );
      return "handled";
    }
  }

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
        .then((result) => {
          ctx.setOverlayStatus(
            result.status === "unsupported" ? result.reason : "Queued from history",
          );
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
  if (key.return && selected) {
    const dualSource = hasDualContinueSources(projection);
    if (ctx.sourcePreference === "ask" && dualSource && ctx.sourceChoiceTitleId !== picked) {
      ctx.setSourceChoiceTitleId(picked);
      ctx.setOverlayStatus("Choose source: l local, s stream, Esc cancel");
      return "handled";
    }
    const action = resolveContinueSourceAction(projection, ctx.sourcePreference);
    if (ctx.sourcePreference === "ask" && dualSource && !action) {
      ctx.setSourceChoiceTitleId(picked);
      ctx.setOverlayStatus("Choose source: l local, s stream, Esc cancel");
      return "handled";
    }
    ctx.onConfirmSelection(
      buildRootHistorySelection(
        selected,
        ctx.historyPickerContext.nextReleases,
        ctx.historyPickerContext.projections,
        { sourcePreference: ctx.sourcePreference },
      ),
    );
    return "handled";
  }
  if (
    !key.return &&
    (input.toLowerCase() === "l" || input.toLowerCase() === "s") &&
    selected &&
    ctx.historyView.flatRows[ctx.selectedIndex]?.dualSourceAvailable
  ) {
    const sourceOverride = input.toLowerCase() === "l" ? "local" : "stream";
    ctx.onConfirmSelection(
      buildRootHistorySelection(
        selected,
        ctx.historyPickerContext.nextReleases,
        ctx.historyPickerContext.projections,
        {
          sourcePreference: ctx.sourcePreference,
          sourceOverride,
        },
      ),
      { sourceOverride },
    );
    return "handled";
  }
  return "not-handled";
}
