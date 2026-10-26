// =============================================================================
// use-search-suggestions — debounced remote catalog fetch for the type-ahead
// band. One request per resting draft, cancellable, latest-wins: a stale
// response can never overwrite a newer keystroke's result (request gate +
// AbortController). Timers are injectable so tests drive a manual clock —
// no real sleeps.
// =============================================================================

import {
  SUGGESTION_MIN_QUERY_LENGTH,
  type SearchSuggestion,
} from "@/domain/search/suggestion-engine";
import { useEffect, useRef, useState } from "react";

import { createLatestRequestGate } from "../browse-async";

/** Catalog round-trip budget for a keystroke-driven lookup — tune here. */
export const SUGGESTION_DEBOUNCE_MS = 300;

/** The handle a `SuggestionTimers.set` hands back — opaque to the hook. */
export type SuggestionTimerHandle = ReturnType<typeof setTimeout> | number;

/** Injectable clock seam — tests pass a manual scheduler; production uses the defaults. */
export interface SuggestionTimers {
  readonly set: (callback: () => void, delayMs: number) => SuggestionTimerHandle;
  readonly clear: (handle: SuggestionTimerHandle) => void;
}

const REAL_TIMERS: SuggestionTimers = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (handle) => clearTimeout(handle),
};

export interface SearchSuggestionsState<TValue> {
  readonly suggestions: readonly SearchSuggestion<TValue>[];
  readonly pending: boolean;
}

export function useSearchSuggestions<TValue>(input: {
  readonly query: string;
  readonly enabled: boolean;
  /** Mode and provider identity; changing either invalidates the previous request. */
  readonly scopeKey?: string;
  readonly onSuggest?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly SearchSuggestion<TValue>[]>;
  readonly debounceMs?: number;
  readonly timers?: SuggestionTimers;
}): SearchSuggestionsState<TValue> {
  const { query, enabled, scopeKey } = input;
  const debounceMs = input.debounceMs ?? SUGGESTION_DEBOUNCE_MS;
  const timers = input.timers ?? REAL_TIMERS;

  const [result, setResult] = useState<{
    readonly query: string;
    readonly scopeKey?: string;
    readonly suggestions: readonly SearchSuggestion<TValue>[];
  }>({ query, scopeKey, suggestions: [] });
  const [pending, setPending] = useState(false);
  const gateRef = useRef(createLatestRequestGate());
  const abortRef = useRef<AbortController | null>(null);
  // Callers pass an inline closure — putting it in the effect deps would
  // reschedule the debounce on EVERY render and the catalog section would
  // skeleton-loop forever. A ref keeps the latest loader without retriggering.
  const onSuggestRef = useRef(input.onSuggest);
  onSuggestRef.current = input.onSuggest;

  useEffect(() => {
    const onSuggest = onSuggestRef.current;
    const gate = gateRef.current;
    const requestId = gate.begin();
    if (!enabled || !onSuggest || query.trim().length < SUGGESTION_MIN_QUERY_LENGTH) {
      setResult({ query, scopeKey, suggestions: [] });
      setPending(false);
      return () => {
        gate.invalidate();
      };
    }

    // Clear stale rows the moment the draft changes — during the debounce
    // window the catalog section shows skeletons, never last keystroke's hits.
    setResult({ query, scopeKey, suggestions: [] });
    setPending(true);

    const handle = timers.set(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void (async () => {
        try {
          const next = await onSuggest(query, controller.signal);
          if (!gate.isCurrent(requestId)) return;
          setResult({ query, scopeKey, suggestions: next });
          setPending(false);
        } catch {
          // Suggestions are never an error surface — settle quietly to local-only.
          if (!gate.isCurrent(requestId)) return;
          setResult({ query, scopeKey, suggestions: [] });
          setPending(false);
        }
      })();
    }, debounceMs);

    return () => {
      timers.clear(handle);
      gate.invalidate();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [query, enabled, scopeKey, debounceMs, timers]);

  // Passive effects run after a commit: never expose the previous scope's rows
  // during that first render, even when its request already completed.
  const suggestions =
    enabled && result.query === query && result.scopeKey === scopeKey ? result.suggestions : [];
  return { suggestions, pending };
}
