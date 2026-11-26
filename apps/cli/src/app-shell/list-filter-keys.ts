/**
 * Type-to-filter lists that also bind single letters to row actions.
 *
 * Library and History let you type to filter, and also bind `x` (delete),
 * `p` (protect), `m`/`w`/`q`/`l`/`s` to the highlighted row. Checked letter by
 * letter, a filter for "Spy x Family" armed a delete at `x`, and "demon"
 * opened the title menu at `m`. A filter is therefore a focus: once it holds
 * text, or Ctrl+F opened it, every printable key is text until Esc leaves it.
 * Only a key typed with nothing being filtered can be an action.
 */
export type ListFilterKeyRoute =
  /** Not a printable key: arrows, Enter, Tab, Esc and the rest stay with the caller. */
  | "not-text"
  /** Ctrl+F: open the filter, type nothing. `/` stays the command palette's. */
  | "focus"
  /** Text for the filter. */
  | "append"
  /** A row action: no filter is in progress and the key is one of the list's. */
  | "action";

export function routeListFilterKey(
  input: string,
  key: {
    readonly ctrl?: boolean;
    readonly meta?: boolean;
    readonly return?: boolean;
    readonly tab?: boolean;
    readonly escape?: boolean;
  },
  state: {
    readonly focused: boolean;
    readonly query: string;
    readonly actionKeys: ReadonlySet<string>;
  },
): ListFilterKeyRoute {
  const printable =
    input.length === 1 &&
    input >= " " &&
    input !== "\u007f" &&
    !key.ctrl &&
    !key.meta &&
    !key.return &&
    !key.tab &&
    !key.escape;
  if (key.ctrl && input === "f") return "focus";
  if (!printable) return "not-text";
  if (state.focused || state.query.length > 0) return "append";
  // `/` opens the command palette; it never starts a filter.
  if (input === "/") return "not-text";
  return state.actionKeys.has(input) ? "action" : "append";
}
