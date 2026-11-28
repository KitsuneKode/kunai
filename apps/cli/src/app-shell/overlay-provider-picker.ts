import type { Container } from "@/container";

import { companionMode, companionToggleable } from "./companion-policy";
import type { ProviderPickerSources } from "./provider-picker-status";
import { emptySafeFooterActions, selectFooterActions } from "./shell-primitives";
import type { FooterAction, ShellPickerOption } from "./types";

/** Below this width the row state shrinks to its one- or two-word form. */
const COMPACT_COLUMNS = 72;

/**
 * The three stores a picker row is read from: global provider health, observed
 * endpoint quarantine, and the failure streak on the title in hand. Quarantine
 * is counted once here, not once per row.
 */
export function providerPickerSources(
  container: Pick<Container, "providerHealth" | "endpointHealth" | "titleProviderHealth">,
  titleId: string | undefined,
  columns = Number.POSITIVE_INFINITY,
): ProviderPickerSources & { readonly compact: boolean } {
  const quarantined = container.endpointHealth.countQuarantinedByProvider();
  return {
    getProviderHealth: (providerId) => container.providerHealth.get(providerId),
    getQuarantinedEndpoints: (providerId) => quarantined.get(providerId) ?? 0,
    getTitleFailure: (providerId) =>
      titleId ? container.titleProviderHealth.getFailure(titleId, providerId) : null,
    compact: columns < COMPACT_COLUMNS,
  };
}

/**
 * The same rows for the list shell (the picker offered while a stream is still
 * resolving). That shell draws a label and a detail and no trailing badge, so
 * the state leads the detail there instead of being dropped.
 */
export function providerOptionsForListShell(
  options: readonly ShellPickerOption<string>[],
): readonly ShellPickerOption<string>[] {
  return options.map((option) => ({
    ...option,
    detail: [option.badge, option.detail].filter(Boolean).join("  ·  "),
  }));
}

/**
 * Every key the picker answers to, as footer chips. With a filter typed, Esc
 * clears it before it closes anything, and the chip says so. With no row to
 * act on, the row keys go: a chip for a key that does nothing is a lie.
 */
function providerPickerFooterActions(
  filtering: boolean,
  hasRows: boolean,
): readonly FooterAction[] {
  return emptySafeFooterActions(
    [
      {
        key: "↑↓",
        label: "select",
        action: "details",
        requiresSelection: true,
        narrowEssential: true,
      },
      { key: "enter", label: "switch", action: "details", primary: true, requiresSelection: true },
      { key: "/", label: "commands", action: "command-mode" },
      { key: "esc", label: filtering ? "show all" : "close", action: "quit" },
    ],
    hasRows,
  );
}

/** How a chip's key reads once it is a word in a sentence instead of a chip. */
const KEY_NAMES = new Map([
  ["esc", "Esc"],
  ["enter", "Enter"],
]);

export type ProviderPickerFooter = {
  readonly taskLabel: string;
  readonly actions: readonly FooterAction[];
};

/**
 * The chips the footer will drop at this width. The footer budgets its row by
 * terminal width and pins the pet-restore hint inside that budget, so this asks
 * the same selector the same question instead of guessing at its thresholds.
 */
function droppedFooterActions(
  actions: readonly FooterAction[],
  columns: number,
): readonly FooterAction[] {
  const petHintPinned = companionMode() === "off" && companionToggleable();
  const offered: readonly FooterAction[] = petHintPinned
    ? [...actions, { key: "/pet", label: "kanna", action: "pet" }]
    : actions;
  const shown = selectFooterActions(offered, "detailed", columns);
  return actions.filter((action) => !shown.includes(action));
}

/**
 * The picker's whole footer. The text line is the highlighted provider's state
 * as a sentence; a key the chip row had to drop is named first, so it is never
 * truncated away and no key the picker answers to goes unadvertised at any width.
 */
export function providerPickerFooter(
  options: readonly ShellPickerOption<string>[],
  selectedIndex: number,
  filterQuery: string,
  columns: number,
): ProviderPickerFooter {
  const filter = filterQuery.trim();
  const actions = providerPickerFooterActions(filter.length > 0, options.length > 0);
  const highlighted = options[Math.min(selectedIndex, options.length - 1)];
  const story =
    highlighted?.previewBody ??
    highlighted?.label ??
    (filter ? `No provider matches “${filter}”` : "No providers in this lane");
  const dropped = droppedFooterActions(actions, columns).map(
    (action) => `${KEY_NAMES.get(action.key) ?? action.key} ${action.label}`,
  );
  return { taskLabel: [...dropped, story].join(" · "), actions };
}
