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

/**
 * Standard `/ commands` + `esc close` tail without any surface bindings —
 * `ids: []` selects nothing but still builds the tail.
 */
function footerTail(
  scope: "history" | "library" | "queue" | "notifications",
): readonly FooterAction[] {
  return buildFooterActionsFromBindings(scope, { ids: [] });
}

export function historyFooterActions(input?: {
  readonly listFocused?: boolean;
}): readonly FooterAction[] {
  // Text zone: q/m/w/x are filter characters, not actions — the footer names
  // the keys that are actually live (Enter, arrows, Tab cycling) plus how to
  // reach the action keys, instead of advertising letters that would type.
  if (!input?.listFocused) {
    return [
      { key: "↵", label: "resume", primary: true },
      { key: "↑↓", label: "list actions" },
      { key: "Tab·⇧Tab", label: "tabs" },
      { key: "←→", label: "filter" },
      ...footerTail("history"),
    ];
  }
  return buildFooterActionsFromBindings("history", {
    ids: ["history-resume", "history-menu", "history-queue", "history-tab"],
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

export function downloadQueueFooterActions(input: {
  readonly hasJobs: boolean;
}): readonly FooterAction[] {
  if (!input.hasJobs) {
    // Empty queue: don't advertise play/remove from the Up Next binding set.
    return [];
  }
  // Display-only — DownloadManagerContent owns the real key loop.
  return [
    { key: "↵", label: "play done", primary: true },
    { key: "r", label: "retry" },
    { key: "x", label: "remove" },
    { key: "a", label: "repair" },
  ];
}

export function libraryFooterActions(input?: {
  readonly listFocused?: boolean;
}): readonly FooterAction[] {
  // Text zone: x/p are filter characters, not actions. Advertise the zone
  // switch instead of keys that would type a letter into the filter.
  if (!input?.listFocused) {
    return [
      { key: "↵", label: "open", primary: true },
      { key: "↑↓", label: "list actions" },
      { key: "⇥", label: "downloads" },
      ...footerTail("library"),
    ];
  }
  return buildFooterActionsFromBindings("library", {
    ids: ["library-open", "library-delete", "library-protect", "library-tab"],
    overrides: {
      "library-open": { primary: true },
    },
  });
}
