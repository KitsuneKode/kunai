// =============================================================================
// Session State Types
//
// This is the current app-state seam for the persistent-shell migration.
// Keep it pure, explicit, and testable.
// =============================================================================

import type { PlaybackProblem } from "../playback/playback-problem";
import type { EpisodeInfo, SearchResult, StreamInfo, TitleInfo } from "../types";
import type { AppCommandId } from "./command-registry";
import {
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_VIEWPORT,
  deriveResponsiveLayout,
  type ImagePreviewPreference,
  type LayoutPreferences,
  type ResponsiveLayoutState,
  type ViewportSize,
} from "./layout";

export type ShellMode = "series" | "anime";
export type ShellView =
  | "home"
  | "search"
  | "results"
  | "details"
  | "episodes"
  | "playback"
  | "history"
  | "diagnostics";
export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "buffering"
  | "seeking"
  | "stalled"
  | "playing"
  | "paused"
  | "finished"
  | "error";
export type SearchStatus = "idle" | "loading" | "ready" | "error";

export interface EpisodeNavigationState {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly hasNextSeason: boolean;
  readonly hasUpcomingNext: boolean;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
  readonly nextSeasonLabel?: string;
  readonly upcomingNextLabel?: string;
  readonly previousUnavailableReason?: string;
  readonly nextUnavailableReason?: string;
  readonly nextSeasonUnavailableReason?: string;
}

export interface CommandBarState {
  readonly open: boolean;
  readonly query: string;
  readonly highlightedCommandId: AppCommandId | null;
}

export interface OverlayPickerOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly tone?: "neutral" | "info" | "success" | "warning" | "error";
  readonly badge?: string;
}

export type PickerOverlayState = {
  readonly id?: string;
  readonly options: readonly OverlayPickerOption[];
  readonly selectedIndex?: number;
  readonly filterQuery?: string;
  readonly emptyMessage?: string;
};

export type OverlayState =
  | { type: "settings" }
  | { type: "provider_picker"; currentProvider: string; isAnime: boolean }
  | ({ type: "subtitle_picker" } & PickerOverlayState)
  | ({ type: "source_picker" } & PickerOverlayState)
  | ({ type: "quality_picker" } & PickerOverlayState)
  | ({ type: "season_picker"; currentSeason: number } & PickerOverlayState)
  | ({ type: "episode_picker"; season: number; initialIndex?: number } & PickerOverlayState)
  | ({ type: "recommendation_picker" } & PickerOverlayState)
  | { type: "history" }
  | { type: "downloads" }
  | { type: "library"; view?: "library" | "queue" }
  | { type: "diagnostics" }
  | { type: "help" }
  | { type: "about" }
  | { type: "setup"; missing: readonly string[] }
  | { type: "confirm"; message: string; confirmLabel?: string };

export type ModalState = OverlayState;

export type PickerModalOverlayState = Extract<
  OverlayState,
  | { type: "subtitle_picker" }
  | { type: "source_picker" }
  | { type: "quality_picker" }
  | { type: "season_picker" }
  | { type: "episode_picker" }
  | { type: "recommendation_picker" }
> & { readonly id: string };

export type PickerModalResult =
  | { readonly type: "selected"; readonly id: string; readonly value: string }
  | { readonly type: "cancelled"; readonly id: string };

export interface SessionState {
  readonly mode: ShellMode;
  readonly view: ShellView;
  readonly provider: string;
  readonly defaultProviders: {
    readonly series: string;
    readonly anime: string;
  };
  readonly animeLanguageProfile: import("../../services/persistence/ConfigService").MediaLanguageProfile;
  readonly seriesLanguageProfile: import("../../services/persistence/ConfigService").MediaLanguageProfile;
  readonly movieLanguageProfile: import("../../services/persistence/ConfigService").MediaLanguageProfile;

  readonly currentTitle: TitleInfo | null;
  readonly currentEpisode: EpisodeInfo | null;
  readonly episodeNavigation: EpisodeNavigationState;
  readonly autoplaySessionPaused: boolean;
  readonly autoskipSessionPaused: boolean;
  readonly stopAfterCurrent: boolean;

  readonly stream: StreamInfo | null;
  readonly playbackStatus: PlaybackStatus;
  readonly playbackError: string | null;
  readonly playbackDetail: string | null;
  readonly playbackNote: string | null;
  readonly playbackProblem: PlaybackProblem | null;
  readonly resolveRetryCount: number;

