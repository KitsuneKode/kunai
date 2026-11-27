import { buildFooterActionsFromBindings } from "./keybindings";
import type { NotificationsTab } from "./notifications-view";
import { emptySafeFooterActions } from "./shell-primitives";
import type { FooterAction } from "./types";

/**
 * Display-only footer hint rows for overlays whose keys are handled by their own
 * input loop (queue/history/notifications). These render through `ShellFooter`'s
 * structured `actions` line so each surface shows the real binding hierarchy
 * (role colors, width capping, "commands" + "close" tail) instead of cramming a
 * long pseudo-syntax sentence into the single-line `taskLabel`.
 *
 * Ordering matters: `selectFooterActions` caps the visible non-command actions by
 * width, so the highest-value bindings come first. The shared `/ commands` and
 * `esc close` tail is always appended so deeper actions stay discoverable.
 */

type EmptyableFooterInput = {
  /** False on a zero-row surface; row-scoped hints are removed by the shared helper. */
  readonly hasRows?: boolean;
};

const rowsPresent = (input: EmptyableFooterInput | undefined) => input?.hasRows ?? true;

function withSelectionRequired(
  actions: readonly FooterAction[],
  labels: readonly string[],
): readonly FooterAction[] {
  const required = new Set(labels);
  return actions.map((action) =>
    required.has(action.label) ? { ...action, requiresSelection: true } : action,
  );
}

export function queueFooterActions(input?: EmptyableFooterInput): readonly FooterAction[] {
  const actions = buildFooterActionsFromBindings("queue", {
    ids: ["queue-play", "queue-reorder", "queue-remove", "queue-clear", "queue-restore"],
    overrides: {
      "queue-play": { primary: true },
    },
  });
  return emptySafeFooterActions(
    withSelectionRequired(actions, ["play", "reorder", "remove", "clear", "restore"]),
    rowsPresent(input),
  );
}

export function historyFooterActions(input?: EmptyableFooterInput): readonly FooterAction[] {
  const actions = buildFooterActionsFromBindings("history", {
    ids: ["history-resume", "history-menu", "history-queue", "history-tab"],
    overrides: {
      "history-resume": { primary: true },
    },
  });
  return emptySafeFooterActions(
    withSelectionRequired(actions, ["resume", "actions", "up next"]),
    rowsPresent(input),
  );
}

export function notificationsFooterActions(
  input: {
    readonly tab: NotificationsTab;
    readonly paginated: boolean;
  },
  hasRows = true,
): readonly FooterAction[] {
  // Lifecycle keys (r/x/d/A/C) stay in command help only; the persistent footer
  // carries the navigation grammar: act, actions, sort, tab, optional paging.
  const ids = [
    "notifications-action",
    "notifications-all-actions",
    "notifications-sort",
    "notifications-tab",
    ...(input.paginated ? ["notifications-page"] : []),
  ];
  const actions = buildFooterActionsFromBindings("notifications", {
    ids,
    overrides: {
      "notifications-action": { label: "act", primary: true },
      "notifications-tab": { label: input.tab === "active" ? "archive" : "active" },
    },
  });
  return emptySafeFooterActions(withSelectionRequired(actions, ["act", "actions"]), hasRows);
}

export function downloadQueueFooterActions(input: {
  readonly hasJobs: boolean;
}): readonly FooterAction[] {
  // Display-only — DownloadManagerContent owns the real key loop.
  return emptySafeFooterActions(
    [
      { key: "↵", label: "play done", primary: true, requiresSelection: true },
      { key: "r", label: "retry", requiresSelection: true },
      { key: "x", label: "remove", requiresSelection: true },
      { key: "a", label: "repair", requiresSelection: true },
      { key: "/", label: "commands", action: "command-mode" },
      { key: "esc", label: "close", action: "quit" },
    ],
    input.hasJobs,
  );
}

export function libraryFooterActions(input?: EmptyableFooterInput): readonly FooterAction[] {
  const actions = buildFooterActionsFromBindings("library", {
    ids: ["library-open", "library-delete", "library-protect", "library-tab"],
    overrides: {
      "library-open": { primary: true },
    },
  });
  return emptySafeFooterActions(
    withSelectionRequired(actions, ["open", "delete", "protect"]),
    rowsPresent(input),
  );
}

export function tracksFooterActions(input: {
  readonly hasSwitchable: boolean;
  readonly sourceSectionActive: boolean;
}): readonly FooterAction[] {
  // Tracks owns nested section/options focus. The pane binding is persistent
  // even though only one direction is meaningful at a time, because the footer
  // is also the focus cue users look for after ←/→ apparently "stops" rows.
  return [
    { key: "↑↓", label: "choose", action: "details" },
    { key: "←→", label: "pane", action: "details" },
    ...(input.hasSwitchable
      ? [{ key: "enter", label: "switch", action: "details" as const, primary: true }]
      : []),
    ...(input.sourceSectionActive
      ? [{ key: "f", label: "favorite", action: "details" as const }]
      : []),
    { key: "/", label: "commands", action: "command-mode" },
    { key: "esc", label: "back", action: "quit" },
  ];
}
