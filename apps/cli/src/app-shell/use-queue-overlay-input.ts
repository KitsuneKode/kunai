import type { LineEditorKey } from "@/app-shell/line-editor";
import type { QueueView, QueueViewRow } from "@/app-shell/queue-view";

/**
 * Queue overlay key map extracted from root-overlay-shell so the routing
 * decision is testable without mounting Ink — same shape as
 * use-history-overlay-input / use-notifications-overlay-input.
 *
 * The queue surface has no filter field, so every letter is an action key.
 * The destructive ones (`x` remove, `c` clear, `C` clear-played) run through
 * the shared press-again confirm: first press arms and renders the affordance,
 * a matching second press inside the window fires, any other key cancels.
 */
export type QueueOverlayInputContext = {
  readonly rows: readonly QueueViewRow[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (update: (current: number) => number) => void;
  readonly refresh: () => void;
  readonly queueService: QueueKeyService;
  /** Claim-and-play handoff for the highlighted row (Enter). */
  readonly onPlayRow: (row: QueueViewRow) => void;
  /** `r` session restore — the shell owns the recoverable-session dance. */
  readonly onRestore: () => void;
  /** Second matching press inside the confirm window → true and disarms. */
  readonly pressConfirm: (token: string) => boolean;
  /** Any non-confirm key drops an armed press-again. */
  readonly disarmConfirm: () => void;
  readonly pendingConfirmToken: string | null;
};

type QueueKeyService = {
  readonly moveDown: (id: string) => boolean;
  readonly moveUp: (id: string) => boolean;
  readonly moveToTop: (id: string) => void;
  readonly moveToBottom: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly clearPlayed: () => void;
  readonly clear: () => void;
};

const CLEAR_ALL_TOKEN = "queue:clear-all";
const CLEAR_PLAYED_TOKEN = "queue:clear-played";
const REMOVE_PREFIX = "queue:remove:";

/** True when the keystroke could advance an armed queue confirm. */
function isQueueConfirmTrigger(input: string): boolean {
  return input.toLowerCase() === "x" || input === "c" || input === "C";
}

export type QueueOverlayInputResult = "handled" | "not-handled";

export function handleQueueOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: QueueOverlayInputContext,
): QueueOverlayInputResult {
  const rows = ctx.rows;
  const sel = rows.length === 0 ? -1 : Math.min(ctx.selectedIndex, rows.length - 1);
  const row = sel >= 0 ? rows[sel] : undefined;

  // Any key that cannot advance a confirm drops it — matching the "any other
  // key cancels" copy the prompt renders.
  if (ctx.pendingConfirmToken !== null && !isQueueConfirmTrigger(input)) {
    ctx.disarmConfirm();
  }

  if (key.return && row) {
    ctx.onPlayRow(row);
    return "handled";
  }
  if (input === "J" && row) {
    if (ctx.queueService.moveDown(row.id)) {
      ctx.setSelectedIndex((c) => Math.min(c + 1, rows.length - 1));
    }
    ctx.refresh();
    return "handled";
  }
  if (input === "K" && row) {
    if (ctx.queueService.moveUp(row.id)) {
      ctx.setSelectedIndex((c) => Math.max(c - 1, 0));
    }
    ctx.refresh();
    return "handled";
  }
  if (input === "g" && row) {
    ctx.queueService.moveToTop(row.id);
    ctx.refresh();
    return "handled";
  }
  if (input === "G" && row) {
    ctx.queueService.moveToBottom(row.id);
    ctx.refresh();
    return "handled";
  }
  if (input.toLowerCase() === "x" && !key.ctrl && !key.meta && row) {
    if (ctx.pressConfirm(`${REMOVE_PREFIX}${row.id}`)) {
      ctx.queueService.remove(row.id);
      ctx.setSelectedIndex((c) => Math.max(0, Math.min(c, rows.length - 2)));
      ctx.refresh();
    }
    return "handled";
  }
  if (input === "C") {
    if (ctx.pressConfirm(CLEAR_PLAYED_TOKEN)) {
      ctx.queueService.clearPlayed();
      ctx.setSelectedIndex(() => 0);
      ctx.refresh();
    }
    return "handled";
  }
  if (input === "c" && !key.ctrl) {
    if (ctx.pressConfirm(CLEAR_ALL_TOKEN)) {
      ctx.queueService.clear();
      ctx.setSelectedIndex(() => 0);
      ctx.refresh();
    }
    return "handled";
  }
  if (input.toLowerCase() === "r") {
    ctx.onRestore();
    return "handled";
  }
  // Arrows / ←→ preview nav fall through to the generic overlay handlers.
  return "not-handled";
}

/**
 * The affordance the queue footer renders while a destructive key is armed.
 * Returns null when nothing is pending so the normal label can show.
 */
export function queueConfirmPrompt(
  token: string | null,
  view: Pick<QueueView, "counts" | "rows">,
): string | null {
  if (token === null) return null;
  if (token === CLEAR_ALL_TOKEN) {
    return `Press c again to clear ${view.counts.total} items · any other key cancels`;
  }
  if (token === CLEAR_PLAYED_TOKEN) {
    const played = view.counts.total - view.counts.unplayed;
    return `Press C again to clear ${played} played · any other key cancels`;
  }
  if (token.startsWith(REMOVE_PREFIX)) {
    const row = view.rows.find((candidate) => candidate.id === token.slice(REMOVE_PREFIX.length));
    return `Press x again to remove ${row?.title ?? "this item"} · any other key cancels`;
  }
  return null;
}
