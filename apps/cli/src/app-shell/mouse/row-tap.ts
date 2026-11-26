import { useRef } from "react";

export type RowTapOutcome = "select" | "activate";

export type RowTapDecision<K> = {
  readonly outcome: RowTapOutcome;
  /** What to remember as the previous tap: cleared once a tap activates. */
  readonly nextPreviousTap: K | null;
};

/**
 * The tap rule every list shares: the first tap on a row selects it; a second
 * tap on that same row, while it is still selected, activates it — the
 * keyboard's Enter. A stray tap on a phone (Termux sends taps as mouse clicks)
 * or a misplaced click therefore moves the cursor and never launches anything.
 */
export function decideRowTap<K>(
  previousTap: K | null,
  key: K,
  selected: boolean,
): RowTapDecision<K> {
  const activate = selected && previousTap === key;
  return { outcome: activate ? "activate" : "select", nextPreviousTap: activate ? null : key };
}

/** `decideRowTap` with the previous tap remembered across renders. */
export function useRowTap<K>(): (key: K, selected: boolean) => RowTapOutcome {
  const previous = useRef<K | null>(null);
  return (key, selected) => {
    const decision = decideRowTap(previous.current, key, selected);
    previous.current = decision.nextPreviousTap;
    return decision.outcome;
  };
}
