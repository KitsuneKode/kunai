export type SearchFocus = "query" | "results" | "result-filter" | "preview" | "details";

export type BrowseSearchUiState = {
  readonly queryDraft: string;
  readonly submittedQuery: string;
  readonly resultFilter: string;
  readonly focusedRegion: SearchFocus;
  readonly selectedIndex: number;
  readonly detailsOpen: boolean;
  readonly detailsScroll: number;
};

export type BrowseSearchAction =
  | { readonly type: "set-query-draft"; readonly queryDraft: string }
  | { readonly type: "submit-query"; readonly submittedQuery: string }
  | { readonly type: "set-result-filter"; readonly resultFilter: string }
  | { readonly type: "set-focused-region"; readonly focusedRegion: SearchFocus }
  | { readonly type: "set-selected-index"; readonly selectedIndex: number }
  | { readonly type: "open-details" }
  | { readonly type: "close-details" }
  | { readonly type: "set-details-scroll"; readonly detailsScroll: number }
  | { readonly type: "clear-results" };

export function createInitialBrowseSearchState(input?: {
  readonly queryDraft?: string;
  readonly submittedQuery?: string;
  readonly selectedIndex?: number;
}): BrowseSearchUiState {
  return {
    queryDraft: input?.queryDraft ?? "",
    submittedQuery: input?.submittedQuery ?? "",
    resultFilter: "",
    focusedRegion: "query",
    selectedIndex: input?.selectedIndex ?? 0,
    detailsOpen: false,
    detailsScroll: 0,
  };
}

export function browseSearchReducer(
  state: BrowseSearchUiState,
  action: BrowseSearchAction,
): BrowseSearchUiState {
  switch (action.type) {
    case "set-query-draft":
      return { ...state, queryDraft: action.queryDraft, focusedRegion: "query" };
    case "submit-query":
      return {
        ...state,
        queryDraft: action.submittedQuery,
        submittedQuery: action.submittedQuery,
        resultFilter: "",
        focusedRegion: "results",
        selectedIndex: 0,
        detailsOpen: false,
        detailsScroll: 0,
      };
    case "set-result-filter":
      return {
        ...state,
        resultFilter: action.resultFilter,
        focusedRegion: "result-filter",
        selectedIndex: 0,
      };
    case "set-focused-region":
      return { ...state, focusedRegion: action.focusedRegion };
    case "set-selected-index":
      return { ...state, selectedIndex: action.selectedIndex, focusedRegion: "results" };
    case "open-details":
      return { ...state, detailsOpen: true, focusedRegion: "details", detailsScroll: 0 };
    case "close-details":
      return { ...state, detailsOpen: false, focusedRegion: "results" };
    case "set-details-scroll":
      return { ...state, detailsScroll: action.detailsScroll };
    case "clear-results":
      return {
        ...state,
        submittedQuery: "",
        resultFilter: "",
        focusedRegion: "query",
        selectedIndex: 0,
        detailsOpen: false,
        detailsScroll: 0,
      };
    default:
      return state;
  }
}

export function isQueryDirty(state: BrowseSearchUiState): boolean {
  return state.queryDraft.trim() !== state.submittedQuery.trim();
}

export function normalizeBrowseCommandInput(nextValue: string): {
  readonly value: string;
  readonly openCommandPalette: boolean;
} {
  if (!nextValue.includes("/")) {
    return { value: nextValue, openCommandPalette: false };
  }
  return {
    value: nextValue.replaceAll("/", ""),
    openCommandPalette: true,
  };
}
