import type { ListShellFilterPreference } from "./list-shell-types";

export const COMPACT_LIST_FILTER_MAX_OPTIONS = 6;

/** Small fixed action lists are action dialogs, not searchable catalogs. */
export function shouldShowListFilter(
  preference: ListShellFilterPreference = "auto",
  optionCount: number,
): boolean {
  if (preference === "always") return true;
  if (preference === "never") return false;
  return optionCount > COMPACT_LIST_FILTER_MAX_OPTIONS;
}

/**
 * Compact rows keep positional number shortcuts. Letter accelerators are
 * explicit (`shortcut` on the row) so typing never activates a destructive row
 * merely because its label happens to start with that letter.
 */
export function resolveCompactListShortcut(
  input: string,
  options: readonly { readonly shortcut?: string }[],
): number | null {
  if (/^[1-9]$/u.test(input)) {
    const index = Number(input) - 1;
    return index < options.length ? index : null;
  }
  if (input.length !== 1) return null;
  const key = input.toLowerCase();
  const index = options.findIndex((option) => option.shortcut?.toLowerCase() === key);
  return index >= 0 ? index : null;
}
