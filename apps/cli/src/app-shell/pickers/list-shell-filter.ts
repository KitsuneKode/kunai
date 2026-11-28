import type { ListShellFilterPreference, ShellOption } from "./list-shell-types";

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

/** Stable row identity. A blank id is not an identity, so it cannot collide with another row. */
export function listShellOptionKey<T>(option: ShellOption<T>): string | null {
  const id = option.id?.trim();
  if (id) return id;
  if (option.destructive) return null;
  return option.label;
}

export function resolveArmedListOption<T>(
  options: readonly ShellOption<T>[],
  targetId: string | undefined,
):
  | { readonly kind: "one"; readonly option: ShellOption<T> }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous" } {
  if (!targetId) return { kind: "ambiguous" };
  const matches = options.filter((option) => listShellOptionKey(option) === targetId);
  const only = matches[0];
  if (matches.length === 1 && only) return { kind: "one", option: only };
  if (matches.length === 0) return { kind: "missing" };
  return { kind: "ambiguous" };
}
