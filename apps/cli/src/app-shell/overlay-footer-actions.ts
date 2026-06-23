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

const COMMANDS_ACTION: FooterAction = { key: "/", label: "commands", action: "command-mode" };
const CLOSE_ACTION: FooterAction = { key: "esc", label: "close", action: "quit" };

function withTail(actions: readonly FooterAction[]): readonly FooterAction[] {
  return [...actions, COMMANDS_ACTION, CLOSE_ACTION];
}

export function queueFooterActions(): readonly FooterAction[] {
  return withTail([
    { key: "enter", label: "play", primary: true },
    { key: "j/k", label: "reorder" },
    { key: "x", label: "remove" },
    { key: "c", label: "clear" },
    { key: "r", label: "restore" },
  ]);
}

export function historyFooterActions(): readonly FooterAction[] {
  return withTail([
    { key: "enter", label: "resume", primary: true },
    { key: "q", label: "queue" },
    { key: "tab", label: "filter" },
  ]);
}

export function notificationsFooterActions(): readonly FooterAction[] {
  return withTail([
    { key: "enter", label: "action", primary: true },
    { key: "r", label: "read" },
    { key: "x", label: "archive" },
    { key: "d", label: "delete" },
    { key: "tab", label: "switch" },
  ]);
}
