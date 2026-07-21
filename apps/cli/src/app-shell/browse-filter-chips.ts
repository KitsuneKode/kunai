import type { FilterState, FilterStateKey } from "@/domain/search/SearchIntent";
import { clearFilterStateKey, describeFilterStateChips } from "@/domain/search/SearchIntent";
import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";

export type BrowseEscFilterLayer = "narrow" | "chips" | "results" | "query" | "cancel";

export type StructuredFilterChip = {
  readonly key: FilterStateKey;
  readonly label: string;
};

/**
 * A filter chip was cleared or peeled. Re-run the search when a prior search
 * exists so the user is never stranded — critically, this must still fire when
 * the current list is EMPTY (e.g. over-filtered to nothing), otherwise clearing
 * the offending chip would leave the user stuck on an empty result surface.
 */
export function shouldResearchAfterFilterChange(input: {
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly lastSearchedQuery: string;
  readonly nextQuery: string;
}): boolean {
  if (input.searchState !== "ready" && input.searchState !== "error") return false;
  if (input.lastSearchedQuery.trim().length === 0) return false;
  return input.nextQuery.trim().length > 0;
}

export function nextBrowseEscFilterLayer(input: {
  readonly narrowOpenOrFocused: boolean;
  readonly resultFilterNonEmpty: boolean;
  readonly structuredChipCount: number;
  readonly hasResultsOrErrorOrLoading: boolean;
  readonly queryNonEmpty: boolean;
}): BrowseEscFilterLayer {
  if (input.narrowOpenOrFocused || input.resultFilterNonEmpty) return "narrow";
  if (input.structuredChipCount > 0) return "chips";
  if (input.hasResultsOrErrorOrLoading) return "results";
  if (input.queryNonEmpty) return "query";
  return "cancel";
}

export function filterStateToQueryTokens(state: FilterState): string[] {
  const tokens: string[] = [];
  if (state.mode) tokens.push(`mode:${state.mode}`);
  if (state.type && state.type !== "all") tokens.push(`type:${state.type}`);
  if (state.genres.length > 0) tokens.push(`genre:${state.genres.join(",")}`);
  if (state.year !== undefined) {
    if (typeof state.year === "number") {
      tokens.push(`year:${state.year}`);
    } else {
      const { from, to } = state.year;
      if (typeof from === "number" && typeof to === "number") {
        tokens.push(`year:${from}..${to}`);
      } else if (typeof from === "number") {
        tokens.push(`year:${from}`);
      } else if (typeof to === "number") {
        tokens.push(`year:${to}`);
      }
    }
  }
  if (typeof state.minRating === "number") tokens.push(`rating:${state.minRating}`);
  if (typeof state.downloaded === "boolean") tokens.push(`downloaded:${state.downloaded}`);
  if (state.watched) tokens.push(`watched:${state.watched}`);
  if (state.release) tokens.push(`release:${state.release}`);
  if (state.audio) tokens.push(`audio:${state.audio}`);
  if (state.subtitles) tokens.push(`subtitles:${state.subtitles}`);
  if (state.provider) tokens.push(`provider:${state.provider}`);
  if (state.sort && state.sort !== "relevance") tokens.push(`sort:${state.sort}`);
  return tokens;
}

export function serializeFilterStateQuery(state: FilterState): string {
  const tokens = filterStateToQueryTokens(state);
  return [state.query, ...tokens].filter(Boolean).join(" ");
}

export function removeFilterTokenFromQuery(query: string, key: FilterStateKey): string {
  const parsed = parseSearchIntentText(query);
  const next = clearFilterStateKey(parsed.filterState, key);
  return serializeFilterStateQuery(next);
}

export function stripStructuredFiltersFromQuery(query: string): string {
  return parseSearchIntentText(query).query.trim();
}

export function getStructuredFilterChips(query: string): readonly StructuredFilterChip[] {
  const state = parseSearchIntentText(query).filterState;
  return buildStructuredFilterChips(state);
}

export function getLastFilterStateKey(state: FilterState): FilterStateKey | null {
  const chips = buildStructuredFilterChips(state);
  const last = chips.at(-1);
  return last ? last.key : null;
}

function buildStructuredFilterChips(state: FilterState): StructuredFilterChip[] {
  const labels = describeFilterStateChips(state);
  const chips: StructuredFilterChip[] = [];
  let genreIndex = 0;

  for (const label of labels) {
    if (label.startsWith("mode ")) {
      chips.push({ key: "mode", label });
      continue;
    }
    if (label.startsWith("type ")) {
      chips.push({ key: "type", label });
      continue;
    }
    if (label.startsWith("genre ")) {
      chips.push({ key: "genres", label });
      genreIndex += 1;
      continue;
    }
    if (label.startsWith("year ")) {
      chips.push({ key: "year", label });
      continue;
    }
    if (label.startsWith("rating ")) {
      chips.push({ key: "minRating", label });
      continue;
    }
    if (label.startsWith("downloaded ")) {
      chips.push({ key: "downloaded", label });
      continue;
    }
    if (label.startsWith("watched ")) {
      chips.push({ key: "watched", label });
      continue;
    }
    if (label.startsWith("release ")) {
      chips.push({ key: "release", label });
      continue;
    }
    if (label.startsWith("audio ")) {
      chips.push({ key: "audio", label });
      continue;
    }
    if (label.startsWith("subtitles ")) {
      chips.push({ key: "subtitles", label });
      continue;
    }
    if (label.startsWith("provider ")) {
      chips.push({ key: "provider", label });
      continue;
    }
    if (label.startsWith("sort ")) {
      chips.push({ key: "sort", label });
      continue;
    }
    void genreIndex;
  }

  return chips;
}
