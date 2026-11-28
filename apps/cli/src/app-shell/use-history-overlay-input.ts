import { cycleHistoryTab, cycleHistoryTypeFilter, type HistoryTab } from "@/app-shell/history-view";
import type { HistoryTypeFilter } from "@/app-shell/history-view";
import type { LineEditorKey } from "@/app-shell/line-editor";
import { routeListFilterKey } from "@/app-shell/list-filter-keys";
import type { HistoryPickerOptionsContext } from "@/app-shell/panel-data";
import {
  type ConfirmStripAction,
  type ConfirmStripState,
  type ConfirmStripTransition,
} from "@/app-shell/primitives/ConfirmStrip.model";
import {
  buildRootHistorySelection,
  type RootHistorySelection,
} from "@/app-shell/root-history-bridge";
import { titleFromHistorySelection } from "@/app/bootstrap/launch-entry";
import type { Container } from "@/container";
import type { MediaActionId } from "@/domain/media/media-action-policy";
import { mediaItemFromHistoryEntry } from "@/domain/media/media-item-adapters";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import {
  hasDualContinueSources,
  resolveContinueSourceAction,
  type ContinueSourcePreference,
} from "@/services/continuation/continuation-source";
import { historyEpisodeLabel, isFinished } from "@/services/continuation/history-progress";
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
  readonly confirmState: ConfirmStripState;
  readonly transitionConfirm: (action: ConfirmStripAction) => ConfirmStripTransition;
  /** Stable confirmation-target ids in the rows' current visible order. */
  readonly confirmationVisibleIds: readonly string[];
  readonly onHistoryMutated: () => void;
  /** The overlay's type-to-filter text, and whether the filter holds focus. */
  readonly filterQuery: string;
  readonly filterFocused: boolean;
  readonly setFilterFocused: (focused: boolean) => void;
  readonly onConfirmSelection: (
    selection: RootHistorySelection | null,
    options?: { readonly sourceOverride?: "local" | "stream" },
  ) => void;
};

export type HistoryOverlayInputResult = "handled" | "not-handled";

export type HistoryOverlayKeyOutcome =
  | "open-title-menu"
  | "toggle-watched"
  | "ignore"
  | "unhandled";

/**
 * Pure key routing for the history overlay, extracted so the decision can be
 * tested without mounting Ink.
 *
 * `m` opens title control here as it does on every other surface. The watched
 * toggle it displaced moved to `w`, which is both free and more mnemonic; the
 * old binding was never registered in `keybindings.ts`, so it appeared in no
 * help text and no footer.
 */
export function resolveHistoryOverlayKey(
  key: string,
  state: { readonly hasSelection: boolean },
): HistoryOverlayKeyOutcome {
  const normalized = key.toLowerCase();
  if (normalized === "m") return state.hasSelection ? "open-title-menu" : "ignore";
  if (normalized === "w") return state.hasSelection ? "toggle-watched" : "ignore";
  return "unhandled";
}

/**
 * What the overlay should do with an action picked from the title-control menu.
 *
 * The menu presents, but the shell's own handlers execute against the session's
 * current title — which over a history row is whatever is highlighted in the
 * list behind the overlay. So row-scoped actions are re-dispatched through
 * `MediaActionRouter` with the row's media item instead.
 */
export type HistoryRowIntent =
  | { readonly kind: "media-action"; readonly actionId: MediaActionId; readonly status: string }
  | { readonly kind: "resume" }
  | { readonly kind: "share" }
  | { readonly kind: "delegate" };

export function historyRowIntentForShellAction(action: string): HistoryRowIntent {
  switch (action) {
    case "download":
      return {
        kind: "media-action",
        actionId: "download",
        status: "Queued download from history",
      };
    case "mark-watched":
      return {
        kind: "media-action",
        actionId: "mark-watched",
        status: "Marked watched",
      };
    case "mark-unwatched":
      return {
        kind: "media-action",
        actionId: "mark-unwatched",
        status: "Marked unwatched (resume kept)",
      };
    case "resume":
      return { kind: "resume" };
    // `/share` shares the session's title; over a History row that is the
    // wrong one, so the row's own title and episode are shared instead.
    case "share":
      return { kind: "share" };
    default:
      // Session-scoped actions (diagnostics) are correct as the shell runs them.
      return { kind: "delegate" };
  }
}

function historyDeleteLabel(entry: RootHistorySelection["entry"]): string {
  const episode = historyEpisodeLabel(entry);
  return episode ? `${entry.title} · ${episode}` : entry.title;
}

/** Run a row-scoped action through the router and report the outcome inline. */
function runHistoryRowAction(
  ctx: HistoryOverlayInputContext,
  action: {
    readonly actionId: MediaActionId;
    readonly item: ReturnType<typeof mediaItemFromHistoryEntry>;
    readonly status: string;
    readonly failure: string;
  },
): void {
  void createContainerMediaActionRouter(ctx.container)
    .run({ actionId: action.actionId, item: action.item, source: "history" })
    .then((result) => {
      ctx.setOverlayStatus(result.status === "unsupported" ? result.reason : action.status);
      ctx.onRedraw();
      return undefined;
    })
    .catch((error: unknown) => {
      ctx.setOverlayStatus(error instanceof Error ? error.message : action.failure);
      ctx.onRedraw();
      return undefined;
    });
}