  readonly searchQuery: string;
  readonly searchResults: SearchResult[];
  readonly searchState: SearchStatus;
  readonly selectedResultIndex: number;
  readonly selectedResultId: string | null;

  readonly activeModals: OverlayState[];
  readonly pickerResult: PickerModalResult | null;
  readonly commandBar: CommandBarState;

  readonly viewport: ViewportSize;
  readonly layoutPreferences: LayoutPreferences;
  readonly layout: ResponsiveLayoutState;
}

export type StateTransition =
  | { type: "SET_MODE"; mode: ShellMode; provider: string }
  | { type: "SET_DEFAULT_PROVIDER"; mode: ShellMode; provider: string }
  | { type: "SET_VIEW"; view: ShellView }
  | { type: "SET_PROVIDER"; provider: string }
  | {
      type: "UPDATE_LANGUAGE_PROFILE";
      kind: "anime" | "series" | "movie";
      profile: import("../../services/persistence/ConfigService").MediaLanguageProfile;
    }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; results: SearchResult[] }
  | { type: "SET_SEARCH_STATE"; state: SearchStatus }
  | { type: "SELECT_RESULT"; index: number }
  | { type: "SELECT_TITLE"; title: TitleInfo }
  | { type: "SELECT_EPISODE"; episode: EpisodeInfo }
  | {
      type: "SET_EPISODE_NAVIGATION";
      navigation: Partial<EpisodeNavigationState>;
    }
  | { type: "SET_SESSION_AUTOPLAY_PAUSED"; paused: boolean }
  | { type: "SET_SESSION_AUTOSKIP_PAUSED"; paused: boolean }
  | { type: "SET_SESSION_STOP_AFTER_CURRENT"; enabled: boolean }
  | { type: "SET_STREAM"; stream: StreamInfo | null }
  | { type: "SET_PLAYBACK_STATUS"; status: PlaybackStatus; error?: string }
  | { type: "SET_PLAYBACK_FEEDBACK"; detail?: string | null; note?: string | null }
  | { type: "SET_PLAYBACK_PROBLEM"; problem: PlaybackProblem }
  | { type: "CLEAR_PLAYBACK_PROBLEM" }
  | { type: "SET_RESOLVE_RETRY_COUNT"; count: number }
  | { type: "OPEN_OVERLAY"; overlay: OverlayState }
  | { type: "CLOSE_TOP_OVERLAY" }
  | { type: "CLOSE_ALL_OVERLAYS" }
  | { type: "OPEN_PICKER"; picker: PickerModalOverlayState }
  | { type: "UPDATE_PICKER_FILTER"; id: string; filterQuery: string }
  | { type: "MOVE_PICKER_SELECTION"; id: string; delta: number }
  | { type: "RESOLVE_PICKER"; id: string; value: string }
  | { type: "CANCEL_PICKER"; id: string }
  | { type: "PUSH_MODAL"; modal: OverlayState }
  | { type: "POP_MODAL" }
  | { type: "CLOSE_ALL_MODALS" }
  | { type: "OPEN_COMMAND_BAR" }
  | { type: "CLOSE_COMMAND_BAR" }
  | { type: "SET_COMMAND_QUERY"; query: string }
  | { type: "HIGHLIGHT_COMMAND"; commandId: AppCommandId | null }
  | { type: "SET_TERMINAL_SIZE"; columns: number; rows: number }
  | { type: "TOGGLE_COMPANION_PANE" }
  | { type: "OPEN_DIAGNOSTICS_PANE" }
  | { type: "CLOSE_DIAGNOSTICS_PANE" }
  | { type: "SET_IMAGE_SUPPORT"; supported: boolean }
  | {
      type: "SET_IMAGE_PREVIEW_PREFERENCE";
      preference: ImagePreviewPreference;
    }
  | { type: "RESET_CONTENT" }
  | { type: "RESET_SEARCH" };

const DEFAULT_EPISODE_NAVIGATION: EpisodeNavigationState = {
  hasPrevious: false,
  hasNext: false,
  hasNextSeason: false,
  hasUpcomingNext: false,
};

