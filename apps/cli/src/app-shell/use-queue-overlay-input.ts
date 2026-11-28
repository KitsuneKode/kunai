import type { LineEditorKey } from "@/app-shell/line-editor";
import { confirmStripKeyDecision } from "@/app-shell/primitives/ConfirmStrip.model";
import type { ConfirmStripController } from "@/app-shell/primitives/use-confirm-strip";
import { buildQueueRestoreDeps, buildQueueRestoreStatus } from "@/app-shell/queue-restore";
import type { QueueViewRow } from "@/app-shell/queue-view";
import type { Container } from "@/container";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";

export type QueueOverlayInputContext = {
  readonly container: Container;
  readonly rows: readonly QueueViewRow[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (update: (current: number) => number) => void;
  readonly setOverlayStatus: (status: string | null) => void;
  readonly refresh: () => void;
  readonly confirm: ConfirmStripController;
  readonly confirmationVisibleIds: readonly string[];
  readonly activateRow: (row: QueueViewRow) => void;
};

export type QueueOverlayInputResult = "handled" | "not-handled";

function reorder(
  ctx: QueueOverlayInputContext,
  row: QueueViewRow,
  move: () => boolean | void,
  selection?: (current: number) => number,
): void {
  const undoBefore = ctx.container.sessionUndo?.captureQueue();
  ctx.confirm.transition({ type: "cancel" });
  if (move() && selection) ctx.setSelectedIndex(selection);
  ctx.container.sessionUndo?.recordQueueChange(
    "reordered queue",
    "queue reorder",
    undoBefore ?? [],
  );
  ctx.refresh();
}

function executeQueueConfirmation(
  ctx: QueueOverlayInputContext,
  effect: { readonly targetId: string; readonly label: string },
): void {
  try {
    const undoBefore = ctx.container.sessionUndo?.captureQueue();
    if (effect.targetId.startsWith("remove:")) {
      const id = effect.targetId.slice("remove:".length);
      if (!ctx.container.queueService.getAll().some((entry) => entry.id === id)) {
        throw new Error("Queue item is already gone");
      }
      ctx.container.queueService.remove(id);
      ctx.container.sessionUndo?.recordQueueChange(
        "removed from queue",
        "queue remove",
        undoBefore ?? [],
      );
      ctx.setSelectedIndex((c) => Math.max(0, Math.min(c, ctx.rows.length - 2)));
      ctx.setOverlayStatus(`Removed ${effect.label} from Up Next`);
    } else if (effect.targetId === "clear-played") {
      const playedCount = ctx.rows.filter((candidate) => candidate.state === "played").length;
      ctx.container.queueService.clearPlayed();
      ctx.container.sessionUndo?.recordQueueChange(
        "cleared played items",
        "played clear",
        undoBefore ?? [],
      );
      ctx.setSelectedIndex(() => 0);
      ctx.setOverlayStatus(`Cleared ${playedCount} played ${playedCount === 1 ? "item" : "items"}`);
    } else {
      const cleared = ctx.rows.length;
      ctx.container.queueService.clear();
      ctx.container.sessionUndo?.recordQueueChange(
        "cleared queue",
        "queue clear",
        undoBefore ?? [],
      );
      ctx.setSelectedIndex(() => 0);
      ctx.setOverlayStatus(`Cleared ${cleared} ${cleared === 1 ? "item" : "items"} from Up Next`);
    }
    ctx.confirm.transition({ type: "succeed" });
    ctx.refresh();
  } catch (error) {
    ctx.confirm.transition({
      type: "fail",
      message: error instanceof Error ? error.message : "Unable to update Up Next",
    });
  }
}

/** Queue-management keys. Navigation and type-to-filter intentionally fall through to the generic overlay handlers. */
export function handleQueueOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: QueueOverlayInputContext,
): QueueOverlayInputResult {
  const rows = ctx.rows;
  const sel = rows.length === 0 ? -1 : Math.min(ctx.selectedIndex, rows.length - 1);
  const row = sel >= 0 ? rows[sel] : undefined;

  const confirmState = ctx.confirm.getState();
  const confirmDecision = confirmStripKeyDecision(confirmState.kind, input, key, {
    continueOnVerticalArrows: true,
  });
  if (confirmDecision === "execute") {
    const confirmation = ctx.confirm.transition({ type: "confirm" });
    if (confirmation.effect) executeQueueConfirmation(ctx, confirmation.effect);
    return "handled";
  }
  if (confirmDecision === "cancel") {
    ctx.confirm.transition({ type: "cancel" });
    return "handled";
  }
  if (confirmDecision === "cancel-and-continue") {
    ctx.confirm.transition({ type: "cancel" });
    return "not-handled";
  }
  if (confirmDecision === "hold") return "handled";

  if (key.return && row) {
    ctx.activateRow(row);
    return "handled";
  }
  if (input === "J" && row) {
    reorder(
      ctx,
      row,
      () => ctx.container.queueService.moveDown(row.id),
      (c) => Math.min(c + 1, rows.length - 1),
    );
    return "handled";
  }
  if (input === "K" && row) {
    reorder(
      ctx,
      row,
      () => ctx.container.queueService.moveUp(row.id),
      (c) => Math.max(c - 1, 0),
    );
    return "handled";
  }
  if (input === "g" && row) {
    reorder(ctx, row, () => ctx.container.queueService.moveToTop(row.id));
    return "handled";
  }
  if (input === "G" && row) {
    reorder(ctx, row, () => ctx.container.queueService.moveToBottom(row.id));
    return "handled";
  }
  if (input.toLowerCase() === "x" && row) {
    ctx.confirm.transition({
      type: "arm",
      targetId: `remove:${row.id}`,
      label: row.title,
      verb: "remove",
      executingLabel: `Removing ${row.title} from Up Next`,
      visibleIds: ctx.confirmationVisibleIds,
    });
    return "handled";
  }
  if (input === "C") {
    const playedCount = rows.filter((candidate) => candidate.state === "played").length;
    if (playedCount === 0) {
      ctx.confirm.transition({ type: "cancel" });
      ctx.setOverlayStatus("No played items to clear");
      return "handled";
    }
    ctx.confirm.transition({
      type: "arm",
      targetId: "clear-played",
      label: `${playedCount} played ${playedCount === 1 ? "item" : "items"}`,
      verb: "clear",
      executingLabel: "Clearing played items",
      visibleIds: ctx.confirmationVisibleIds,
    });
    return "handled";
  }
  if (input === "c" && !key.ctrl) {
    if (rows.length === 0) {
      ctx.confirm.transition({ type: "cancel" });
      ctx.setOverlayStatus("Up Next is already empty");
      return "handled";
    }
    ctx.confirm.transition({
      type: "arm",
      targetId: "clear-all",
      label: `all ${rows.length} ${rows.length === 1 ? "item" : "items"}`,
      verb: "clear",
      executingLabel: "Clearing Up Next",
      visibleIds: ctx.confirmationVisibleIds,
    });
    return "handled";
  }
  if (input === "z" && ctx.container.sessionUndo?.hasLiveUndo()) {
    ctx.container.sessionUndo.undoLatest();
    ctx.refresh();
    return "handled";
  }
  if (input.toLowerCase() === "r") {
    ctx.confirm.transition({ type: "cancel" });
    const sessions = ctx.container.queueService.listRecoverableSessions();
    const session = sessions[0];
    if (!session) {
      ctx.setOverlayStatus("No recoverable queue to restore");
      return "handled";
    }
    const restored = restoreQueueSessionWithResume(
      buildQueueRestoreDeps(ctx.container),
      session.id,
    );
    ctx.setOverlayStatus(buildQueueRestoreStatus(restored, sessions.length));
    ctx.refresh();
    return "handled";
  }
  return "not-handled";
}
