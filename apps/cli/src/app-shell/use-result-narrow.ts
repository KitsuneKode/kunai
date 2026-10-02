// =============================================================================
// use-result-narrow.ts — local result narrowing, provider-filter badges, and
// the Esc-layer decision
//
// Browse has two distinct filter vocabularies that share one Esc key:
//   • structured chips — provider-level filters encoded in the query string
//     (`type:series dub:true …`), owned by the shell's query/search machinery;
//   • local narrowing — a "filter loaded results" field that only re-filters
//     the options already on screen, plus the badges that announce which
//     provider-level filters produced them.
//
// The local-narrow side used to live as three state slots whose reset
// semantics were hand-repeated at every result-application site (search,
// trending, recommendations, clear): some cleared the typed filter, some
// cleared badges, some both. One hook owns the trio now; the shell keeps only
// the parts that are genuinely its own — focus-zone dispatch, selection reset,
// and re-running the search after an Esc-layer chip strip.
// =============================================================================

import { useCallback, useMemo, useState } from "react";

import {
  getStructuredFilterChips,
  nextBrowseEscFilterLayer,
  stripStructuredFiltersFromQuery,
  type StructuredFilterChip,
} from "./browse-filter-chips";
import { filterBrowseOptionsByResultFilter } from "./browse-preview-rail";
import { MIN_RESULTS_FOR_LOCAL_FILTER } from "./browse-shell-view";
import type { BrowseShellOption } from "./types";

/**
 * Esc outcome the shell translates. `narrow` is fully handled inside the hook
 * (typed filter cleared, mode closed); `chips`/`query`/`cancel` come back with
 * what the shell needs — the chip layer carries the already-stripped query so
 * the shell never re-derives it.
 */
export type ResultNarrowEsc =
  | { readonly layer: "narrow" }
  | { readonly layer: "chips"; readonly plainQuery: string }
  | { readonly layer: "query" }
  | { readonly layer: "cancel" };

export function useResultNarrow<T>(input: {
  /** The un-narrowed result set — source of both narrowing and the bar's size gate. */
  readonly options: readonly BrowseShellOption<T>[];
  /** Raw query draft — structured filter chips are parsed from it. */
  readonly query: string;
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly isCalendarView: boolean;
  readonly ultraCompact: boolean;
}) {
  const [value, setValue] = useState("");
  const [modeOpen, setModeOpen] = useState(false);
  const [badges, setBadges] = useState<readonly string[]>([]);

  const narrowedOptions = useMemo(
    () => filterBrowseOptionsByResultFilter(input.options, value),
    [input.options, value],
  );
  const structuredFilterChips: readonly StructuredFilterChip[] = useMemo(
    () => getStructuredFilterChips(input.query),
    [input.query],
  );

  // Narrow mode only earns space on long result sets. Mode stays reachable
  // while it is open even if the list shrinks under the threshold afterward.
  const showBar =
    input.searchState === "ready" &&
    input.options.length >= MIN_RESULTS_FOR_LOCAL_FILTER &&
    !input.isCalendarView &&
    !input.ultraCompact &&
    (modeOpen || value.length > 0);

  /** Typing into the narrow field implies filter mode is open. */
  const type = useCallback((next: string) => {
    setValue(next);
    setModeOpen(true);
  }, []);

  /** Ctrl+F / palette "narrow-results": open mode without touching the value. */
  const open = useCallback(() => setModeOpen(true), []);

  /** New result set landed — the previous typed filter no longer applies. */
  const clearNarrow = useCallback(() => {
    setValue("");
    setModeOpen(false);
  }, []);

  /** Surface reset entirely (Esc-to-clear-results path). */
  const clearAll = useCallback(() => {
    setValue("");
    setModeOpen(false);
    setBadges([]);
  }, []);

  /**
   * Esc pressed anywhere. The layer decision is the hook's because it reads
   * hook state (value/mode/chips); what each layer *does* beyond the narrow
   * field stays the shell's — chips rewrites the query, query clears it,
   * cancel leaves the surface.
   */
  const escape = useCallback(
    (focus: {
      readonly filterFocused: boolean;
      readonly queryNonEmpty: boolean;
    }): ResultNarrowEsc => {
      const layer = nextBrowseEscFilterLayer({
        narrowOpenOrFocused: focus.filterFocused || modeOpen,
        resultFilterNonEmpty: value.length > 0,
        structuredChipCount: structuredFilterChips.length,
        queryNonEmpty: focus.queryNonEmpty,
      });
      if (layer === "narrow") clearNarrow();
      if (layer === "chips") {
        return { layer, plainQuery: stripStructuredFiltersFromQuery(input.query) };
      }
      return { layer };
    },
    [modeOpen, value, structuredFilterChips, input.query, clearNarrow],
  );

  return {
    value,
    modeOpen,
    badges,
    narrowedOptions,
    structuredFilterChips,
    showBar,
    type,
    open,
    clearNarrow,
    clearAll,
    setBadges,
    escape,
  };
}
