/**
 * Text capture versus chords.
 *
 * A filter that already has characters owns the keyboard: `x` and `p` are
 * letters. Delete and cleanup-protect arm only when the filter is empty.
 */
export function libraryFilterAcceptsText(input: string, filterQuery: string): boolean {
  if (input.length !== 1) return false;
  if (filterQuery.length > 0) return true;
  return input !== "x" && input !== "X" && input !== "p" && input !== "P";
}

/** Episode-picker `m` marks watched only when the filter is not capturing text. */
export function episodePickerMarkArmed(filterQuery: string): boolean {
  return filterQuery.length === 0;
}

export type QueueClearState = "idle" | "armed";

/**
 * First `c` arms a clear. A second `c` clears. Any other key disarms.
 * The queue is not cleared on the key that only asks.
 */
export function nextQueueClear(
  state: QueueClearState,
  input: string,
): { readonly state: QueueClearState; readonly clear: boolean } {
  if (input !== "c") return { state: "idle", clear: false };
  if (state === "armed") return { state: "idle", clear: true };
  return { state: "armed", clear: false };
}