/**
 * Present title control for a history row and execute the choice against that
 * row. The menu is picked, not run: the shell's own handlers resolve the
 * session's current title, which over history is the wrong one.
 */
async function openHistoryTitleControlMenu(
  ctx: HistoryOverlayInputContext,
  selected: RootHistorySelection,
): Promise<void> {
  const { pickTitleControlShellAction } =
    await import("@/app-shell/title-control/open-title-control-menu");
  const entry = selected.entry;
  const shellAction = await pickTitleControlShellAction(ctx.container, "history", {
    titleName: entry.title,
    hasTitle: true,
    canResume: entry.positionSeconds > 0 && !isFinished(entry),
  });
  if (!shellAction) {
    ctx.onRedraw();
    return;
  }

  const intent = historyRowIntentForShellAction(shellAction);
  if (intent.kind === "resume") {
    ctx.onConfirmSelection(
      buildRootHistorySelection(
        selected,
        ctx.historyPickerContext.nextReleases,
        ctx.historyPickerContext.projections,
        { sourcePreference: ctx.sourcePreference },
      ),
    );
    return;
  }
  if (intent.kind === "share") {
    const { shareTarget } = await import("@/app-shell/workflows/share-workflow");
    const kind = entry.mediaKind;
    await shareTarget(ctx.container, {
      title: titleFromHistorySelection(selected),
      mode: kind === "anime" ? "anime" : kind === "video" ? "youtube" : "series",
      mediaKind: kind,
      episode:
        entry.season !== undefined && entry.episode !== undefined
          ? { season: entry.season, episode: entry.episode }
          : undefined,
      providerId: entry.providerId,
    });
    ctx.onRedraw();
    return;
  }
  if (intent.kind === "media-action") {
    runHistoryRowAction(ctx, {
      actionId: intent.actionId,
      item: mediaItemFromHistoryEntry(selected.titleId, entry),
      status: intent.status,
      failure: "Unable to complete that action",
    });
    return;
  }

  const { handleShellAction } = await import("@/app-shell/workflows");
  await handleShellAction({ action: shellAction, container: ctx.container });
  ctx.onRedraw();
}

/** History overlay key map extracted from root-overlay-shell (Phase 9). */
/** Row actions with no filter in progress; anything else typed starts the filter. */
const HISTORY_ACTION_KEYS: ReadonlySet<string> = new Set([
  "m",
  "M",
  "w",
  "W",
  "q",
  "Q",
  "x",
  "X",
  "l",
  "L",
  "s",
  "S",
  "z",
]);

/** The row the cursor is on, its stored selection and its continuation projection. */
function selectedHistoryRow(ctx: HistoryOverlayInputContext) {
  const picked = ctx.historyView.flatRows[ctx.selectedIndex]?.titleId ?? null;
  const selected = ctx.historySelections.find((entry) => entry.titleId === picked) ?? null;
  // SAFETY: the picker context stores projections keyed by the same title ids
  // History rows carry; a missing entry stays undefined.
  const projection = picked
    ? (ctx.historyPickerContext.projections?.get(picked) as ContinuationProjection | undefined)
    : undefined;
  return { picked, selected, projection };
}

/**
 * Play the selected History row: Enter, or a second tap on it. Asks for local
 * or stream first when both exist and the user asked to be asked.
 */
export function activateSelectedHistoryRow(ctx: HistoryOverlayInputContext): void {
  const { picked, selected, projection } = selectedHistoryRow(ctx);
  if (!selected) return;
  const dualSource = hasDualContinueSources(projection);
  if (ctx.sourcePreference === "ask" && dualSource && ctx.sourceChoiceTitleId !== picked) {
    ctx.setSourceChoiceTitleId(picked);
    ctx.setOverlayStatus("Choose source: l local, s stream, Esc cancel");
    return;
  }
  const action = resolveContinueSourceAction(projection, ctx.sourcePreference);
  if (ctx.sourcePreference === "ask" && dualSource && !action) {
    ctx.setSourceChoiceTitleId(picked);
    ctx.setOverlayStatus("Choose source: l local, s stream, Esc cancel");
    return;
  }
  ctx.onConfirmSelection(
    buildRootHistorySelection(
      selected,
      ctx.historyPickerContext.nextReleases,
      ctx.historyPickerContext.projections,
      { sourcePreference: ctx.sourcePreference },
    ),
  );
}