export function createInitialState(
  defaultProvider: string,
  defaultAnimeProvider: string,
  initialProfiles: {
    anime: import("../../services/persistence/ConfigService").MediaLanguageProfile;
    series: import("../../services/persistence/ConfigService").MediaLanguageProfile;
    movie: import("../../services/persistence/ConfigService").MediaLanguageProfile;
  },
): SessionState {
  const layoutPreferences = DEFAULT_LAYOUT_PREFERENCES;
  return {
    mode: "series",
    view: "home",
    provider: defaultProvider,
    defaultProviders: {
      series: defaultProvider,
      anime: defaultAnimeProvider,
    },
    animeLanguageProfile: initialProfiles.anime,
    seriesLanguageProfile: initialProfiles.series,
    movieLanguageProfile: initialProfiles.movie,
    currentTitle: null,
    currentEpisode: null,
    episodeNavigation: DEFAULT_EPISODE_NAVIGATION,
    autoplaySessionPaused: false,
    autoskipSessionPaused: false,
    stopAfterCurrent: false,
    stream: null,
    playbackStatus: "idle",
    playbackError: null,
    playbackDetail: null,
    playbackNote: null,
    playbackProblem: null,
    resolveRetryCount: 0,
    searchQuery: "",
    searchResults: [],
    searchState: "idle",
    selectedResultIndex: 0,
    selectedResultId: null,
    activeModals: [],
    pickerResult: null,
    commandBar: {
      open: false,
      query: "",
      highlightedCommandId: null,
    },
    viewport: DEFAULT_VIEWPORT,
    layoutPreferences,
    layout: deriveResponsiveLayout(DEFAULT_VIEWPORT, layoutPreferences),
  };
}

