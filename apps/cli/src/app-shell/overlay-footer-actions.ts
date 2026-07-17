import { buildFooterActionsFromBindings } from "./keybindings";
import type { NotificationsTab } from "./notifications-view";
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

export function queueFooterActions(): readonly FooterAction[] {
  return buildFooterActionsFromBindings("queue", {
    ids: ["queue-play", "queue-reorder", "queue-remove", "queue-clear", "queue-restore"],
    overrides: {
      "queue-play": { primary: true },
    },
  });
}

export function historyFooterActions(): readonly FooterAction[] {
  return buildFooterActionsFromBindings("history", {
    ids: ["history-resume", "history-queue", "history-tab"],
    overrides: {
      "history-resume": { primary: true },
    },
  });
}

export function notificationsFooterActions(input: {
  readonly tab: NotificationsTab;
  readonly paginated: boolean;
}): readonly FooterAction[] {
  // Lifecycle keys (r/x/d/A/C) stay in command help only; the persistent footer
  // carries the navigation grammar: act, actions, sort, tab, optional paging.
  const ids = [
    "notifications-action",
    "notifications-all-actions",
    "notifications-sort",
    "notifications-tab",
    ...(input.paginated ? ["notifications-page"] : []),
  ];
  return buildFooterActionsFromBindings("notifications", {
    ids,
    overrides: {
      "notifications-action": { label: "act", primary: true },
      "notifications-tab": { label: input.tab === "active" ? "archive" : "active" },
    },
  });
}

export function libraryFooterActions(): readonly FooterAction[] {
  return buildFooterActionsFromBindings("library", {
    ids: ["library-open", "library-delete", "library-protect", "library-tab"],
    overrides: {
      "library-open": { primary: true },
    },
  });
}