export function handleHistoryOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: HistoryOverlayInputContext,
): HistoryOverlayInputResult {
  const { picked, selected } = selectedHistoryRow(ctx);

  if (ctx.confirmState.kind !== "idle") {
    if (ctx.confirmState.kind === "executing") return "handled";
    if (key.escape) {
      ctx.transitionConfirm({ type: "cancel" });
      ctx.setOverlayStatus(null);
      return "handled";
    }
    if (ctx.confirmState.kind === "armed" && input.toLowerCase() === "y") {
      const confirmation = ctx.transitionConfirm({ type: "confirm" });
      if (!confirmation.effect) return "handled";
      const effect = confirmation.effect;
      const undoBefore = ctx.container.sessionUndo?.captureHistory();
      try {
        if (effect.targetId.startsWith("episode:")) {
          ctx.container.historyRepository.deleteProgressByKey(
            effect.targetId.slice("episode:".length),
          );
        } else {
          ctx.container.historyRepository.deleteTitle(effect.targetId.slice("title:".length));
        }
        if (undoBefore) {
          ctx.container.sessionUndo?.recordHistoryChange(
            effect.targetId.startsWith("episode:")
              ? "deleted episode progress"
              : "deleted title history",
            "history delete",
            undoBefore,
          );
        }
        ctx.transitionConfirm({ type: "succeed" });
        ctx.setOverlayStatus(
          effect.targetId.startsWith("episode:")
            ? `Removed episode progress for ${effect.label}`
            : `Removed all history for ${effect.label}`,
        );
        ctx.onHistoryMutated();
      } catch (error) {
        ctx.transitionConfirm({
          type: "fail",
          message: error instanceof Error ? error.message : "Unable to delete history",
        });
      }
      return "handled";
    }
    // Confirmation focus owns input. Arrow keys disarm rather than retargeting
    // another row; they do not also navigate in the same keypress.
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
      ctx.transitionConfirm({ type: "cancel" });
      return "handled";
    }
    return "handled";
  }

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

  // Delete is not filter text, so it can arm the same episode confirmation even
  // while a query is present; printable x stays text in that state.
  if (selected && key.delete) {
    ctx.transitionConfirm({
      type: "arm",
      targetId: `episode:${selected.entry.key}`,
      label: historyDeleteLabel(selected.entry),
      verb: "delete",
      executingLabel: `Removing episode progress for ${historyDeleteLabel(selected.entry)}`,
      visibleIds: ctx.confirmationVisibleIds,
    });
    ctx.setOverlayStatus(null);
    return "handled";
  }

  // While a filter is in progress every printable key is text: "demon" used to
  // open the title menu at `m`, "spy x" armed a delete at `x`.
  const filterRoute = routeListFilterKey(input, key, {
    focused: ctx.filterFocused,
    query: ctx.filterQuery,
    actionKeys: HISTORY_ACTION_KEYS,
  });
  if (filterRoute === "focus") {
    ctx.setFilterFocused(true);
    return "handled";
  }
  if (filterRoute === "append") {
    ctx.setFilterFocused(true);
    return "not-handled";
  }

  // `z` pops the live undo entry; with nothing to undo it stays unhandled and
  // falls through like any other unbound letter.
  if (input === "z" && !key.ctrl && !key.meta && ctx.container.sessionUndo?.hasLiveUndo()) {
    ctx.container.sessionUndo.undoLatest();
    return "handled";
  }

  if (key.tab) {
    // Tab forward, Shift+Tab reverse — same pattern as help/calendar tab cycling.
    ctx.setHistoryTab((prev) => cycleHistoryTab(prev, key.shift ? -1 : 1));
    return "handled";
  }
  if (key.leftArrow || key.rightArrow) {
    // ← reverse, → forward through the type filter axis.
    ctx.setHistoryTypeFilter((prev) => cycleHistoryTypeFilter(prev, key.leftArrow ? -1 : 1));
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }
  const keyOutcome = key.return
    ? "unhandled"
    : resolveHistoryOverlayKey(input, {
        hasSelection: Boolean(selected),
      });
  if (keyOutcome === "ignore") return "handled";
  if (keyOutcome === "toggle-watched" && selected) {
    const watched = isFinished(selected.entry);
    runHistoryRowAction(ctx, {
      actionId: watched ? "mark-unwatched" : "mark-watched",
      item: mediaItemFromHistoryEntry(selected.titleId, selected.entry),
      status: watched ? "Marked unwatched (resume kept)" : "Marked watched",
      failure: "Unable to update watch state",
    });
    return "handled";
  }
  if (keyOutcome === "open-title-menu" && selected) {
    void openHistoryTitleControlMenu(ctx, selected);
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
    activateSelectedHistoryRow(ctx);
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
  if (selected && input === "x" && !key.shift) {
    ctx.transitionConfirm({
      type: "arm",
      targetId: `episode:${selected.entry.key}`,
      label: historyDeleteLabel(selected.entry),
      verb: "delete",
      executingLabel: `Removing episode progress for ${historyDeleteLabel(selected.entry)}`,
      visibleIds: ctx.confirmationVisibleIds,
    });
    ctx.setOverlayStatus(null);
    return "handled";
  }
  if (selected && (input === "X" || input === "x") && key.shift) {
    ctx.transitionConfirm({
      type: "arm",
      targetId: `title:${selected.titleId}`,
      label: `all history for ${selected.entry.title}`,
      verb: "delete",
      executingLabel: `Removing all history for ${selected.entry.title}`,
      visibleIds: ctx.confirmationVisibleIds,
    });
    ctx.setOverlayStatus(null);
    return "handled";
  }
  return "not-handled";
}