export function reduceState(state: SessionState, transition: StateTransition): SessionState {
  switch (transition.type) {
    case "SET_MODE":
      return {
        ...state,
        mode: transition.mode,
        provider: transition.provider,
      };

    case "SET_DEFAULT_PROVIDER":
      return {
        ...state,
        defaultProviders: {
          ...state.defaultProviders,
          [transition.mode]: transition.provider,
        },
      };

    case "SET_VIEW":
      return { ...state, view: transition.view };

    case "SET_PROVIDER":
      return { ...state, provider: transition.provider };

    case "UPDATE_LANGUAGE_PROFILE":
      if (transition.kind === "anime")
        return { ...state, animeLanguageProfile: transition.profile };
      if (transition.kind === "series")
        return { ...state, seriesLanguageProfile: transition.profile };
      if (transition.kind === "movie")
        return { ...state, movieLanguageProfile: transition.profile };
      return state;

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        view: "search",
        searchQuery: transition.query,
        searchState: transition.query.length < 2 ? "idle" : "loading",
      };

    case "SET_SEARCH_RESULTS": {
      const nextSelection = deriveSearchSelection(transition.results, state.selectedResultId);
      return {
        ...state,
        view: transition.results.length > 0 ? "results" : "search",
        searchResults: transition.results,
        searchState: "ready",
        selectedResultIndex: nextSelection.index,
        selectedResultId: nextSelection.id,
      };
    }

    case "SET_SEARCH_STATE":
      return { ...state, searchState: transition.state };

    case "SELECT_RESULT": {
      if (state.searchResults.length === 0) {
        return state;
      }
      const index = clamp(transition.index, 0, state.searchResults.length - 1);
      return {
        ...state,
        selectedResultIndex: index,
        selectedResultId: state.searchResults[index]?.id ?? null,
      };
    }

    case "SELECT_TITLE":
      return {
        ...state,
        view: "details",
        currentTitle: transition.title,
        currentEpisode: null,
        episodeNavigation: DEFAULT_EPISODE_NAVIGATION,
        autoplaySessionPaused: false,
        autoskipSessionPaused: false,
        stopAfterCurrent: false,
        stream: null,
        playbackStatus: "idle",
        playbackProblem: null,
      };

    case "SELECT_EPISODE":
      return {
        ...state,
        view: "playback",
        currentEpisode: transition.episode,
      };

    case "SET_EPISODE_NAVIGATION":
      return {
        ...state,
        episodeNavigation: {
          ...state.episodeNavigation,
          ...transition.navigation,
        },
      };

    case "SET_SESSION_AUTOPLAY_PAUSED":
      return {
        ...state,
        autoplaySessionPaused: transition.paused,
      };

    case "SET_SESSION_AUTOSKIP_PAUSED":
      return {
        ...state,
        autoskipSessionPaused: transition.paused,
      };

    case "SET_SESSION_STOP_AFTER_CURRENT":
      return {
        ...state,
        stopAfterCurrent: transition.enabled,
      };

    case "SET_STREAM":
      return { ...state, stream: transition.stream };

    case "SET_PLAYBACK_STATUS":
      const keepPlaybackFeedback =
        transition.status === "loading" ||
        transition.status === "buffering" ||
        transition.status === "seeking" ||
        transition.status === "stalled" ||
        transition.status === "playing" ||
        transition.status === "paused";
      return {
        ...state,
        playbackStatus: transition.status,
        playbackError: transition.error ?? null,
        playbackDetail: keepPlaybackFeedback ? state.playbackDetail : null,
        playbackNote: keepPlaybackFeedback ? state.playbackNote : null,
        playbackProblem: transition.status === "loading" ? null : state.playbackProblem,
      };

    case "SET_PLAYBACK_FEEDBACK":
      return {
        ...state,
        playbackDetail:
          transition.detail === undefined ? state.playbackDetail : (transition.detail ?? null),
        playbackNote:
          transition.note === undefined ? state.playbackNote : (transition.note ?? null),
      };

    case "SET_PLAYBACK_PROBLEM":
      return {
        ...state,
        playbackProblem: transition.problem,
      };

    case "CLEAR_PLAYBACK_PROBLEM":
      return {
        ...state,
        playbackProblem: null,
      };

    case "SET_RESOLVE_RETRY_COUNT":
      return {
        ...state,
        resolveRetryCount: Math.max(0, transition.count),
      };

    case "OPEN_OVERLAY":
      return {
        ...state,
        activeModals: [...state.activeModals, transition.overlay],
      };

    case "CLOSE_TOP_OVERLAY":
      return {
        ...state,
        activeModals: state.activeModals.slice(0, -1),
      };

    case "CLOSE_ALL_OVERLAYS":
      return { ...state, activeModals: [] };

    case "OPEN_PICKER":
      return {
        ...state,
        pickerResult: null,
        activeModals: [
          ...state.activeModals,
          {
            ...transition.picker,
            selectedIndex: normalizePickerIndex(
              transition.picker.selectedIndex ??
                (transition.picker.type === "episode_picker"
                  ? transition.picker.initialIndex
                  : 0) ??
                0,
              transition.picker.options.length,
            ),
            filterQuery: transition.picker.filterQuery ?? "",
          },
        ],
      };

    case "UPDATE_PICKER_FILTER":
      return {
        ...state,
        activeModals: state.activeModals.map((modal, index) =>
          index === state.activeModals.length - 1 && isPickerOverlay(modal, transition.id)
            ? { ...modal, filterQuery: transition.filterQuery, selectedIndex: 0 }
            : modal,
        ),
      };

    case "MOVE_PICKER_SELECTION": {
      const top = state.activeModals.at(-1);
      if (!isPickerOverlay(top, transition.id)) return state;
      const filteredLength = filterPickerOptions(top.options, top.filterQuery ?? "").length;
      const selectedIndex =
        filteredLength > 0
          ? wrapPickerIndex((top.selectedIndex ?? 0) + transition.delta, filteredLength)
          : 0;
      return {
        ...state,
        activeModals: [
          ...state.activeModals.slice(0, -1),
          {
            ...top,
            selectedIndex,
          },
        ],
      };
    }

    case "RESOLVE_PICKER":
      return {
        ...state,
        pickerResult: { type: "selected", id: transition.id, value: transition.value },
        activeModals: popPickerOverlay(state.activeModals, transition.id),
      };

    case "CANCEL_PICKER":
      return {
        ...state,
        pickerResult: { type: "cancelled", id: transition.id },
        activeModals: popPickerOverlay(state.activeModals, transition.id),
      };

    case "PUSH_MODAL":
      return {
        ...state,
        activeModals: [...state.activeModals, transition.modal],
      };

    case "POP_MODAL":
      return {
        ...state,
        activeModals: state.activeModals.slice(0, -1),
      };

    case "CLOSE_ALL_MODALS":
      return { ...state, activeModals: [] };

    case "OPEN_COMMAND_BAR":
      return {
        ...state,
        commandBar: {
          ...state.commandBar,
          open: true,
        },
      };

    case "CLOSE_COMMAND_BAR":
      return {
        ...state,
        commandBar: {
          open: false,
          query: "",
          highlightedCommandId: null,
        },
      };

    case "SET_COMMAND_QUERY":
      return {
        ...state,
        commandBar: {
          ...state.commandBar,
          open: true,
          query: transition.query,
        },
      };

    case "HIGHLIGHT_COMMAND":
      return {
        ...state,
        commandBar: {
          ...state.commandBar,
          highlightedCommandId: transition.commandId,
        },
      };

    case "SET_TERMINAL_SIZE":
      return withLayout(state, {
        viewport: {
          columns: transition.columns,
          rows: transition.rows,
        },
      });

    case "TOGGLE_COMPANION_PANE":
      return withLayout(state, {
        layoutPreferences: {
          ...state.layoutPreferences,
          companionPaneOpen: !state.layoutPreferences.companionPaneOpen,
        },
      });

    case "OPEN_DIAGNOSTICS_PANE":
      return withLayout(state, {
        layoutPreferences: {
          ...state.layoutPreferences,
          diagnosticsRequested: true,
        },
      });

    case "CLOSE_DIAGNOSTICS_PANE":
      return withLayout(state, {
        layoutPreferences: {
          ...state.layoutPreferences,
          diagnosticsRequested: false,
        },
      });

    case "SET_IMAGE_SUPPORT":
      return withLayout(state, {
        layoutPreferences: {
          ...state.layoutPreferences,
          imageSupported: transition.supported,
        },
      });

    case "SET_IMAGE_PREVIEW_PREFERENCE":
      return withLayout(state, {
        layoutPreferences: {
          ...state.layoutPreferences,
          imagePreviewPreference: transition.preference,
        },
      });

    case "RESET_CONTENT":
      return {
        ...state,
        view: "home",
        currentTitle: null,
        currentEpisode: null,
        episodeNavigation: DEFAULT_EPISODE_NAVIGATION,
        autoplaySessionPaused: false,
        autoskipSessionPaused: false,
        stopAfterCurrent: false,
        stream: null,
        playbackStatus: "idle",
        playbackError: null,
        playbackDetail: null,
        playbackNote: null,
      };

    case "RESET_SEARCH":
      return {
        ...state,
        searchQuery: "",
        searchResults: [],
        searchState: "idle",
        selectedResultIndex: 0,
        selectedResultId: null,
      };

    default:
      return state;
  }
}

function withLayout(
  state: SessionState,
  patch: {
    viewport?: ViewportSize;
    layoutPreferences?: LayoutPreferences;
  },
): SessionState {
  const viewport = patch.viewport ?? state.viewport;
  const layoutPreferences = patch.layoutPreferences ?? state.layoutPreferences;
  return {
    ...state,
    viewport,
    layoutPreferences,
    layout: deriveResponsiveLayout(viewport, layoutPreferences),
  };
}

function deriveSearchSelection(
  results: readonly SearchResult[],
  selectedResultId: string | null,
): { index: number; id: string | null } {
  if (results.length === 0) {
    return { index: 0, id: null };
  }

  const preservedIndex = selectedResultId
    ? results.findIndex((result) => result.id === selectedResultId)
    : -1;
  const index = preservedIndex >= 0 ? preservedIndex : 0;
  return {
    index,
    id: results[index]?.id ?? null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPickerOverlay(
  overlay: OverlayState | undefined,
  id?: string,
): overlay is Extract<OverlayState, PickerOverlayState> {
  if (!overlay) return false;
  const picker =
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker" ||
    overlay.type === "source_picker" ||
    overlay.type === "quality_picker" ||
    overlay.type === "recommendation_picker";
  return picker && (id === undefined || overlay.id === id);
}

function normalizePickerIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return clamp(index, 0, length - 1);
}

function wrapPickerIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function filterPickerOptions(
  options: readonly OverlayPickerOption[],
  filterQuery: string,
): readonly OverlayPickerOption[] {
  const normalized = filterQuery.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.label} ${option.detail ?? ""} ${option.badge ?? ""}`
      .toLowerCase()
      .includes(normalized),
  );
}

function popPickerOverlay(modals: readonly OverlayState[], id: string): OverlayState[] {
  const top = modals.at(-1);
  if (isPickerOverlay(top, id)) return modals.slice(0, -1);
  return [...modals];
}
